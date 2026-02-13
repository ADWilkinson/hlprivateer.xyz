import { NormalizedTick, NormalizedTickSchema } from '@hl/privateer-contracts'
import type { EventBus } from '@hl/privateer-event-bus'
import { ulid } from 'ulid'
import type { RuntimeEnv } from '../config'
import promClient from 'prom-client'
import WebSocket from 'ws'

const marketDataAgeMs = new promClient.Gauge({
  name: 'hlp_runtime_market_data_age_ms',
  help: 'Market-data lag in milliseconds',
  labelNames: ['symbol', 'source']
})

const BASE_RECONNECT_MS = 250
const MAX_RECONNECT_MS = 30_000

interface RawExchangeTick {
  symbol?: string
  symbolName?: string
  px?: number | string
  bid?: number | string
  ask?: number | string
  bidPx?: number | string
  askPx?: number | string
  bestBid?: number | string
  bestAsk?: number | string
  bidSize?: number | string
  askSize?: number | string
  volume?: number | string
  v?: number | string
  volume24hUsd?: number | string
  mark?: number | string
  updatedAt?: string
  time?: number | string
  ts?: number | string
  timestamp?: string
}

interface RawExchangePayload {
  channel?: string
  data?: RawExchangeTick | RawExchangeTick[]
  symbol?: string
  dataType?: string
  dataType2?: string
  price?: string
  mark?: string
  event?: string
  type?: string
  updatedAt?: string
  timestamp?: string
}

export interface MarketDataAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  latest(symbol: string): Promise<NormalizedTick | undefined>
}

class SyntheticAdapter implements MarketDataAdapter {
  private timer?: ReturnType<typeof setInterval>
  private ticks = new Map<string, NormalizedTick>()

  constructor(
    private symbols: string[],
    private base: Record<string, number>,
    private jitter: number,
    private eventBus: EventBus
  ) {}

  async start(): Promise<void> {
    this.timer = setInterval(async () => {
      for (const symbol of this.symbols) {
        const base = this.base[symbol] ?? 100
        const drift = 1 + (Math.random() - 0.5) * this.jitter
        const px = Math.max(0.01, base * drift)
        const tick: NormalizedTick = NormalizedTickSchema.parse({
          symbol,
          px,
          bid: px * 0.999,
          ask: px * 1.001,
          bidSize: 1000,
          askSize: 1000,
          volume24hUsd: base * 100,
          updatedAt: new Date().toISOString(),
          source: 'synthetic'
        })

        this.ticks.set(symbol, tick)
        await this.eventBus.publish('hlp.market.normalized', {
          type: 'MARKET_TICK',
          stream: 'hlp.market.normalized',
          source: 'runtime.market',
          correlationId: ulid(),
          actorType: 'system',
          actorId: 'market-adapter',
          payload: {
            symbol: tick.symbol,
            px: tick.px,
            bid: tick.bid,
            ask: tick.ask,
            bidSize: tick.bidSize,
            askSize: tick.askSize,
            updatedAt: tick.updatedAt
          }
        })

        const ageMs = Date.now() - Date.parse(tick.updatedAt)
        marketDataAgeMs.labels({ symbol, source: 'synthetic' }).set(Math.max(0, ageMs))
      }
    }, 1000)
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
    }
  }

  async latest(symbol: string): Promise<NormalizedTick | undefined> {
    return this.ticks.get(symbol)
  }
}

class HyperliquidWebSocketAdapter implements MarketDataAdapter {
  private socket?: WebSocket
  private ageTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private reconnectAttempts = 0
  private ticks = new Map<string, NormalizedTick>()
  private stopped = false

  constructor(
    private symbols: string[],
    private wsUrl: string,
    private eventBus: EventBus
  ) {}

  async start(): Promise<void> {
    await this.connect()
    this.ageTimer = setInterval(() => {
      for (const [symbol, tick] of this.ticks.entries()) {
        const ageMs = Date.now() - Date.parse(tick.updatedAt)
        marketDataAgeMs.labels({ symbol, source: 'ws' }).set(Math.max(0, ageMs))
      }
    }, 1_000)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    if (this.ageTimer) {
      clearInterval(this.ageTimer)
    }
    this.socket?.close()
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return
    }

    const ws = new WebSocket(this.wsUrl)
    this.socket = ws

    ws.on('open', () => {
      this.reconnectAttempts = 0
      const subscribe = {
        type: 'subscribe',
        data: {
          channels: ['ticker'],
          symbols: this.symbols
        }
      }
      ws.send(JSON.stringify(subscribe))
    })

