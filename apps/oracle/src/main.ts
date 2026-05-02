import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { InMemoryEventBus, RedisEventBus, type EventBus } from '@hl/privateer-event-bus'
import type { ProbabilityEstimate } from '@hl/privateer-contracts'
import { createHlClient, type HlClient } from '@hl/privateer-hl-client'
import { loadStrategy } from '@hl/privateer-strategy'
import {
  createOrchestrator,
  HyperliquidAccountant,
  startHttpServer,
  type OrderRouter,
  type OutcomeMarketProvider
} from './index'

const log = (msg: string, meta?: unknown) => console.log(`[oracle] ${msg}`, meta ?? '')

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required`)
  return v
}

async function loadWiring(hl: HlClient): Promise<{
  markets: OutcomeMarketProvider
  router: OrderRouter
}> {
  const path = resolve(process.env.ORACLE_WIRING ?? 'apps/oracle/wiring.ts')
  if (!existsSync(path)) {
    throw new Error(
      `oracle wiring not found at ${path}. Copy apps/oracle/wiring.template.ts and implement makeMarketProvider + makeOrderRouter against HL.`
    )
  }
  const mod = (await import(path)) as {
    makeMarketProvider: (hl: HlClient) => OutcomeMarketProvider
    makeOrderRouter: (hl: HlClient) => OrderRouter
  }
  return { markets: mod.makeMarketProvider(hl), router: mod.makeOrderRouter(hl) }
}

async function main(): Promise<void> {
  const strategy = await loadStrategy({ log: (m) => log(m) })

  const hl = createHlClient({
    isTestnet: process.env.ORACLE_HL_TESTNET === '1',
    apiUrl: process.env.ORACLE_HL_API_URL,
    infoUrl: process.env.ORACLE_HL_INFO_URL,
    timeout: 10_000,
    tokensPerMinute: Number(process.env.ORACLE_HL_RPM ?? 1000)
  })

  const accountant = new HyperliquidAccountant({
    hl,
    user: requireEnv('ORACLE_HL_USER'),
    ttlMs: Number(process.env.ORACLE_HL_TTL_MS ?? 4000),
    log
  })

  const { markets, router } = await loadWiring(hl)

  const bus: EventBus = process.env.ORACLE_REDIS_URL
    ? new RedisEventBus(process.env.ORACLE_REDIS_URL, 'hlpv2', 'oracle')
    : new InMemoryEventBus()

  const orchestrator = createOrchestrator({
    bus,
    markets,
    router,
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

main().catch((err) => {
  console.error('oracle fatal', err)
  process.exit(1)
})
