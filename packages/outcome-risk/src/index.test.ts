import { describe, expect, it } from 'vitest'
import { evaluate, type RiskContext } from './index'
import type {
  OutcomeMarket,
  OutcomeProposal,
  ProbabilityEstimate,
  RiskConfig,
  SentimentSignal
} from '@hl/privateer-contracts'

const NOW = Date.parse('2026-05-01T12:00:00.000Z')

const cfg: RiskConfig = {
  maxSentimentAgeSec: 900,
  minSecondsToResolution: 3600,
  maxSecondsToResolution: 60 * 24 * 3600,
  challengeWindowBufferSec: 0,
  bankrollUsd: 10_000,
  maxStakePerMarketUsd: 500,
  maxConcurrentMarkets: 5,
  maxGrossExposureUsd: 2000,
  maxCorrelatedClusterUsd: 800,
  minEdgeBps: 200,
  minBookDepthUsd: 500,
  kellyCap: 0.25,
  haltAll: false
}

const market = (over: Partial<OutcomeMarket> = {}): OutcomeMarket => ({
  id: 'mkt-1',
  question: 'q',
  resolutionAt: new Date(NOW + 7 * 86400 * 1000).toISOString(),
  challengeWindowSec: 0,
  status: 'trading',
  yesPrice: 0.4,
  bookDepthYesUsd: 5000,
  bookDepthNoUsd: 5000,
  topicTags: [],
  updatedAt: new Date(NOW).toISOString(),
  ...over
})

const proposal = (over: Partial<OutcomeProposal> = {}): OutcomeProposal => ({
  id: 'p-1',
  marketId: 'mkt-1',
  side: 'YES',
  limitPrice: 0.4,
  sizeUsd: 200,
  edgeBps: 1000,
  kellyFraction: 0.1,
  expiresAt: new Date(NOW + 300_000).toISOString(),
  estimateId: 'e-1',
  rationale: '',
  ts: new Date(NOW).toISOString(),
  ...over
})

const estimate: ProbabilityEstimate = {
  id: 'e-1',
  marketId: 'mkt-1',
  pHat: 0.5,
  marketYesPrice: 0.4,
  edge: 0.1,
  confidence: 0.8,
  basisSignalIds: ['s-1'],
  rationale: '',
  ts: new Date(NOW).toISOString()
}

const signals = (freshnessSec = 60): SentimentSignal[] => [
  {
    id: 's-1',
    marketId: 'mkt-1',
    source: 'news',
    polarity: 0.7,
    confidence: 0.8,
    freshnessSec,
    summary: '',
    ts: new Date(NOW).toISOString()
  }
]

const baseCtx = (over: Partial<RiskContext> = {}): RiskContext => ({
  proposal: proposal(),
  estimate,
  market: market(),
  config: cfg,
  recentSignals: signals(),
  openExposureUsd: 0,
  openMarketCount: 0,
  clusterExposureUsd: 0,
  nowMs: NOW,
  ...over
})

describe('outcome-risk evaluate', () => {
  it('ALLOWs a clean proposal', () => {
    const d = evaluate(baseCtx())
    expect(d.decision).toBe('ALLOW')
    expect(d.failures).toEqual([])
  })

  it('DENYs on operator halt before anything else', () => {
    const d = evaluate(baseCtx({ config: { ...cfg, haltAll: true } }))
    expect(d.decision).toBe('DENY')
    expect(d.failures[0].code).toBe('OPERATOR_HALT')
  })

  it('DENYs invalid limit price', () => {
    const d = evaluate(baseCtx({ proposal: proposal({ limitPrice: 1.2 }) }))
    expect(d.failures[0].code).toBe('INVALID_PROPOSAL')
  })

  it('DENYs stale sentiment', () => {
    const d = evaluate(baseCtx({ recentSignals: signals(2000) }))
    expect(d.failures[0].code).toBe('STALE_SENTIMENT')
  })

  it('DENYs no signals', () => {
    const d = evaluate(baseCtx({ recentSignals: [] }))
    expect(d.failures[0].code).toBe('STALE_SENTIMENT')
  })

  it('DENYs market not trading', () => {
    const d = evaluate(baseCtx({ market: market({ status: 'settling' }) }))
    expect(d.failures[0].code).toBe('MARKET_NOT_TRADING')
  })

  it('DENYs resolution too soon', () => {
    const d = evaluate(baseCtx({ market: market({ resolutionAt: new Date(NOW + 600_000).toISOString() }) }))
    expect(d.failures[0].code).toBe('RESOLUTION_TOO_SOON')
  })

  it('DENYs resolution too far', () => {
    const d = evaluate(baseCtx({ market: market({ resolutionAt: new Date(NOW + 365 * 86400 * 1000).toISOString() }) }))
    expect(d.failures[0].code).toBe('RESOLUTION_TOO_FAR')
  })

  it('DENYs within challenge buffer', () => {
    const close = new Date(NOW + 7200 * 1000).toISOString() // 2h, > min, but with 4h buffer
    const d = evaluate(
      baseCtx({
        market: market({ resolutionAt: close, challengeWindowSec: 14400 })
      })
    )
    expect(d.failures[0].code).toBe('CHALLENGE_WINDOW_OPEN')
  })

  it('DENYs edge too thin', () => {
    const d = evaluate(baseCtx({ proposal: proposal({ edgeBps: 100 }) }))
    expect(d.failures[0].code).toBe('EDGE_TOO_THIN')
  })

  it('DENYs stake-per-market over cap', () => {
    const d = evaluate(baseCtx({ proposal: proposal({ sizeUsd: 600 }) }))
    expect(d.failures[0].code).toBe('STAKE_PER_MARKET')
  })

  it('DENYs too many concurrent markets', () => {
    const d = evaluate(baseCtx({ openMarketCount: 5 }))
    expect(d.failures[0].code).toBe('CONCURRENT_MARKETS')
  })

  it('DENYs correlated cluster cap', () => {
    const d = evaluate(
      baseCtx({
        market: market({ topicTags: ['fed'] }),
        clusterExposureUsd: 700,
        proposal: proposal({ sizeUsd: 200 })
      })
    )
    expect(d.failures[0].code).toBe('CORRELATED_EXPOSURE')
  })

  it('DENYs bankroll depleted', () => {
    const d = evaluate(baseCtx({ openExposureUsd: 1900, proposal: proposal({ sizeUsd: 200 }) }))
    expect(d.failures[0].code).toBe('BANKROLL_DEPLETED')
  })

  it('DENYs low book depth', () => {
    const d = evaluate(baseCtx({ market: market({ bookDepthYesUsd: 100 }) }))
    expect(d.failures[0].code).toBe('LOW_LIQUIDITY')
  })

  it('short-circuits on first failure', () => {
    const d = evaluate(
      baseCtx({
        config: { ...cfg, haltAll: true },
        recentSignals: [] // would also fail STALE_SENTIMENT
      })
    )
    expect(d.failures).toHaveLength(1)
    expect(d.failures[0].code).toBe('OPERATOR_HALT')
  })
})
