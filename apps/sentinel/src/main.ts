// Sentinel entry point. In dev: in-memory bus + fixture source + heuristic
// scorer. In prod: env-driven Redis bus + real sources + LLM scorer.

import { InMemoryEventBus, RedisEventBus, type EventBus } from '@hl/privateer-event-bus'
import { createSentinel, FixtureSource, HeuristicScorer, type SentimentSource } from './index'

async function main(): Promise<void> {
  const bus: EventBus = process.env.SENTINEL_REDIS_URL
    ? new RedisEventBus(process.env.SENTINEL_REDIS_URL, 'hlpv2', 'sentinel')
    : new InMemoryEventBus()

  const sources: SentimentSource[] = []
  if (process.env.SENTINEL_FIXTURE) {
    sources.push(new FixtureSource(process.env.SENTINEL_FIXTURE))
  }
  if (sources.length === 0) {
    console.log('sentinel: no sources configured; idle')
  }

  const sentinel = createSentinel({
    bus,
    sources,
    scorer: new HeuristicScorer(),
    intervalMs: Number(process.env.SENTINEL_INTERVAL_MS ?? 30_000),
    log: (msg, meta) => console.log(`[sentinel] ${msg}`, meta ?? '')
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
