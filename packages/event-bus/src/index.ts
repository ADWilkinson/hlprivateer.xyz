import EventEmitter from 'node:events'
import Redis from 'ioredis'
import { ulid } from 'ulid'
import {
  EventEnvelope,
  EventEnvelopeSchema,
  StreamName,
  StreamNameSchema
} from '@hl/privateer-contracts'

type EnvelopeInput<T> = Omit<EventEnvelope<T>, 'id' | 'ts'> & { ts?: string }
type EnvelopeRecord = EventEnvelope<unknown>

type RedisReadResult = [string, [string, string[]][]][]

export interface EventBus {
  publish<T>(stream: StreamName, event: EnvelopeInput<T>): Promise<string>
  readBatch(stream: StreamName, fromId: string, count?: number): Promise<Array<{ id: string; envelope: EnvelopeRecord }>>
  consume(
    stream: StreamName,
    startId: string,
    onMessage: (envelope: EnvelopeRecord) => Promise<void> | void
  ): Promise<() => Promise<void>>
  replay(
    stream: StreamName,
    fromTs: string,
    toTs: string,
    onMessage: (envelope: EnvelopeRecord) => Promise<boolean | void> | boolean | void
  ): Promise<void>
  health(): Promise<{ ok: boolean; mode: 'redis' | 'memory'; reason?: string }>
}

export interface RedisEventBusConfig {
  redisUrl?: string
  streamPrefix?: string
  consumerGroup?: string
}

const defaultStreamPrefix = 'hlp'

/**
 * Approximate MAXLEN caps per stream. Keeps Redis bounded without losing
 * data that consumers actually need.  `0` means no trim (audit/compliance).
 *
 * market.normalized  ~5 msg/s → 72 000 ≈ 4 h
 * ui.events          bursty   → 50 000 ≈ 30-60 min
 * audit.events       replay   → 0 (never trim – operator compliance)
 * execution.*        low vol  → 100 000 ≈ months
 * everything else    low vol  → 10 000
 */
const streamMaxLen: Partial<Record<StreamName, number>> = {
  'hlp.market.normalized': 72_000,
  'hlp.market.watchlist': 10_000,
  'hlp.strategy.proposals': 10_000,
  'hlp.plugin.signals': 10_000,
  'hlp.risk.decisions': 10_000,
  'hlp.execution.commands': 100_000,
  'hlp.execution.fills': 100_000,
  'hlp.audit.events': 0,
  'hlp.ui.events': 50_000,
  'hlp.payments.events': 10_000,
  'hlp.commands': 10_000,
}

function normalizeBound(value: string): string {
  if (/^\d{2,}-\d+$/.test(value)) {
    return value
  }

  const ms = Date.parse(value)
  if (!Number.isNaN(ms)) {
    return `${ms}-0`
  }

  return value
}

function normalizeReplayTo(value: string): string {
  if (/^\d{2,}-\d+$/.test(value)) {
    return value
  }

  const ms = Date.parse(value)
  if (!Number.isNaN(ms)) {
    return `${ms}-9999`
  }

  return value
}

function extractPayload(fields: string[]): string | undefined {
  const payloadIndex = fields.indexOf('payload')
  if (payloadIndex >= 0 && fields.length > payloadIndex + 1) {
    return fields[payloadIndex + 1]
  }

  return undefined
}

function parseEnvelope(raw: string): EnvelopeRecord | null {
  try {
    return EventEnvelopeSchema.parse(JSON.parse(raw)) as EnvelopeRecord
  } catch (error) {
    console.warn(`event-bus: dropping malformed envelope`, raw, String(error))
    return null
  }
}

export interface AuditArchiver {
  (envelope: EventEnvelope<unknown>): Promise<void>
}

export interface AuditArchiveResult {
  archived: number
  trimmedUpTo: string | null
}

export class RedisEventBus implements EventBus {
  private redis: Redis
  private prefix: string
  private consumerGroup: string

  constructor(redisUrl = 'redis://127.0.0.1:6379', streamPrefix = defaultStreamPrefix, consumerGroup = 'runtime') {
    this.redis = new Redis(redisUrl)
    this.prefix = streamPrefix
    this.consumerGroup = consumerGroup
  }

  private stream(stream: StreamName): string {
    StreamNameSchema.parse(stream)
    // StreamName values already include the 'hlp.' prefix (e.g. 'hlp.audit.events'),
    // so only prepend the configured prefix when it differs from the default embedded one.
    if (this.prefix === defaultStreamPrefix && stream.startsWith(`${defaultStreamPrefix}.`)) {
      return stream
    }
    return `${this.prefix}.${stream}`
  }

