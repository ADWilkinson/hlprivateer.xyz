import { ulid } from 'ulid'
import type { EventBus } from '@hl/privateer-event-bus'
import type { SentimentSignal } from '@hl/privateer-contracts'
import { SentimentSignalSchema } from '@hl/privateer-contracts'
import type { SentimentScorer } from './scorer'
import type { SentimentSource } from './sources'

export type { RawSentimentItem, SentimentScorer, ScoredSentiment, LlmCompleter } from './scorer'
export { HeuristicScorer, LlmScorer, parseScore } from './scorer'
export { FixtureSource, InMemorySource } from './sources'
export type { SentimentSource } from './sources'

export interface SentinelConfig {
  bus: EventBus
  sources: readonly SentimentSource[]
  scorer: SentimentScorer
  marketContext?: (marketId: string) => Promise<{ question: string } | undefined>
  intervalMs?: number
  log?: (msg: string, meta?: unknown) => void
}

export interface SentinelHandle {
  tick(): Promise<number>
  start(): () => Promise<void>
}

export function createSentinel(config: SentinelConfig): SentinelHandle {
  const interval = config.intervalMs ?? 30_000
  const log = config.log ?? (() => undefined)

  async function tick(): Promise<number> {
    let emitted = 0
    for (const source of config.sources) {
      let items: Awaited<ReturnType<typeof source.poll>>
      try {
        items = await source.poll()
      } catch (err) {
        log(`source ${source.name} failed`, err)
        continue
      }
      for (const item of items) {
        try {
          const ctx = config.marketContext ? await config.marketContext(item.marketId) : undefined
          const scored = await config.scorer.score(item, ctx)
          const observedMs = Date.parse(item.observedAt)
          const freshnessSec = Number.isFinite(observedMs)
            ? Math.max(0, Math.floor((Date.now() - observedMs) / 1000))
            : 0
          const signal: SentimentSignal = SentimentSignalSchema.parse({
            id: ulid(),
            marketId: item.marketId,
            source: item.source,
            polarity: scored.polarity,
            confidence: scored.confidence,
            freshnessSec,
            summary: item.summary.slice(0, 500),
            url: item.url,
            ts: new Date().toISOString()
          })
          await config.bus.publish<SentimentSignal>('hlpv2.sentiment', {
            type: 'sentiment.signal',
            stream: 'hlpv2.sentiment',
            source: `sentinel:${source.name}`,
            correlationId: signal.id,
            actorType: 'system',
            actorId: 'sentinel',
            payload: signal
          })
          emitted++
        } catch (err) {
          log(`scoring/publishing failed`, { item, err: String(err) })
        }
      }
    }
    if (emitted > 0) log(`emitted ${emitted} signals`)
    return emitted
  }

  function start(): () => Promise<void> {
    let running = true
    void (async () => {
      while (running) {
        try {
          await tick()
        } catch (err) {
          log(`tick failed`, err)
        }
        await new Promise((res) => setTimeout(res, interval))
      }
    })()
    return async () => {
      running = false
    }
  }

  return { tick, start }
}
