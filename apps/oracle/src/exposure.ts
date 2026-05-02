import type { OutcomeFill, OutcomeMarket } from '@hl/privateer-contracts'

/**
 * In-memory ledger of open positions. Tracks gross exposure, per-market
 * exposure, and per-topic-tag cluster exposure for the risk gates.
 *
 * Wire-up note: in production this should be reconciled against the HL
 * clearinghouse on startup. The scaffold trusts the in-process fills view.
 */
export interface OpenPosition {
  marketId: string
  side: 'YES' | 'NO'
  sizeUsd: number
}

export class ExposureLedger {
  private byMarket = new Map<string, OpenPosition>()
  private marketTags = new Map<string, string[]>()

  recordMarket(market: OutcomeMarket): void {
    this.marketTags.set(market.id, market.topicTags)
  }

  /** Apply a fill (idempotent on `proposalId`). */
  applyFill(fill: OutcomeFill): void {
    if (fill.fillSizeUsd <= 0) return
    const existing = this.byMarket.get(fill.marketId)
    if (!existing) {
      this.byMarket.set(fill.marketId, {
        marketId: fill.marketId,
        side: fill.side,
        sizeUsd: fill.fillSizeUsd
      })
    } else if (existing.side === fill.side) {
      existing.sizeUsd += fill.fillSizeUsd
    } else {
      // Opposite side reduces, then crosses if larger.
      const net = existing.sizeUsd - fill.fillSizeUsd
      if (net > 0) {
        existing.sizeUsd = net
      } else if (net < 0) {
        existing.side = fill.side
        existing.sizeUsd = -net
      } else {
        this.byMarket.delete(fill.marketId)
      }
    }
  }

  /** Mark a market resolved/voided — drop its exposure. */
  closeMarket(marketId: string): void {
    this.byMarket.delete(marketId)
  }

  openExposureUsd(): number {
    let s = 0
    for (const p of this.byMarket.values()) s += p.sizeUsd
    return s
  }

  openMarketCount(): number {
    return this.byMarket.size
  }

  /** Sum of exposure in markets sharing any topic tag with the given market. */
  clusterExposureUsd(market: OutcomeMarket): number {
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

  /** Inspect (read-only). */
  positions(): OpenPosition[] {
    return [...this.byMarket.values()]
  }
}
