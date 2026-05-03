import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ulid } from 'ulid'
import type { Accountant, OpenPosition } from './accountant'
import type {
  AgentProposal,
  OutcomeFill,
  OutcomeMarket,
  OutcomeProposal,
  SentimentItem
} from './contracts'
import type { OutcomeMarketProvider, OrderRouter } from './orchestrator'
import { FixedAgent, type StrategyAgent } from './strategy'
import { FixtureSource, type SentimentSourceAdapter } from './sources'

const DEMO_FIXTURE_CANDIDATES = [
  'apps/agent/fixtures/demo-signals.json',
  'fixtures/demo-signals.json'
]

function defaultDemoFixturePath(): string {
  for (const candidate of DEMO_FIXTURE_CANDIDATES) {
    const path = resolve(candidate)
    if (existsSync(path)) return path
  }
  return resolve(DEMO_FIXTURE_CANDIDATES[0])
}

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

function demoMarkets(): OutcomeMarket[] {
  return [
    {
      id: 'demo-fed-pause-sep',
      question: 'Will the Fed pause at the September meeting?',
      description: 'Local demo market for the public floor.',
      resolutionAt: isoFromNow(45 * 24 * 3600 * 1000),
      challengeWindowSec: 0,
      status: 'trading',
      yesPrice: 0.62,
      bookDepthYesUsd: 5_000,
      bookDepthNoUsd: 4_800,
      topicTags: ['macro', 'fed', 'rates'],
      updatedAt: new Date().toISOString()
    },
    {
      id: 'demo-btc-etf-flows',
      question: 'Will weekly BTC ETF net flows finish positive?',
      description: 'Local demo market for the public floor.',
      resolutionAt: isoFromNow(10 * 24 * 3600 * 1000),
      challengeWindowSec: 0,
      status: 'trading',
      yesPrice: 0.54,
      bookDepthYesUsd: 3_200,
      bookDepthNoUsd: 3_600,
      topicTags: ['crypto', 'btc', 'flows'],
      updatedAt: new Date().toISOString()
    },
    {
      id: 'demo-inflation-print',
      question: 'Will the next CPI print come in below consensus?',
      description: 'Local demo market for the public floor.',
      resolutionAt: isoFromNow(18 * 24 * 3600 * 1000),
      challengeWindowSec: 0,
      status: 'trading',
      yesPrice: 0.47,
      bookDepthYesUsd: 2_600,
      bookDepthNoUsd: 2_900,
      topicTags: ['macro', 'inflation'],
      updatedAt: new Date().toISOString()
    }
  ]
}

export class DemoMarketProvider implements OutcomeMarketProvider {
  async list(): Promise<OutcomeMarket[]> {
    return demoMarkets()
  }

  async get(id: string): Promise<OutcomeMarket | undefined> {
    return demoMarkets().find((market) => market.id === id)
  }
}

export class DemoAccountant implements Accountant {
  private positionsByMarket = new Map<string, OpenPosition>()
  private marketTags = new Map<string, string[]>()

  recordMarket(market: OutcomeMarket): void {
    this.marketTags.set(market.id, market.topicTags)
  }

  applyFill(fill: OutcomeFill): void {
    const existing = this.positionsByMarket.get(fill.marketId)
    if (!existing) {
      this.positionsByMarket.set(fill.marketId, {
        marketId: fill.marketId,
        side: fill.side,
        sizeUsd: fill.fillSizeUsd
      })
      return
    }
    if (existing.side === fill.side) existing.sizeUsd += fill.fillSizeUsd
  }

  async positions(): Promise<readonly OpenPosition[]> {
    return [...this.positionsByMarket.values()]
  }

  async equityUsd(): Promise<number> {
    return 1_000
  }

  async openExposureUsd(): Promise<number> {
    let exposure = 0
    for (const position of this.positionsByMarket.values()) exposure += position.sizeUsd
    return exposure
  }

  async openMarketCount(): Promise<number> {
    return this.positionsByMarket.size
  }

  async clusterExposureUsd(market: OutcomeMarket): Promise<number> {
    if (market.topicTags.length === 0) return 0
    const tags = new Set(market.topicTags)
    let exposure = 0
    for (const position of this.positionsByMarket.values()) {
      if (position.marketId === market.id) continue
      const otherTags = this.marketTags.get(position.marketId) ?? []
      if (otherTags.some((tag) => tags.has(tag))) exposure += position.sizeUsd
    }
    return exposure
  }

  async warmup(): Promise<void> {}
}

export class DemoOrderRouter implements OrderRouter {
  constructor(private readonly accountant: DemoAccountant) {}

  async place(proposal: OutcomeProposal): Promise<OutcomeFill> {
    const fill: OutcomeFill = {
      id: `f-${ulid()}`,
      proposalId: proposal.id,
      marketId: proposal.marketId,
      side: proposal.side,
      fillPrice: proposal.limitPrice,
      fillSizeUsd: proposal.sizeUsd,
      feeUsd: 0,
      ts: new Date().toISOString()
    }
    this.accountant.applyFill(fill)
    return fill
  }
}

function demoProposal(ctx: { market: OutcomeMarket; signals: readonly SentimentItem[] }): AgentProposal | null {
  if (ctx.signals.length === 0) return null
  const freshest = ctx.signals
    .slice()
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]
  return {
    side: 'YES',
    pHat: Math.min(0.95, ctx.market.yesPrice + 0.08),
    sizeUsd: 200,
    limitPrice: ctx.market.yesPrice,
    thesis: 'local demo: sentiment skew clears the market price',
    signalsConsideredAt: freshest.observedAt
  }
}

export interface DemoRuntime {
  agent: StrategyAgent
  markets: OutcomeMarketProvider
  router: OrderRouter
  accountant: DemoAccountant
  sources: SentimentSourceAdapter[]
}

export function createDemoRuntime(fixturePath = defaultDemoFixturePath()): DemoRuntime {
  const accountant = new DemoAccountant()
  return {
    agent: new FixedAgent(demoProposal),
    markets: new DemoMarketProvider(),
    router: new DemoOrderRouter(accountant),
    accountant,
    sources: [new FixtureSource(fixturePath)]
  }
}
