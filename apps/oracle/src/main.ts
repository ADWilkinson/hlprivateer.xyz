// Oracle entry point. In dev: in-memory bus + fixture markets + DryRunRouter.
// In prod: env-driven Redis bus + HL provider + HyperliquidOrderRouter.

import {
  InMemoryEventBus,
  RedisEventBus,
  type EventBus
} from '@hl/privateer-event-bus'
import type { ProbabilityEstimate, RiskConfig } from '@hl/privateer-contracts'
import { createOrchestrator, FixtureMarketProvider, DryRunRouter, startHttpServer } from './index'

const DEFAULT_RISK: RiskConfig = {
  maxSentimentAgeSec: 900,
  minSecondsToResolution: 3600,
  maxSecondsToResolution: 60 * 24 * 3600,
  challengeWindowBufferSec: 0,
  bankrollUsd: Number(process.env.ORACLE_BANKROLL_USD ?? 10_000),
  maxStakePerMarketUsd: Number(process.env.ORACLE_MAX_STAKE_PER_MARKET_USD ?? 250),
  maxConcurrentMarkets: Number(process.env.ORACLE_MAX_CONCURRENT_MARKETS ?? 10),
  maxGrossExposureUsd: Number(process.env.ORACLE_MAX_GROSS_USD ?? 2_500),
  maxCorrelatedClusterUsd: Number(process.env.ORACLE_MAX_CLUSTER_USD ?? 1_000),
  minEdgeBps: Number(process.env.ORACLE_MIN_EDGE_BPS ?? 200),
  minBookDepthUsd: Number(process.env.ORACLE_MIN_BOOK_DEPTH_USD ?? 250),
  kellyCap: Number(process.env.ORACLE_KELLY_CAP ?? 0.2),
  haltAll: false
}

async function main(): Promise<void> {
  const bus: EventBus = process.env.ORACLE_REDIS_URL
    ? new RedisEventBus(process.env.ORACLE_REDIS_URL, 'hlpv2', 'oracle')
    : new InMemoryEventBus()

  const fixturePath = process.env.ORACLE_FIXTURE_MARKETS ?? './apps/oracle/fixtures/markets.json'
  const markets = new FixtureMarketProvider(fixturePath)
  const router = new DryRunRouter()

  const orchestrator = createOrchestrator({
    bus,
    markets,
    router,
    riskConfig: DEFAULT_RISK,
    log: (msg, meta) => console.log(`[oracle] ${msg}`, meta ?? '')
  })

  const estimates = new Map<string, { pHat: number; edge: number }>()
  await bus.consume('hlpv2.estimates', '$', async (env) => {
    const e = env.payload as ProbabilityEstimate
    estimates.set(e.marketId, { pHat: e.pHat, edge: e.edge })
  })

  const stop = await orchestrator.start()
  const port = Number(process.env.ORACLE_HTTP_PORT ?? 4100)
  const http = startHttpServer({ port, orchestrator, markets, estimates })
  console.log(`[oracle] http listening on :${port}`)

  const shutdown = async () => {
    console.log('[oracle] shutdown')
    await stop()
    http.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('oracle fatal', err)
  process.exit(1)
})
