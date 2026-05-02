import { describe, expect, it } from 'vitest'
import { ulid } from 'ulid'
import { InMemoryEventBus } from '@hl/privateer-event-bus'
import type { OutcomeMarket, RiskConfig, SentimentSignal } from '@hl/privateer-contracts'
import { createOrchestrator } from './orchestrator'
import { InMemoryMarketProvider } from './markets'
import { DryRunRouter } from './order-router'

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
  const router = new DryRunRouter()
  const orchestrator = createOrchestrator({ bus, markets, router, riskConfig })
  return { bus, markets, orchestrator }
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
    const orchestrator = createOrchestrator({
      bus,
      markets,
      router: new DryRunRouter(),
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
    const orchestrator = createOrchestrator({
      bus,
      markets,
      router: new DryRunRouter(),
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
    // The invariant: under any concurrency, total filled exposure ≤
    // maxGrossExposureUsd. Without the mutex, two concurrent evals both
    // see pre-fill exposure and would over-fill. With it, each successive
    // eval observes the updated ledger.
    const cap = 2000
    const tightConfig: RiskConfig = {
      ...riskConfig,
      maxStakePerMarketUsd: cap,
      maxGrossExposureUsd: cap
    }
    const bus = new InMemoryEventBus()
    const markets = new InMemoryMarketProvider([market])
    const router = new DryRunRouter()
    const orchestrator = createOrchestrator({ bus, markets, router, riskConfig: tightConfig })
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
    const router = new DryRunRouter()
    const orchestrator = createOrchestrator({ bus, markets, router, riskConfig: haltedConfig })
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
