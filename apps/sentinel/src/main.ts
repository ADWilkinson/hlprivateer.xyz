import { spawn } from 'node:child_process'
import { InMemoryEventBus, RedisEventBus, type EventBus } from '@hl/privateer-event-bus'
import { loadStrategy } from '@hl/privateer-strategy'
import {
  createSentinel,
  FixtureSource,
  LlmScorer,
  type LlmCompleter,
  type SentimentSource
} from './index'

const log = (msg: string, meta?: unknown) => console.log(`[sentinel] ${msg}`, meta ?? '')

// Shell-out completer. The operator sets SENTINEL_LLM_COMMAND to a shell
// that reads a prompt on stdin and emits the model response on stdout
// (e.g. `claude -p`, `codex`, or a wrapper script). The script's exit
// code propagates to the scorer; non-zero is a hard error per signal.
function shellCompleter(command: string): LlmCompleter {
  return (prompt) =>
    new Promise<string>((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'inherit'] })
      let out = ''
      proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`SENTINEL_LLM_COMMAND exited ${code}`))
        else resolve(out)
      })
      proc.stdin.write(prompt)
      proc.stdin.end()
    })
}

async function main(): Promise<void> {
  const strategy = await loadStrategy({ log: (m) => log(m) })

  const command = process.env.SENTINEL_LLM_COMMAND
  if (!command) {
    throw new Error(
      'SENTINEL_LLM_COMMAND is required (e.g. "claude -p"). Sentinel does not ship a fallback scorer.'
    )
  }
  const scorer = new LlmScorer(shellCompleter(command), strategy.prompts.sentimentScorer)

  const bus: EventBus = process.env.SENTINEL_REDIS_URL
    ? new RedisEventBus(process.env.SENTINEL_REDIS_URL, 'hlpv2', 'sentinel')
    : new InMemoryEventBus()

  const sources: SentimentSource[] = []
  if (process.env.SENTINEL_FIXTURE) sources.push(new FixtureSource(process.env.SENTINEL_FIXTURE))

  const sentinel = createSentinel({
    bus,
    sources,
    scorer,
    intervalMs: Number(process.env.SENTINEL_INTERVAL_MS ?? 30_000),
    log
  })

  const stop = sentinel.start()
  const shutdown = async () => {
    await stop()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('sentinel fatal', err)
  process.exit(1)
})
