import { describe, expect, it } from 'vitest'
import { ulid } from 'ulid'
import { InMemoryEventBus } from '@hl/privateer-event-bus'
import type {
  OutcomeFill,
  OutcomeMarket,
  OutcomeProposal,
  RiskConfig,
  SentimentSignal
} from '@hl/privateer-contracts'
import type { Accountant, OpenPosition } from './accountant'
import { createOrchestrator } from './orchestrator'
import { InMemoryMarketProvider } from './markets'
import type { OrderRouter } from './order-router'

// Test-only: a router that completes the proposal at its limit price.
// Production wires the real HL router via apps/oracle/wiring.ts.
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

// Test-only accountant whose state mutates from observed fills. The orchestrator
// reads through this; it lets us test the policy layer without a live HL.
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
  async recentFills(): Promise<never[]> {
    return []
  }
}

// A router that wires its fills back into the test accountant so the
// per-market mutex test can observe exposure mounting between calls.
function trackingRouter(accountant: TestAccountant): OrderRouter {
  const inner = new TestRouter()
  return {
    place: async (p) => {
      const f = await inner.place(p)
      accountant.applyFill(f)
      return f
    }
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
  haltAll: false
}

async function buildSetup() {
  const bus = new InMemoryEventBus()
  const markets = new InMemoryMarketProvider([market])
  const accountant = new TestAccountant()
  const router = trackingRouter(accountant)
  const orchestrator = createOrchestrator({ bus, markets, router, accountant, riskConfig })
  return { bus, markets, orchestrator, accountant }
}

const positiveSignal = (over: Partial<SentimentSignal> = {}): SentimentSignal => ({
  id: ulid(),
  marketId: 'mkt-1',
  source: 'news',
  polarity: 0.8,
  confidence: 0.8,
  freshnessSec: 30,
  summary: 'positive macro',
  ts: new Date().toISOString(),
  ...over
})

async function injectSignals(bus: InMemoryEventBus, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await bus.publish('hlpv2.sentiment', {
      type: 'sentiment.signal',
      stream: 'hlpv2.sentiment',
      source: 'test',
      correlationId: `c-${i}`,
      actorType: 'system',
      actorId: 'test',
      payload: positiveSignal({ id: `s-${i}` })
    })
    await flush()
  }
}

describe('orchestrator', () => {
  it('refuses to trade until started (mode != READY)', async () => {
    const { orchestrator } = await buildSetup()
    const r = await orchestrator.evaluateMarket('mkt-1')
    expect(r.estimate).toBeUndefined()
  })

  it('emits estimate, proposal, decision, and fill on a positive-edge market', async () => {
    const { bus, orchestrator } = await buildSetup()
    const stop = await orchestrator.start()

    await injectSignals(bus, 5)
    await flush(5)

    const estimates = await bus.readBatch('hlpv2.estimates', '0-0', 50)
    const proposals = await bus.readBatch('hlpv2.proposals', '0-0', 50)
    const decisions = await bus.readBatch('hlpv2.decisions', '0-0', 50)
    const fills = await bus.readBatch('hlpv2.fills', '0-0', 50)

    expect(estimates.length).toBeGreaterThan(0)
    expect(proposals.length).toBeGreaterThan(0)
    expect(decisions.length).toBeGreaterThan(0)
    expect(fills.length).toBeGreaterThan(0)
    expect(decisions.at(-1)!.envelope.type).toBe('risk.allow')

    await stop()
  })

  it('skips markets blocked by topicTagBlocklist', async () => {
    const bus = new InMemoryEventBus()
    const markets = new InMemoryMarketProvider([market])
    const accountant = new TestAccountant()
    const orchestrator = createOrchestrator({
      bus,
      markets,
      router: trackingRouter(accountant),
      accountant,
      riskConfig,
      marketFilter: { topicTagBlocklist: ['macro'] }
    })
    const stop = await orchestrator.start()
    await injectSignals(bus, 5)
    await flush(5)
    const proposals = await bus.readBatch('hlpv2.proposals', '0-0', 50)
    const fills = await bus.readBatch('hlpv2.fills', '0-0', 50)
    expect(proposals).toHaveLength(0)
    expect(fills).toHaveLength(0)
    await stop()
  })

  it('skips markets not in topicTagAllowlist', async () => {
    const bus = new InMemoryEventBus()
    const markets = new InMemoryMarketProvider([market])
    const accountant = new TestAccountant()
    const orchestrator = createOrchestrator({
      bus,
      markets,
      router: trackingRouter(accountant),
      accountant,
      riskConfig,
      marketFilter: { topicTagAllowlist: ['something-else'] }
    })
    const stop = await orchestrator.start()
    await injectSignals(bus, 5)
    await flush(5)
    const fills = await bus.readBatch('hlpv2.fills', '0-0', 50)
    expect(fills).toHaveLength(0)
    await stop()
  })

  it('serializes concurrent evaluations so exposure never exceeds the cap', async () => {
    const cap = 2000
    const tightConfig: RiskConfig = {
      ...riskConfig,
      maxStakePerMarketUsd: cap,
      maxGrossExposureUsd: cap
    }
    const bus = new InMemoryEventBus()
    const markets = new InMemoryMarketProvider([market])
    const accountant = new TestAccountant()
    const orchestrator = createOrchestrator({
      bus,
      markets,
      router: trackingRouter(accountant),
      accountant,
      riskConfig: tightConfig
    })
    const stop = await orchestrator.start()

    await injectSignals(bus, 5)
    await Promise.all([
      orchestrator.evaluateMarket('mkt-1'),
      orchestrator.evaluateMarket('mkt-1'),
      orchestrator.evaluateMarket('mkt-1')
    ])
    await flush(5)

    const fills = await bus.readBatch('hlpv2.fills', '0-0', 50)
    const total = fills.reduce(
      (acc, e) => acc + (e.envelope.payload as { fillSizeUsd: number }).fillSizeUsd,
      0
    )
    expect(total).toBeLessThanOrEqual(cap + 1e-6)

    await stop()
  })

  it('emits decision DENY when operator halts mid-stream', async () => {
    const haltedConfig: RiskConfig = { ...riskConfig, haltAll: true }
    const bus = new InMemoryEventBus()
    const markets = new InMemoryMarketProvider([market])
    const accountant = new TestAccountant()
    const orchestrator = createOrchestrator({
      bus,
      markets,
      router: trackingRouter(accountant),
      accountant,
      riskConfig: haltedConfig
    })
    const stop = await orchestrator.start()

    await injectSignals(bus, 5)
    await flush(5)

    const decisions = await bus.readBatch('hlpv2.decisions', '0-0', 50)
    expect(decisions.length).toBeGreaterThan(0)
    expect(decisions.at(-1)!.envelope.type).toBe('risk.deny')
    const fills = await bus.readBatch('hlpv2.fills', '0-0', 50)
    expect(fills).toHaveLength(0)

    await stop()
  })
})

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r))
  }
}
