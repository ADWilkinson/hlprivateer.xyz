import { NormalizedTick, NormalizedTickSchema } from '@hl/privateer-contracts'
import type { EventBus } from '@hl/privateer-event-bus'
import { ulid } from 'ulid'
import type { RuntimeEnv } from '../config'
import promClient from 'prom-client'

const marketDataAgeMs = new promClient.Gauge({
  name: 'hlp_runtime_market_data_age_ms',
  help: 'Market-data lag in milliseconds',
  labelNames: ['symbol', 'source']
})

const DEFAULT_HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const FETCH_TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 4_000 // serve from cache within a single runtime cycle (5s default)

export interface MarketDataAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  latest(symbol: string): Promise<NormalizedTick | undefined>
}

/**
 * Fetch-on-demand market adapter. Calls Hyperliquid REST allMids endpoint
 * when the cache is stale, returning fresh mid prices for all tracked symbols
 * in a single HTTP call. No persistent WebSocket connection to manage.
 */
class HyperliquidRestAdapter implements MarketDataAdapter {
  private cache = new Map<string, NormalizedTick>()
  private lastFetchAtMs = 0
  private fetchInFlight: Promise<void> | null = null

  constructor(
    private symbols: string[],
    private infoUrl: string,
    private eventBus: EventBus
  ) {}

  async start(): Promise<void> {
    // Warm the cache on startup so the first runtime cycle has data.
    await this.refresh()
  }

  async stop(): Promise<void> {
    // Nothing to tear down.
  }

  async latest(symbol: string): Promise<NormalizedTick | undefined> {
    if (Date.now() - this.lastFetchAtMs > CACHE_TTL_MS) {
      await this.refresh()
    }
    return this.cache.get(symbol)
  }

  private async refresh(): Promise<void> {
    // Coalesce concurrent callers behind a single in-flight fetch.
    if (this.fetchInFlight) {
      await this.fetchInFlight
      return
    }

    this.fetchInFlight = this.doFetch()
    try {
      await this.fetchInFlight
    } finally {
      this.fetchInFlight = null
    }
  }

  private async doFetch(): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(this.infoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
        signal: controller.signal
      })

      if (!response.ok) {
        console.warn(`[runtime-market] allMids fetch failed: HTTP ${response.status}`)
        return
      }

      const payload = (await response.json()) as Record<string, string> | null
      if (!payload || typeof payload !== 'object') {
        console.warn('[runtime-market] allMids fetch returned invalid payload')
        return
      }

      const now = new Date().toISOString()
      const nowMs = Date.now()
      this.lastFetchAtMs = nowMs

      for (const symbol of this.symbols) {
        const midRaw = payload[symbol]
        const px = parseNumber(midRaw)
        if (typeof px !== 'number') continue

        const parsed = NormalizedTickSchema.safeParse({
          symbol,
          px,
          bid: px,
          ask: px,
          bidSize: 0,
          askSize: 0,
          updatedAt: now,
          source: 'rest'
        })

        if (!parsed.success) continue

        this.cache.set(symbol, parsed.data)
        marketDataAgeMs.labels({ symbol, source: 'rest' }).set(0)

        void this.eventBus.publish('hlp.market.normalized', {
          type: 'MARKET_TICK',
          stream: 'hlp.market.normalized',
          source: 'runtime.market',
          correlationId: ulid(),
          actorType: 'system',
          actorId: 'market-adapter',
          payload: {
            symbol,
            px,
            bid: px,
            ask: px,
            bidSize: 0,
            askSize: 0,
            updatedAt: now
          }
        })
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        console.warn('[runtime-market] allMids fetch timed out')
      } else {
        console.warn('[runtime-market] allMids fetch error:', String(error))
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createMarketAdapter(config: RuntimeEnv, eventBus: EventBus): MarketDataAdapter {
  const basketSymbols = config.BASKET_SYMBOLS.split(',').map((symbol) => symbol.trim()).filter(Boolean)
  const infoUrl = config.HL_INFO_URL ?? DEFAULT_HL_INFO_URL

  if (basketSymbols.length === 0) {
    console.warn('BASKET_SYMBOLS empty; running dynamic-symbols-only market adapter.')
    return new HyperliquidRestAdapter([], infoUrl, eventBus)
  }

  const symbols = Array.from(new Set(basketSymbols))
  return new HyperliquidRestAdapter(symbols, infoUrl, eventBus)
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
