import { InMemoryEventBus, RedisEventBus, type EventBus } from '@hl/privateer-event-bus'
import type { ProbabilityEstimate } from '@hl/privateer-contracts'
import { loadStrategy } from '@hl/privateer-strategy'
import { createOrchestrator, FixtureMarketProvider, DryRunRouter, startHttpServer } from './index'

const log = (msg: string, meta?: unknown) => console.log(`[oracle] ${msg}`, meta ?? '')

async function main(): Promise<void> {
  const strategy = await loadStrategy({ log: (m) => log(m) })

  const bus: EventBus = process.env.ORACLE_REDIS_URL
    ? new RedisEventBus(process.env.ORACLE_REDIS_URL, 'hlpv2', 'oracle')
    : new InMemoryEventBus()

  const markets = new FixtureMarketProvider(
    process.env.ORACLE_FIXTURE_MARKETS ?? './apps/oracle/fixtures/markets.json'
  )
  const orchestrator = createOrchestrator({
    bus,
    markets,
    router: new DryRunRouter(),
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
  const http = startHttpServer({ port, orchestrator, markets, bus, estimates, operatorToken })
  log(`http listening on :${port}`)

  const shutdown = async () => {
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