  /**
   * Archive audit events older than `retainMs` from Redis into a persistent
   * store (e.g. Postgres) via the provided callback function, then trim the
   * archived entries from the stream.
   *
   * Designed to be called periodically (e.g. every 6 hours).
   */
  async archiveAuditStream(
    archiver: AuditArchiver,
    retainMs = 7 * 24 * 60 * 60 * 1000
  ): Promise<AuditArchiveResult> {
    const key = this.stream('hlp.audit.events')
    const cutoffMs = Date.now() - retainMs
    const cutoffId = `${cutoffMs}-0`
    const batchSize = 500
    let cursor = '-'
    let archived = 0
    let lastArchivedId: string | null = null

    while (true) {
      const entries = await this.redis.xrange(key, cursor, cutoffId, 'COUNT', String(batchSize))
      if (entries.length === 0) break

      for (const [id, fields] of entries) {
        const raw = extractPayload(fields)
        if (!raw) continue
        const envelope = parseEnvelope(raw)
        if (!envelope) continue
        await archiver(envelope)
        lastArchivedId = id
        archived++
      }

      cursor = `(${entries[entries.length - 1][0]}`
    }

    if (lastArchivedId) {
      await this.redis.xtrim(key, 'MINID', lastArchivedId)
    }

    return { archived, trimmedUpTo: lastArchivedId }
  }

  async publish<T>(stream: StreamName, event: EnvelopeInput<T>): Promise<string> {
    const envelope: EventEnvelope<T> = {
      id: ulid(),
      ts: event.ts ?? new Date().toISOString(),
      stream,
      type: event.type,
      source: event.source,
      correlationId: event.correlationId,
      causationId: event.causationId,
      actorType: event.actorType,
      actorId: event.actorId,
      payload: event.payload,
      signature: event.signature,
      riskMode: event.riskMode,
      sensitive: event.sensitive
    }

    EventEnvelopeSchema.parse(envelope)
    const key = this.stream(stream)
    const maxLen = streamMaxLen[stream] ?? 0
    if (maxLen > 0) {
      await this.redis.xadd(key, 'MAXLEN', '~', String(maxLen), '*', 'payload', JSON.stringify(envelope))
    } else {
      await this.redis.xadd(key, '*', 'payload', JSON.stringify(envelope))
    }
    return envelope.id
  }

  async readBatch(stream: StreamName, fromId: string, count = 100): Promise<Array<{ id: string; envelope: EnvelopeRecord }>> {
    const entries = await this.redis.xrange(this.stream(stream), normalizeBound(fromId), '+', 'COUNT', String(count))
    return entries.map(([id, fields]) => {
      const raw = extractPayload(fields)
      if (!raw) {
        console.warn('event-bus: skipping malformed stream entry', id)
        return undefined
      }
      const envelope = parseEnvelope(raw)
      if (!envelope) {
        return undefined
      }
      return { id, envelope }
    })
    .filter((item): item is { id: string; envelope: EnvelopeRecord } => Boolean(item))
  }

  async consume(
    stream: StreamName,
    startId: string,
    onMessage: (envelope: EnvelopeRecord) => Promise<void> | void
  ): Promise<() => Promise<void>> {
    const streamName = this.stream(stream)
    let running = true
    let cursor = startId
    // Use a dedicated connection for blocking XREAD so publishes/healthchecks are not delayed.
    const reader = this.redis.duplicate()

    // `$` means "new entries only", but polling with `$` can miss messages between calls.
    // Convert `$` to the current stream tail once, then always advance from concrete IDs.
    if (cursor === '$') {
      try {
        const last = await reader.xrevrange(streamName, '+', '-', 'COUNT', 1)
        cursor = last.length > 0 ? last[0][0] : '0-0'
      } catch (error) {
        console.warn('event-bus: failed to resolve stream tail for $ cursor', {
          stream: streamName,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        })
        cursor = '0-0'
      }
    }

    let consecutiveErrors = 0
    const MAX_BACKOFF_MS = 10_000

    const loop = async () => {
      while (running) {
        try {
          const result = (await reader.xread(
            'COUNT',
            50,
            'BLOCK',
            2000,
            'STREAMS',
            streamName,
            normalizeBound(cursor)
          )) as RedisReadResult | null

          consecutiveErrors = 0

          if (!result) {
            continue
          }

          const [, rows] = result[0]
          for (const row of rows) {
            const [id, fields] = row
            cursor = id
            const payload = extractPayload(fields)
            if (!payload) {
              console.warn('event-bus: skipping malformed stream entry', id)
              continue
            }

            const envelope = parseEnvelope(payload)
            if (!envelope) {
              continue
            }

            await onMessage(envelope)
          }
        } catch (error) {
          consecutiveErrors += 1
          const backoffMs = Math.min(MAX_BACKOFF_MS, 500 * (2 ** (consecutiveErrors - 1)))
          console.warn(`event-bus: consumer error on ${String(streamName)} (attempt ${consecutiveErrors}, retry in ${backoffMs}ms)`, error instanceof Error ? error.message : String(error))
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
        }
      }
    }

    void loop()

    return async () => {
      running = false
      await reader.quit().catch(() => undefined)
    }
  }

