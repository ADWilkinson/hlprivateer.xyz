import { InMemoryEventBus, RedisEventBus, type EventBus } from '@hl/privateer-event-bus'
import { loadStrategy } from '@hl/privateer-strategy'
import {
  createSentinel,
  FixtureSource,
  HeuristicScorer,
  LlmScorer,
  type LlmCompleter,
  type SentimentScorer,
  type SentimentSource
} from './index'

const log = (msg: string, meta?: unknown) => console.log(`[sentinel] ${msg}`, meta ?? '')

// Resolve a completer when the operator wires one in. Until then, sentinel
// runs the deterministic HeuristicScorer. Override this in your private
// fork/build step if you want the LlmScorer to fire.
function resolveCompleter(): LlmCompleter | undefined {
  return undefined
}

async function main(): Promise<void> {
  const strategy = await loadStrategy({ log: (m) => log(m) })

  const bus: EventBus = process.env.SENTINEL_REDIS_URL
    ? new RedisEventBus(process.env.SENTINEL_REDIS_URL, 'hlpv2', 'sentinel')
    : new InMemoryEventBus()

  const sources: SentimentSource[] = []
  if (process.env.SENTINEL_FIXTURE) sources.push(new FixtureSource(process.env.SENTINEL_FIXTURE))

  const completer = resolveCompleter()
  const scorer: SentimentScorer = completer
    ? new LlmScorer(completer, strategy.prompts.sentimentScorer)
    : new HeuristicScorer()

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
