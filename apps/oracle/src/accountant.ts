import type { OutcomeFill, OutcomeMarket, OutcomeSide } from '@hl/privateer-contracts'
import {
  accountValueUsd,
  clearinghouseState,
  userFillsByTime,
  type ClearinghouseState,
  type HlClient,
  type UserFill
} from '@hl/privateer-hl-client'

export interface OpenPosition {
  marketId: string
  side: OutcomeSide
  sizeUsd: number
}

// The Accountant owns every "what does the exchange say is true right now?"
// query the orchestrator might ask. It is intentionally read-mostly —
// risk gates and the floor view consult it; orders flow through OrderRouter
// and become visible here on the next refresh.
//
// `LocalAccountant` simulates an HL account in process for dev/tests.
// `HyperliquidAccountant` is the live HL-backed implementation.
export interface Accountant {
  positions(): Promise<readonly OpenPosition[]>
  equityUsd(): Promise<number | null>
  openExposureUsd(): Promise<number>
  openMarketCount(): Promise<number>
  clusterExposureUsd(market: OutcomeMarket): Promise<number>
  // Called by DryRunRouter / test code only. Live accountant ignores.
  notifyLocalFill(fill: OutcomeFill): void
  recordMarket(market: OutcomeMarket): void
  // Refresh from the exchange (no-op for local).
  warmup(): Promise<void>
}

export class LocalAccountant implements Accountant {
  private byMarket = new Map<string, OpenPosition>()
  private marketTags = new Map<string, string[]>()

  recordMarket(market: OutcomeMarket): void {
    this.marketTags.set(market.id, market.topicTags)
  }

  notifyLocalFill(fill: OutcomeFill): void {
    if (fill.fillSizeUsd <= 0) return
    const existing = this.byMarket.get(fill.marketId)
    if (!existing) {
      this.byMarket.set(fill.marketId, {
        marketId: fill.marketId,
        side: fill.side,
        sizeUsd: fill.fillSizeUsd
      })
      return
    }
    if (existing.side === fill.side) {
      existing.sizeUsd += fill.fillSizeUsd
      return
    }
    const net = existing.sizeUsd - fill.fillSizeUsd
    if (net > 0) existing.sizeUsd = net
    else if (net < 0) {
      existing.side = fill.side
      existing.sizeUsd = -net
    } else this.byMarket.delete(fill.marketId)
  }

  async positions(): Promise<readonly OpenPosition[]> {
    return [...this.byMarket.values()]
  }

  async equityUsd(): Promise<number | null> {
    return null
  }

  async openExposureUsd(): Promise<number> {
    let s = 0
    for (const p of this.byMarket.values()) s += p.sizeUsd
    return s
  }

  async openMarketCount(): Promise<number> {
    return this.byMarket.size
  }

  async clusterExposureUsd(market: OutcomeMarket): Promise<number> {
    if (market.topicTags.length === 0) return 0
    const tags = new Set(market.topicTags)
    let s = 0
    for (const p of this.byMarket.values()) {
      if (p.marketId === market.id) continue
      const otherTags = this.marketTags.get(p.marketId) ?? []
      if (otherTags.some((t) => tags.has(t))) s += p.sizeUsd
    }
    return s
  }

  async warmup(): Promise<void> {}
}

// HL-backed accountant. Treats HL's `clearinghouseState` as the source of
// truth for positions and equity, with a TTL cache so risk gates don't
// stampede the info endpoint. `marketTags` is still tracked locally — HL
// doesn't know about our topic tagging.
export interface HyperliquidAccountantConfig {
  hl: HlClient
  user: string
  ttlMs?: number
  log?: (msg: string, meta?: unknown) => void
}

export class HyperliquidAccountant implements Accountant {
  private cached: ClearinghouseState | null = null
  private cachedAt = 0
  private inflight: Promise<void> | null = null
  private marketTags = new Map<string, string[]>()
  private positionsByMarket: Map<string, OpenPosition> = new Map()
  private fillSinceMs = 0
  private readonly ttlMs: number
  private readonly log: (msg: string, meta?: unknown) => void

  constructor(private readonly config: HyperliquidAccountantConfig) {
    this.ttlMs = config.ttlMs ?? 4_000
    this.log = config.log ?? (() => undefined)
  }

  recordMarket(market: OutcomeMarket): void {
    this.marketTags.set(market.id, market.topicTags)
  }

  // Kept on the interface for test hooks; the live path observes fills via
  // `userFillsByTime` on refresh, so this is a no-op here.
  notifyLocalFill(_fill: OutcomeFill): void {}

  async positions(): Promise<readonly OpenPosition[]> {
    await this.refresh()
    return [...this.positionsByMarket.values()]
  }

  async equityUsd(): Promise<number | null> {
    await this.refresh()
    if (!this.cached) return null
    const v = accountValueUsd(this.cached)
    return Number.isFinite(v) ? v : null
  }

  async openExposureUsd(): Promise<number> {
    await this.refresh()
    let s = 0
    for (const p of this.positionsByMarket.values()) s += p.sizeUsd
    return s
  }

  async openMarketCount(): Promise<number> {
    await this.refresh()
    return this.positionsByMarket.size
  }

  async clusterExposureUsd(market: OutcomeMarket): Promise<number> {
    await this.refresh()
    if (market.topicTags.length === 0) return 0
    const tags = new Set(market.topicTags)
    let s = 0
    for (const p of this.positionsByMarket.values()) {
      if (p.marketId === market.id) continue
      const otherTags = this.marketTags.get(p.marketId) ?? []
      if (otherTags.some((t) => tags.has(t))) s += p.sizeUsd
    }
    return s
  }

  async warmup(): Promise<void> {
    this.cached = null
    this.cachedAt = 0
    await this.refresh()
    this.fillSinceMs = Date.now()
    this.log('accountant warmup complete', {
      positions: this.positionsByMarket.size,
      equityUsd: this.cached ? accountValueUsd(this.cached) : null
    })
  }

  private async refresh(): Promise<void> {
    if (Date.now() - this.cachedAt < this.ttlMs && this.cached) return
    if (this.inflight) return this.inflight
    this.inflight = (async () => {
      try {
        const state = await clearinghouseState(this.config.hl, this.config.user)
        this.cached = state
        this.cachedAt = Date.now()
        this.positionsByMarket = positionsFromClearinghouse(state)
      } catch (err) {
        this.log('accountant refresh failed; serving last known', err)
      } finally {
        this.inflight = null
      }
    })()
    await this.inflight
  }

  // Optional: ingest recent fills since `fillSinceMs` so callers can audit
  // post-execution truth. Not used in core gating today; exposed for tooling.
  async recentFills(): Promise<UserFill[]> {
    return userFillsByTime(this.config.hl, this.config.user, this.fillSinceMs)
  }
}

// Maps HL's `assetPositions` into our OutcomeSide / sizeUsd shape. szi sign
// gives side; absolute notional comes from `positionValue` (already in USD
// per the HL info shape).
export function positionsFromClearinghouse(state: ClearinghouseState): Map<string, OpenPosition> {
  const out = new Map<string, OpenPosition>()
  for (const ap of state.assetPositions ?? []) {
    const szi = Number(ap.position.szi)
    if (!Number.isFinite(szi) || szi === 0) continue
    const sizeUsd = Math.abs(Number(ap.position.positionValue ?? 0))
    if (!Number.isFinite(sizeUsd) || sizeUsd === 0) continue
    out.set(ap.position.coin, {
      marketId: ap.position.coin,
      side: szi > 0 ? 'YES' : 'NO',
      sizeUsd
    })
  }
  return out
}
