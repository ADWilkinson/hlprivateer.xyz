import { describe, expect, it } from 'vitest'
import {
  aggregateSentiment,
  computeEdge,
  estimateProbability,
  kellyFraction,
  proposeOrder
} from './index'
import type {
  OutcomeMarket,
  ProbabilityEstimate,
  RiskConfig,
  SentimentSignal
} from '@hl/privateer-contracts'

const baseSig = (over: Partial<SentimentSignal> = {}): SentimentSignal => ({
  id: 's',
  marketId: 'mkt',
  source: 'news',
  polarity: 0,
  confidence: 0.8,
  freshnessSec: 0,
  summary: 'x',
  ts: new Date().toISOString(),
  ...over
})

describe('aggregateSentiment', () => {
  it('returns neutral on empty', () => {
    const r = aggregateSentiment([])
    expect(r.polarity).toBe(0)
    expect(r.confidence).toBe(0)
    expect(r.evidenceMass).toBe(0)
  })

  it('weights fresh signals more than stale', () => {
    const fresh = baseSig({ id: 'a', polarity: 1, freshnessSec: 0 })
    const stale = baseSig({ id: 'b', polarity: -1, freshnessSec: 7200 }) // 2h
    const r = aggregateSentiment([fresh, stale], { halfLifeSec: 1800 })
    expect(r.polarity).toBeGreaterThan(0)
    expect(r.basisSignalIds[0]).toBe('a')
  })

  it('saturates confidence with many signals', () => {
    const many = Array.from({ length: 20 }, (_, i) => baseSig({ id: `s${i}`, polarity: 1 }))
    const r = aggregateSentiment(many)
    expect(r.confidence).toBeGreaterThan(0.9)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })

  it('discounts low-trust sources', () => {
    const news = baseSig({ id: 'n', source: 'news', polarity: 1 })
    const x = baseSig({ id: 'x', source: 'x', polarity: -1 })
    const r = aggregateSentiment([news, x])
    expect(r.polarity).toBeGreaterThan(0)
  })
})

describe('estimateProbability', () => {
  it('returns prior when no evidence', () => {
    const e = estimateProbability({
      marketYesPrice: 0.4,
      sentiment: { polarity: 0, confidence: 0, evidenceMass: 0, basisSignalIds: [] }
    })
    expect(e.pHat).toBeCloseTo(0.4)
    expect(e.edge).toBeCloseTo(0)
  })

  it('shifts toward positive evidence', () => {
    const e = estimateProbability({
      marketYesPrice: 0.4,
      sentiment: { polarity: 1, confidence: 0.9, evidenceMass: 4, basisSignalIds: ['a'] }
    })
    expect(e.pHat).toBeGreaterThan(0.4)
    expect(e.edge).toBeGreaterThan(0)
  })

  it('shifts toward negative evidence', () => {
    const e = estimateProbability({
      marketYesPrice: 0.6,
      sentiment: { polarity: -1, confidence: 0.9, evidenceMass: 4, basisSignalIds: ['a'] }
    })
    expect(e.pHat).toBeLessThan(0.6)
    expect(e.edge).toBeLessThan(0)
  })

  it('keeps pHat in [0,1]', () => {
    const e = estimateProbability({
      marketYesPrice: 0.99,
      sentiment: { polarity: -1, confidence: 1, evidenceMass: 100, basisSignalIds: [] }
    })
    expect(e.pHat).toBeGreaterThanOrEqual(0)
    expect(e.pHat).toBeLessThanOrEqual(1)
  })
})

describe('computeEdge', () => {
  it('YES edge is pHat - market', () => {
    expect(computeEdge({ pHat: 0.6, marketYesPrice: 0.5, side: 'YES' }).edgeBps).toBe(1000)
  })
  it('NO edge is mirror', () => {
    expect(computeEdge({ pHat: 0.4, marketYesPrice: 0.5, side: 'NO' }).edgeBps).toBe(1000)
  })
  it('negative edge for wrong side', () => {
    expect(computeEdge({ pHat: 0.4, marketYesPrice: 0.5, side: 'YES' }).edgeBps).toBe(-1000)
  })
})