    ws.on('message', (message: any) => {
      const raw = toText(message)
      if (!raw) {
        return
      }

      let envelope: RawExchangePayload
      try {
        envelope = JSON.parse(raw)
      } catch {
        return
      }

      const tick = this.normalizeTick(envelope)
      if (!tick || !this.symbols.includes(tick.symbol)) {
        return
      }

      this.ticks.set(tick.symbol, tick)
      void this.eventBus.publish('hlp.market.normalized', {
        type: 'MARKET_TICK',
        stream: 'hlp.market.normalized',
        source: 'runtime.market',
        correlationId: ulid(),
        actorType: 'system',
        actorId: 'market-adapter',
        payload: {
          symbol: tick.symbol,
          px: tick.px,
          bid: tick.bid,
          ask: tick.ask,
          bidSize: tick.bidSize,
          askSize: tick.askSize,
          updatedAt: tick.updatedAt
        }
      })
    })

    ws.on('close', () => {
      void this.scheduleReconnect()
    })

    ws.on('error', () => {
      if (!this.stopped) {
        ws.close()
      }
    })
  }

  private normalizeTick(message: RawExchangePayload): NormalizedTick | null {
    const envelopeData = Array.isArray(message.data) ? message.data[0] : message.data
    if (!envelopeData) {
      return null
    }

    const symbol = envelopeData.symbol ?? envelopeData.symbolName ?? message.symbol
    if (!symbol) {
      return null
    }

    const px = firstFinite(
      parseNumber(envelopeData.px),
      parseNumber(message.price),
      parseNumber(envelopeData.mark)
    )
    const bid = firstFinite(parseNumber(envelopeData.bidPx), parseNumber(envelopeData.bid), parseNumber(envelopeData.bestBid))
    const ask = firstFinite(parseNumber(envelopeData.askPx), parseNumber(envelopeData.ask), parseNumber(envelopeData.bestAsk))
    if (!px || !bid || !ask) {
      return null
    }

    const normalized = NormalizedTickSchema.safeParse({
      symbol,
      px,
      bid,
      ask,
      bidSize: firstFinite(parseNumber(envelopeData.bidSize), parseNumber(envelopeData.v)) ?? 0,
      askSize: firstFinite(parseNumber(envelopeData.askSize), parseNumber(envelopeData.v)) ?? 0,
      volume24hUsd: firstFinite(parseNumber(envelopeData.volume), parseNumber(envelopeData.volume24hUsd)),
      updatedAt:
        firstString(
          envelopeData.updatedAt,
          envelopeData.timestamp,
          envelopeData.time ? String(envelopeData.time) : undefined,
          message.updatedAt,
          message.timestamp
        ) || new Date().toISOString(),
      source: 'ws'
    })

    return normalized.success ? normalized.data : null
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped) {
      return
    }

    const attempt = Math.min(this.reconnectAttempts, 12)
    this.reconnectAttempts += 1
    const delayMs = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** attempt) + Math.floor(Math.random() * 250)

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(() => {
      void this.connect()
    }, delayMs)
  }

  async latest(symbol: string): Promise<NormalizedTick | undefined> {
    return this.ticks.get(symbol)
  }
}

export function createMarketAdapter(config: RuntimeEnv, eventBus: EventBus): MarketDataAdapter {
  const symbols = ['HYPE', ...config.BASKET_SYMBOLS.split(',').map((symbol) => symbol.trim()).filter(Boolean)]

  if (!config.HL_WS_URL) {
    return new SyntheticAdapter(
      symbols,
      { HYPE: 22, BTC: 65000, ETH: 2800, SOL: 120 },
      0.004,
      eventBus
    )
  }

  if (!config.HL_WS_URL.startsWith('ws://') && !config.HL_WS_URL.startsWith('wss://')) {
    return new SyntheticAdapter(
      symbols,
      { HYPE: 22, BTC: 65000, ETH: 2800, SOL: 120 },
      0.004,
      eventBus
    )
  }

  return new HyperliquidWebSocketAdapter(symbols, config.HL_WS_URL, eventBus)
}

function parseNumber(value?: string | number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  for (const candidate of values) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }

  return undefined
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const candidate of values) {
    if (candidate && candidate.trim().length > 0) {
      return candidate
    }
  }

  return undefined
}

function toText(value: string | Buffer | ArrayBuffer | DataView | ArrayBufferView): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString('utf8')
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  }

  return null
}