  async replay(
    stream: StreamName,
    fromTs: string,
    toTs: string,
    onMessage: (envelope: EnvelopeRecord) => Promise<boolean | void> | boolean | void
  ): Promise<void> {
    const from = Date.parse(fromTs)
    const to = Date.parse(toTs)

    const streamName = this.stream(stream)
    const batchSize = 1000
    let cursor = '-'

    while (true) {
      const entries = await this.redis.xrange(streamName, cursor, '+', 'COUNT', String(batchSize))
      if (entries.length === 0) {
        break
      }

      for (const [, fields] of entries) {
        const envelopePayload = extractPayload(fields)
        if (!envelopePayload) {
          continue
        }

        const envelope = parseEnvelope(envelopePayload)
        if (!envelope) {
          continue
        }

        const eventTs = Date.parse(envelope.ts)
        const afterFrom = Number.isNaN(from) || eventTs >= from
        const beforeTo = Number.isNaN(to) || eventTs <= to
        if (!afterFrom || !beforeTo) {
          continue
        }

        const shouldContinue = await onMessage(envelope)
        if (shouldContinue === false) {
          return
        }
      }

      const lastId = entries[entries.length - 1][0]
      cursor = `(${lastId}`
    }
  }

  async health(): Promise<{ ok: boolean; mode: 'redis' | 'memory'; reason?: string }> {
    try {
      await this.redis.ping()
      return { ok: true, mode: 'redis' }
    } catch (error) {
      return { ok: false, mode: 'memory', reason: String(error) }
    }
  }
}

interface InMemoryEntry {
  id: string
  envelope: EnvelopeRecord
}

export class InMemoryEventBus implements EventBus {
  private emitter = new EventEmitter()
  private streams = new Map<string, InMemoryEntry[]>()

  private parseTsFilter(stream: StreamName, fromTs: string, toTs: string) {
    const from = Date.parse(fromTs)
    const to = Date.parse(toTs)

    return (entries: InMemoryEntry[]) => {
      return entries.filter((item) => {
        if (Number.isNaN(from) && Number.isNaN(to)) {
          return true
        }

        const eventTs = Date.parse(item.envelope.ts)
        if (Number.isNaN(eventTs)) {
          return false
        }

        const afterFrom = Number.isNaN(from) || eventTs >= from
        const beforeTo = Number.isNaN(to) || eventTs <= to
        return afterFrom && beforeTo
      })
    }
  }

  async publish<T>(stream: StreamName, event: EnvelopeInput<T>): Promise<string> {
    const envelope: EventEnvelope<T> = {
      id: ulid(),
      ts: event.ts ?? new Date().toISOString(),
      stream,
      type: event.type,
      source: event.source,
      correlationId: event.correlationId,
      causationId: event.causationId,
      actorType: event.actorType,
      actorId: event.actorId,
      payload: event.payload,
      signature: event.signature,
      riskMode: event.riskMode,
      sensitive: event.sensitive
    }

    const parsed = EventEnvelopeSchema.parse(envelope) as EnvelopeRecord
    const list = this.streams.get(stream) ?? []
    list.push({ id: parsed.id, envelope: parsed })
    this.streams.set(stream, list.slice(-5000))
    this.emitter.emit(stream, parsed)
    return parsed.id
  }

  async readBatch(
    stream: StreamName,
    fromId: string,
    count = 100
  ): Promise<Array<{ id: string; envelope: EnvelopeRecord }>> {
    const list = this.streams.get(stream) ?? []
    const startIndex = fromId === '0-0' ? 0 : list.findIndex((entry) => entry.id > fromId)
    const start = startIndex >= 0 ? startIndex : 0
    return list.slice(start, start + count)
  }

  async consume(
    stream: StreamName,
    _startId: string,
    onMessage: (envelope: EnvelopeRecord) => Promise<void> | void
  ): Promise<() => Promise<void>> {
    const handler = async (envelope: EnvelopeRecord) => {
      await onMessage(envelope)
    }

    this.emitter.on(stream, handler)

    return async () => {
      this.emitter.off(stream, handler)
    }
  }

  async replay(
    stream: StreamName,
    fromTs: string,
    toTs: string,
    onMessage: (envelope: EnvelopeRecord) => Promise<boolean | void> | boolean | void
  ): Promise<void> {
    const list = this.streams.get(stream) ?? []
    const filter = this.parseTsFilter(stream, fromTs, toTs)
    for (const item of filter(list)) {
      const shouldContinue = await onMessage(item.envelope)
      if (shouldContinue === false) {
        return
      }
    }
  }

  async health() {
    return { ok: true, mode: 'memory' as const }
  }
}
