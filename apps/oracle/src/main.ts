import { InMemoryEventBus, RedisEventBus, type EventBus } from '@hl/privateer-event-bus'
import type { ProbabilityEstimate } from '@hl/privateer-contracts'
import { createHlClient } from '@hl/privateer-hl-client'
import { loadStrategy } from '@hl/privateer-strategy'
import {
  createOrchestrator,
  DryRunRouter,
  FixtureMarketProvider,
  HyperliquidAccountant,
  LocalAccountant,
  startHttpServer,
  type Accountant
} from './index'

const log = (msg: string, meta?: unknown) => console.log(`[oracle] ${msg}`, meta ?? '')

async function main(): Promise<void> {
  const strategy = await loadStrategy({ log: (m) => log(m) })

  const bus: EventBus = process.env.ORACLE_REDIS_URL
    ? new RedisEventBus(process.env.ORACLE_REDIS_URL, 'hlpv2', 'oracle')
    : new InMemoryEventBus()

  const markets = new FixtureMarketProvider(
    process.env.ORACLE_FIXTURE_MARKETS ?? './apps/oracle/fixtures/markets.json'
  )

  const accountant = makeAccountant()

  const orchestrator = createOrchestrator({
    bus,
    markets,
    router: new DryRunRouter(),
    accountant,
    riskConfig: strategy.risk,
    engine: {
      halfLifeSec: strategy.estimation.halfLifeSec,
      evidenceWeight: strategy.estimation.evidenceWeight,
      sourceTrust: strategy.sources.trust
    },
    marketFilter: strategy.marketFilter,
    log
  })

  const estimates = new Map<string, { pHat: number; edge: number }>()
  await bus.consume('hlpv2.estimates', '$', async (env) => {
    const e = env.payload as ProbabilityEstimate
    estimates.set(e.marketId, { pHat: e.pHat, edge: e.edge })
  })

  const stop = await orchestrator.start()
  const port = Number(process.env.ORACLE_HTTP_PORT ?? 4100)
  const operatorToken = process.env.ORACLE_OPERATOR_TOKEN
  if (!operatorToken) log('ORACLE_OPERATOR_TOKEN unset — /v1/operator/* disabled')
  const pnlBaselineUsd = process.env.ORACLE_PNL_BASELINE_USD
    ? Number(process.env.ORACLE_PNL_BASELINE_USD)
    : undefined
  const http = startHttpServer({
    port,
    orchestrator,
    markets,
    bus,
    estimates,
    accountant,
    pnlBaselineUsd,
    operatorToken
  })
  log(`http listening on :${port}`)

  const shutdown = async () => {
    await stop()
    http.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

// HL is the source of truth for accountancy when ORACLE_HL_USER is set.
// Without it (dev / DryRun) we keep a local accountant whose state is
// driven by simulated fills.
function makeAccountant(): Accountant {
  const user = process.env.ORACLE_HL_USER
  if (!user) {
    log('accountant: LocalAccountant (set ORACLE_HL_USER for HL-backed reads)')
    return new LocalAccountant()
  }
  const hl = createHlClient({
    isTestnet: process.env.ORACLE_HL_TESTNET === '1',
    apiUrl: process.env.ORACLE_HL_API_URL,
    infoUrl: process.env.ORACLE_HL_INFO_URL,
    timeout: 10_000,
    tokensPerMinute: Number(process.env.ORACLE_HL_RPM ?? 1000)
  })
  return new HyperliquidAccountant({
    hl,
    user,
    ttlMs: Number(process.env.ORACLE_HL_TTL_MS ?? 4000),
    log
  })
}

main().catch((err) => {
  console.error('oracle fatal', err)
  process.exit(1)
})
