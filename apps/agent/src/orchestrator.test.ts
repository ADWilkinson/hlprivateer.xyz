import { describe, expect, it } from 'vitest'
import { ulid } from 'ulid'
import type {
  AgentProposal,
  OutcomeFill,
  OutcomeMarket,
  OutcomeProposal,
  RiskConfig,
  SentimentItem
} from './contracts'
import type { Accountant, OpenPosition } from './accountant'
import { createOrchestrator, type OrderRouter } from './orchestrator'
import { FixedAgent } from './strategy'

class TestRouter implements OrderRouter {
  async place(p: OutcomeProposal): Promise<OutcomeFill> {
    return {
      id: `f-${ulid()}`,
      proposalId: p.id,
      marketId: p.marketId,
      side: p.side,
      fillPrice: p.limitPrice,
      fillSizeUsd: p.sizeUsd,
      feeUsd: 0,
      ts: new Date().toISOString()
    }
  }
}

class TestAccountant implements Accountant {
  private byMarket = new Map<string, OpenPosition>()
  private marketTags = new Map<string, string[]>()
  recordMarket(market: OutcomeMarket): void {
    this.marketTags.set(market.id, market.topicTags)
  }
  applyFill(fill: OutcomeFill): void {
    const existing = this.byMarket.get(fill.marketId)
    if (!existing) {
      this.byMarket.set(fill.marketId, {
        marketId: fill.marketId,
        side: fill.side,
        sizeUsd: fill.fillSizeUsd
      })
      return
    }
    if (existing.side === fill.side) existing.sizeUsd += fill.fillSizeUsd
  }
  async positions(): Promise<readonly OpenPosition[]> {
    return [...this.byMarket.values()]
  }
  async equityUsd(): Promise<number> {
    return 0
  }
  async openExposureUsd(): Promise<number> {
    let s = 0
    for (const p of this.byMarket.values()) s += p.sizeUsd
    return s
  }
  async openMarketCount(): Promise<number> {
    return this.byMarket.size
  }
  async clusterExposureUsd(market: OutcomeMarket): Promise<number> {
    if (market.topicTags.length === 0) return 0
    const tags = new Set(market.topicTags)
    let s = 0
    for (const p of this.byMarket.values()) {
      if (p.marketId === market.id) continue
      const otherTags = this.marketTags.get(p.marketId) ?? []
      if (otherTags.some((t) => tags.has(t))) s += p.sizeUsd
    }
    return s
  }
  async warmup(): Promise<void> {}
}

class StaticMarketProvider {
  constructor(private readonly markets: OutcomeMarket[]) {}
  async list(): Promise<OutcomeMarket[]> {
    return this.markets
  }
  async get(id: string): Promise<OutcomeMarket | undefined> {
    return this.markets.find((m) => m.id === id)
  }
}

const market: OutcomeMarket = {
  id: 'mkt-1',
  question: 'q',
  resolutionAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  challengeWindowSec: 0,
  status: 'trading',
  yesPrice: 0.4,
  bookDepthYesUsd: 5000,
  bookDepthNoUsd: 5000,
  topicTags: ['macro'],
  updatedAt: new Date().toISOString()
}

const riskConfig: RiskConfig = {
  maxSentimentAgeSec: 900,
  minSecondsToResolution: 3600,
  maxSecondsToResolution: 60 * 24 * 3600,
  challengeWindowBufferSec: 0,
  bankrollUsd: 10_000,
  maxStakePerMarketUsd: 500,
  maxConcurrentMarkets: 10,
  maxGrossExposureUsd: 2000,
  maxCorrelatedClusterUsd: 1500,
  minEdgeBps: 200,
  minBookDepthUsd: 500,
  kellyCap: 0.25,
  proposalTtlSec: 300,
  haltAll: false
}

const positiveItem = (over: Partial<SentimentItem> = {}): SentimentItem => ({
  id: ulid(),
  marketId: 'mkt-1',
  source: 'news',
  summary: 'positive macro',
  observedAt: new Date().toISOString(),
  ...over
})

