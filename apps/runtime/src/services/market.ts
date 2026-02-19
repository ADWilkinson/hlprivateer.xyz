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
const PING_INTERVAL_MS = 20_000
const SILENCE_TIMEOUT_MS = 30_000

type HyperliquidSubscription =
  | { type: 'allMids'; dex?: string }
  | { type: 'bbo'; coin: string }

interface HyperliquidLevel {
  px: string
  sz: string
  n: number
}

interface HyperliquidBbo {
  coin: string
  time: number
  bbo: [HyperliquidLevel | null, HyperliquidLevel | null]
}

interface HyperliquidAllMids {
  mids: Record<string, string>
}

type HyperliquidWsEnvelope =
  | { channel: 'subscriptionResponse'; data: { method: string; subscription: HyperliquidSubscription } }
  | { channel: 'bbo'; data: HyperliquidBbo }
  | { channel: 'allMids'; data: HyperliquidAllMids }
  | { channel: 'error'; data: unknown }
  | { channel: string; data: unknown }

export interface MarketDataAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  latest(symbol: string): Promise<NormalizedTick | undefined>
}

class HyperliquidWebSocketAdapter implements MarketDataAdapter {
  private socket?: WebSocket
  private ageTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private pingTimer?: ReturnType<typeof setInterval>
  private reconnectAttempts = 0
  private lastActivityAt = 0
  private ticks = new Map<string, NormalizedTick>()
  private stopped = false
  private mids = new Map<string, { px: number; ts: number }>()
  private lastPublishAtMs = new Map<string, number>()

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
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
    this.socket?.close()
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }

    const ws = new WebSocket(this.wsUrl)
    this.socket = ws

    ws.on('open', () => {
      this.reconnectAttempts = 0
      this.lastActivityAt = Date.now()

      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastActivityAt > SILENCE_TIMEOUT_MS && !this.stopped) {
          ws.terminate()
          return
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping()
        }
      }, PING_INTERVAL_MS)

      // Hyperliquid WS expects:
      // { "method": "subscribe", "subscription": { "type": "...", ... } }
      //
      // For a simple tick stream with bid/ask we subscribe to `bbo` per coin.
      // We also subscribe to `allMids` so we can fill `px` if one side is missing.
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } satisfies HyperliquidSubscription }))
      for (const symbol of this.symbols) {
        ws.send(
          JSON.stringify({
            method: 'subscribe',
            subscription: { type: 'bbo', coin: symbol } satisfies HyperliquidSubscription
          })
        )
      }
    })

    ws.on('pong', () => {
      this.lastActivityAt = Date.now()
    })

    ws.on('message', (message: any) => {
      this.lastActivityAt = Date.now()
      const raw = toText(message)
      if (!raw) {
        return
      }

      let envelope: unknown
      try {
        envelope = JSON.parse(raw)
      } catch (error) {
        console.warn('[runtime-market] failed to parse websocket message', error) // eslint-disable-line no-console
        return
      }

      const channel = typeof (envelope as any)?.channel === 'string' ? String((envelope as any).channel) : ''
      if (channel === 'error') {
        void console.error('hyperliquid ws error', (envelope as any)?.data)
        return
      }

      if (channel === 'allMids') {
        const mids = (envelope as any)?.data?.mids as unknown
        if (!mids || typeof mids !== 'object' || Array.isArray(mids)) {
          return
        }

        for (const [coin, midRaw] of Object.entries(mids as Record<string, unknown>)) {
          const mid = parseNumber(midRaw)
          if (typeof mid === 'number') {
            this.mids.set(coin, { px: mid, ts: Date.now() })
          }
        }

        // Publish a MARKET_TICK for each tracked symbol using allMids as a heartbeat.
        // BBO ticks take priority via the per-symbol 1s throttle — this only fires
        // when no BBO has arrived recently, keeping low-volume symbols fresh.
        const now = new Date().toISOString()
        for (const symbol of this.symbols) {
          const midEntry = this.mids.get(symbol)
          if (!midEntry) continue
          const parsed = NormalizedTickSchema.safeParse({
            symbol,
            px: midEntry.px,
            bid: midEntry.px,
            ask: midEntry.px,
            bidSize: 0,
            askSize: 0,
            updatedAt: now,
            source: 'ws'
          })
          if (parsed.success) {
            void this.publishTickThrottled(parsed.data)
          }
        }
        return
      }

      if (channel !== 'bbo') {
        return
      }

      const tick = this.normalizeBbo(((envelope as any)?.data ?? {}) as HyperliquidBbo)
      if (!tick || !this.symbols.includes(tick.symbol)) {
        return
      }

      this.ticks.set(tick.symbol, tick)
      void this.publishTickThrottled(tick)
    })

    ws.on('close', () => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer)
        this.pingTimer = undefined
      }
      void this.scheduleReconnect()
    })

    ws.on('error', () => {
      if (!this.stopped) {
        ws.close()
      }
    })
  }

  private normalizeBbo(message: HyperliquidBbo): NormalizedTick | null {
    const coin = typeof message?.coin === 'string' ? message.coin : ''
    if (!coin) {
      return null
    }

    const bidLevel = message.bbo?.[0] ?? null
    const askLevel = message.bbo?.[1] ?? null
    const bid = bidLevel ? parseNumber(bidLevel.px) : undefined
    const ask = askLevel ? parseNumber(askLevel.px) : undefined
    const bidSize = bidLevel ? parseNumber(bidLevel.sz) : undefined
    const askSize = askLevel ? parseNumber(askLevel.sz) : undefined

    const midEntry = this.mids.get(coin)
    const mid = midEntry && (Date.now() - midEntry.ts) < 5000 ? midEntry.px : undefined
    const px =
      typeof bid === 'number' && typeof ask === 'number'
        ? (bid + ask) / 2
        : typeof mid === 'number'
          ? mid
          : firstFinite(bid, ask)

    if (typeof px !== 'number') {
      return null
    }

    const normalized = NormalizedTickSchema.safeParse({
      symbol: coin,
      px,
      bid: typeof bid === 'number' ? bid : px,
      ask: typeof ask === 'number' ? ask : px,
      bidSize: typeof bidSize === 'number' ? bidSize : 0,
      askSize: typeof askSize === 'number' ? askSize : 0,
      updatedAt: new Date().toISOString(),
      source: 'ws'
    })

    return normalized.success ? normalized.data : null
  }

  private async publishTickThrottled(tick: NormalizedTick): Promise<void> {
    // `bbo` can update multiple times per second. Persisting every tick into Redis Streams is
    // unnecessary and causes unbounded stream growth. Throttle to a stable per-symbol cadence.
    const now = Date.now()
    const last = this.lastPublishAtMs.get(tick.symbol) ?? 0
    if (now - last < 1000) {
      return
    }

    this.lastPublishAtMs.set(tick.symbol, now)
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
  const basketSymbols = config.BASKET_SYMBOLS.split(',').map((symbol) => symbol.trim()).filter(Boolean)
  if (!config.HL_WS_URL) {
    throw new Error('HL_WS_URL is required when runtime market adapter is enabled.')
  }

  if (!config.HL_WS_URL.startsWith('ws://') && !config.HL_WS_URL.startsWith('wss://')) {
    throw new Error('HL_WS_URL must begin with ws:// or wss://')
  }

  if (basketSymbols.length === 0) {
    console.warn('BASKET_SYMBOLS empty; running dynamic-symbols-only market adapter.')
    return new HyperliquidWebSocketAdapter([], config.HL_WS_URL, eventBus)
  }

  const symbols = Array.from(new Set(basketSymbols))

  return new HyperliquidWebSocketAdapter(symbols, config.HL_WS_URL, eventBus)
}

function parseNumber(value?: unknown): number | undefined {
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

function isoFromMillis(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const ms = value < 10_000_000_000 ? value * 1000 : value
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
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
