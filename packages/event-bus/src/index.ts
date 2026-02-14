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
    onMessage: (envelope: EnvelopeRecord) => Promise<void> | void
  ): Promise<void>
  health(): Promise<{ ok: boolean; mode: 'redis' | 'memory'; reason?: string }>
}

export interface RedisEventBusConfig {
  redisUrl?: string
  streamPrefix?: string
  consumerGroup?: string
}

const defaultStreamPrefix = 'hlp'

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
    return `${this.prefix}.${stream}`
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
    await this.redis.xadd(this.stream(stream), '*', 'payload', JSON.stringify(envelope))
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
      } catch {
        cursor = '0-0'
      }
    }

    const loop = async () => {
      while (running) {
        const result = (await reader.xread(
          'COUNT',
          50,
          'BLOCK',
          2000,
          'STREAMS',
          streamName,
          normalizeBound(cursor)
        )) as RedisReadResult | null

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
    onMessage: (envelope: EnvelopeRecord) => Promise<void> | void
  ): Promise<void> {
    const entries = await this.redis.xrange(this.stream(stream), '-', '+')
    const from = Date.parse(fromTs)
    const to = Date.parse(toTs)

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

      await onMessage(envelope)
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

  async replay(stream: StreamName, fromTs: string, toTs: string, onMessage: (envelope: EnvelopeRecord) => Promise<void> | void): Promise<void> {
    const list = this.streams.get(stream) ?? []
    const filter = this.parseTsFilter(stream, fromTs, toTs)
    for (const item of filter(list)) {
      await onMessage(item.envelope)
    }
  }

  async health() {
    return { ok: true, mode: 'memory' as const }
  }
}
