import type { OutcomeMarket, OutcomeSide } from '@hl/privateer-contracts'
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

export interface Accountant {
  positions(): Promise<readonly OpenPosition[]>
  equityUsd(): Promise<number>
  openExposureUsd(): Promise<number>
  openMarketCount(): Promise<number>
  clusterExposureUsd(market: OutcomeMarket): Promise<number>
  recordMarket(market: OutcomeMarket): void
  warmup(): Promise<void>
  recentFills(): Promise<UserFill[]>
}

export interface HyperliquidAccountantConfig {
  hl: HlClient
  user: string
  ttlMs?: number
  log?: (msg: string, meta?: unknown) => void
}

// HL-backed accountant. Treats `clearinghouseState` as the source of truth
// for positions and equity, with a TTL cache so risk gates don't stampede
// the info endpoint. Throws on HL errors — no graceful degradation.
// `marketTags` is the only piece we track locally because HL doesn't know
// about our topic tagging.
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

  async positions(): Promise<readonly OpenPosition[]> {
    await this.refresh()
    return [...this.positionsByMarket.values()]
  }

  async equityUsd(): Promise<number> {
    await this.refresh()
    const v = accountValueUsd(this.cached!)
    if (!Number.isFinite(v)) {
      throw new Error('clearinghouseState returned a non-finite accountValue')
    }
    return v
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
      equityUsd: accountValueUsd(this.cached!)
    })
  }

  async recentFills(): Promise<UserFill[]> {
    return userFillsByTime(this.config.hl, this.config.user, this.fillSinceMs)
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
      } finally {
        this.inflight = null
      }
    })()
    await this.inflight
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
