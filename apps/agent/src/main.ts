import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { HyperliquidAccountant, type Accountant } from './accountant'
import { AuditLog } from './audit'
import { createHlClient, type HlClient } from './hl'
import { createOrchestrator, type OrderRouter, type OutcomeMarketProvider } from './orchestrator'
import { FixtureSource, type SentimentSourceAdapter } from './sources'
import { loadStrategy } from './strategy-config'
import { LlmStrategyAgent, type LlmCompleter, type StrategyAgent } from './strategy'
import { startHttpServer } from './http'
import { createDemoRuntime } from './demo'

const log = (msg: string, meta?: unknown) => console.log(`[agent] ${msg}`, meta ?? '')

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required`)
  return v
}

// Shell-out completer. The operator sets AGENT_LLM_COMMAND to a shell that
// reads a prompt on stdin and emits the model response on stdout (e.g.
// `claude -p`, `codex`, or a wrapper script). Non-zero exit propagates as
// an evaluation-level error - the orchestrator skips the proposal.
function shellCompleter(command: string): LlmCompleter {
  return (prompt) =>
    new Promise<string>((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'inherit'] })
      let out = ''
      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`AGENT_LLM_COMMAND exited ${code}`))
        else resolve(out)
      })
      proc.stdin.write(prompt)
      proc.stdin.end()
    })
}

async function loadWiring(hl: HlClient): Promise<{
  markets: OutcomeMarketProvider
  router: OrderRouter
}> {
  const path = resolve(process.env.AGENT_WIRING ?? 'apps/agent/wiring.ts')
  if (!existsSync(path)) {
    throw new Error(
      `agent wiring not found at ${path}. Copy apps/agent/wiring.template.ts and implement makeMarketProvider + makeOrderRouter against HL.`
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

  let agent: StrategyAgent
  let accountant: Accountant
  let markets: OutcomeMarketProvider
  let router: OrderRouter
  let sources: SentimentSourceAdapter[] = []

  if (process.env.AGENT_DEMO === '1') {
    const demo = createDemoRuntime(process.env.AGENT_FIXTURE)
    agent = demo.agent
    accountant = demo.accountant
    markets = demo.markets
    router = demo.router
    sources = demo.sources
    log('demo mode enabled — using fixture markets, fixture sentiment, and in-memory fills')
  } else {
    const command = process.env.AGENT_LLM_COMMAND
    if (!command) {
      throw new Error(
        'AGENT_LLM_COMMAND is required (e.g. "claude -p"). The agent does not ship a fallback strategist.'
      )
    }
    agent = new LlmStrategyAgent(shellCompleter(command), strategy.prompts.strategist)

    const hl = createHlClient({
      isTestnet: process.env.AGENT_HL_TESTNET === '1',
      infoUrl: process.env.AGENT_HL_INFO_URL,
      timeoutMs: 10_000
    })

    accountant = new HyperliquidAccountant({
      hl,
      user: requireEnv('AGENT_HL_USER'),
      ttlMs: Number(process.env.AGENT_HL_TTL_MS ?? 4000),
      log
    })

    const wiring = await loadWiring(hl)
    markets = wiring.markets
    router = wiring.router
    if (process.env.AGENT_FIXTURE) sources.push(new FixtureSource(process.env.AGENT_FIXTURE))
  }

  const audit = new AuditLog(process.env.AGENT_AUDIT_PATH ?? 'data/audit.jsonl')

  const orchestrator = createOrchestrator({
    agent,
    markets,
    router,
    accountant,
    riskConfig: strategy.risk,
    marketFilter: strategy.marketFilter,
    audit,
    log
  })

  const stop = await orchestrator.start()

  const intervalMs = Number(process.env.AGENT_INTERVAL_MS ?? 30_000)
  let running = true
  void (async () => {
    while (running) {
      for (const source of sources) {
        try {
          for (const item of await source.poll()) {
            await orchestrator.ingest(item)
          }
        } catch (err) {
          log(`source ${source.name} failed`, err)
        }
      }
      await new Promise((res) => setTimeout(res, intervalMs))
    }
  })()

  const port = Number(process.env.AGENT_HTTP_PORT ?? 4100)
  const operatorToken = process.env.AGENT_OPERATOR_TOKEN
  if (!operatorToken) log('AGENT_OPERATOR_TOKEN unset — /v1/operator/* disabled')
  const pnlBaselineUsd = process.env.AGENT_PNL_BASELINE_USD
    ? Number(process.env.AGENT_PNL_BASELINE_USD)
    : undefined
  const http = startHttpServer({
    port,
    orchestrator,
    markets,
    accountant,
    pnlBaselineUsd,
    operatorToken
  })
  log(`http listening on :${port}`)

  const shutdown = async () => {
    running = false
    await stop()
    http.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('agent fatal', err)
  process.exit(1)
})