describe('kellyFraction', () => {
  it('returns 0 when no edge', () => {
    expect(kellyFraction({ pHat: 0.5, marketYesPrice: 0.5, side: 'YES' })).toBe(0)
  })
  it('returns 0 for negative edge', () => {
    expect(kellyFraction({ pHat: 0.4, marketYesPrice: 0.5, side: 'YES' })).toBe(0)
  })
  it('caps at kellyCap', () => {
    const f = kellyFraction({ pHat: 0.95, marketYesPrice: 0.1, side: 'YES', kellyCap: 0.25 })
    expect(f).toBeCloseTo(0.25)
  })
  it('positive fractional bet for moderate edge', () => {
    const f = kellyFraction({ pHat: 0.6, marketYesPrice: 0.5, side: 'YES', kellyCap: 0.5 })
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(0.5)
  })
})

const market = (over: Partial<OutcomeMarket> = {}): OutcomeMarket => ({
  id: 'mkt-1',
  question: 'q',
  resolutionAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  challengeWindowSec: 0,
  status: 'trading',
  yesPrice: 0.4,
  bookDepthYesUsd: 5000,
  bookDepthNoUsd: 5000,
  topicTags: [],
  updatedAt: new Date().toISOString(),
  ...over
})

const estimate = (over: Partial<ProbabilityEstimate> = {}): ProbabilityEstimate => ({
  id: 'e-1',
  marketId: 'mkt-1',
  pHat: 0.55,
  marketYesPrice: 0.4,
  edge: 0.15,
  confidence: 0.8,
  basisSignalIds: [],
  rationale: '',
  ts: new Date().toISOString(),
  ...over
})

const cfg: RiskConfig = {
  maxSentimentAgeSec: 900,
  minSecondsToResolution: 3600,
  maxSecondsToResolution: 60 * 24 * 3600,
  challengeWindowBufferSec: 0,
  bankrollUsd: 10_000,
  maxStakePerMarketUsd: 500,
  maxConcurrentMarkets: 20,
  maxGrossExposureUsd: 5000,
  maxCorrelatedClusterUsd: 1500,
  minEdgeBps: 200,
  minBookDepthUsd: 500,
  kellyCap: 0.25,
  haltAll: false
}

describe('proposeOrder', () => {
  it('returns null when market is not trading', () => {
    expect(proposeOrder({ market: market({ status: 'auction' }), estimate: estimate(), riskConfig: cfg, openExposureUsd: 0 })).toBeNull()
  })

  it('returns null when edge below threshold', () => {
    expect(proposeOrder({
      market: market({ yesPrice: 0.54 }),
      estimate: estimate({ pHat: 0.55, marketYesPrice: 0.54, edge: 0.01 }),
      riskConfig: cfg,
      openExposureUsd: 0
    })).toBeNull()
  })

  it('caps size by maxStakePerMarket', () => {
    const p = proposeOrder({ market: market(), estimate: estimate({ pHat: 0.95 }), riskConfig: cfg, openExposureUsd: 0 })
    expect(p).not.toBeNull()
    expect(p!.sizeUsd).toBeLessThanOrEqual(cfg.maxStakePerMarketUsd)
    expect(p!.side).toBe('YES')
  })

  it('returns null when bankroll exhausted', () => {
    const p = proposeOrder({ market: market(), estimate: estimate(), riskConfig: cfg, openExposureUsd: cfg.maxGrossExposureUsd })
    expect(p).toBeNull()
  })

  it('chooses NO side when pHat < market', () => {
    const p = proposeOrder({
      market: market({ yesPrice: 0.7 }),
      estimate: estimate({ pHat: 0.4, marketYesPrice: 0.7 }),
      riskConfig: cfg,
      openExposureUsd: 0
    })
    expect(p!.side).toBe('NO')
  })
})