function tradingAgent(): FixedAgent {
  return new FixedAgent(
    (ctx): AgentProposal => ({
      side: 'YES',
      pHat: 0.6,
      sizeUsd: 200,
      limitPrice: ctx.market.yesPrice,
      thesis: 'macro skew',
      signalsConsideredAt: new Date().toISOString()
    })
  )
}

function skipAgent(): FixedAgent {
  return new FixedAgent(() => null)
}

function buildSetup(opts: {
  agent?: FixedAgent
  riskConfig?: RiskConfig
  marketFilter?: { allowTags?: string[]; blockTags?: string[] }
} = {}) {
  const accountant = new TestAccountant()
  const router = new TestRouter()
  const wrappedRouter: OrderRouter = {
    place: async (p) => {
      const f = await router.place(p)
      accountant.applyFill(f)
      return f
    }
  }
  const orchestrator = createOrchestrator({
    agent: opts.agent ?? tradingAgent(),
    markets: new StaticMarketProvider([market]),
    router: wrappedRouter,
    accountant,
    riskConfig: opts.riskConfig ?? riskConfig,
    marketFilter: opts.marketFilter
  })
  return { orchestrator, accountant }
}

describe('orchestrator', () => {
  it('refuses to trade until started (mode != READY)', async () => {
    const { orchestrator } = buildSetup()
    const r = await orchestrator.evaluateMarket('mkt-1')
    expect(r.proposal).toBeUndefined()
  })

  it('runs agent → risk → fill on a positive call', async () => {
    const { orchestrator } = buildSetup()
    await orchestrator.start()
    const r = await orchestrator.ingest(positiveItem())
    expect(r.proposal).toBeDefined()
    expect(r.decision?.decision).toBe('ALLOW')
    expect(r.fill).toBeDefined()
    expect(orchestrator.metrics().fillsConfirmed).toBe(1)
  })

  it('skips when the agent declines', async () => {
    const { orchestrator } = buildSetup({ agent: skipAgent() })
    await orchestrator.start()
    const r = await orchestrator.ingest(positiveItem())
    expect(r.proposal).toBeUndefined()
    expect(orchestrator.metrics().proposalsSkipped).toBe(1)
  })

  it('skips markets blocked by blockTags', async () => {
    const { orchestrator } = buildSetup({ marketFilter: { blockTags: ['macro'] } })
    await orchestrator.start()
    const r = await orchestrator.ingest(positiveItem())
    expect(r.proposal).toBeUndefined()
  })

  it('skips markets not in allowTags', async () => {
    const { orchestrator } = buildSetup({ marketFilter: { allowTags: ['something-else'] } })
    await orchestrator.start()
    const r = await orchestrator.ingest(positiveItem())
    expect(r.proposal).toBeUndefined()
  })

  it('serializes concurrent evaluations so exposure never exceeds the cap', async () => {
    const cap = 500
    const tightConfig: RiskConfig = {
      ...riskConfig,
      maxStakePerMarketUsd: cap,
      maxGrossExposureUsd: cap
    }
    const { orchestrator } = buildSetup({ riskConfig: tightConfig })
    await orchestrator.start()
    await orchestrator.ingest(positiveItem())
    const results = await Promise.all([
      orchestrator.evaluateMarket('mkt-1'),
      orchestrator.evaluateMarket('mkt-1'),
      orchestrator.evaluateMarket('mkt-1')
    ])
    const totalFilled = results.reduce(
      (acc, r) => acc + (r.fill?.fillSizeUsd ?? 0),
      0
    )
    expect(totalFilled).toBeLessThanOrEqual(cap + 1e-6)
  })

  it('DENYs when operator halts mid-stream', async () => {
    const halted: RiskConfig = { ...riskConfig, haltAll: true }
    const { orchestrator } = buildSetup({ riskConfig: halted })
    await orchestrator.start()
    const r = await orchestrator.ingest(positiveItem())
    expect(r.decision?.decision).toBe('DENY')
    expect(r.fill).toBeUndefined()
  })

  it('records pHat estimate per market for the public surface', async () => {
    const { orchestrator } = buildSetup()
    await orchestrator.start()
    await orchestrator.ingest(positiveItem())
    expect(orchestrator.pHat('mkt-1')).toBeDefined()
    expect(orchestrator.pHat('mkt-1')!.pHat).toBeCloseTo(0.6)
  })
})
