import fs from 'node:fs/promises'
import path from 'node:path'

export interface TradeEntry {
  tradeId: string
  symbol: string
  side: 'LONG' | 'SHORT'
  entryPx: number
  entryAt: string
  exitPx: number | null
  exitAt: string | null
  peakPx: number
  troughPx: number
  entryNotionalUsd: number
  realizedPnlUsd: number | null
  realizedPnlPct: number | null
  holdDurationMs: number | null
  exitReason: 'tp_hit' | 'sl_hit' | 'rebalance' | 'exit_all' | 'manual' | null
  thesisNote: string | null
}

export interface TradeJournalSummary {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  avgWinPct: number
  avgLossPct: number
  avgHoldMs: number
  bestTrade: { symbol: string; pnlPct: number } | null
  worstTrade: { symbol: string; pnlPct: number } | null
  recentClosed: TradeEntry[]
}

export class TradeJournal {
  private openTrades = new Map<string, TradeEntry>()
  private closedTrades: TradeEntry[] = []
  private readonly filePath: string
  private readonly maxClosed: number
  private tradeCounter = 0

  constructor(dir: string, maxClosed = 50) {
    this.filePath = path.join(dir, 'trade-journal.ndjson')
    this.maxClosed = maxClosed
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TradeEntry
          if (entry.exitAt) {
            this.closedTrades.push(entry)
          } else {
            this.openTrades.set(entry.symbol, entry)
          }
        } catch { /* skip corrupt lines */ }
      }
      this.closedTrades = this.closedTrades.slice(-this.maxClosed)
    } catch { /* file doesn't exist yet */ }
  }

  openTrade(params: {
    symbol: string
    side: 'LONG' | 'SHORT'
    entryPx: number
    notionalUsd: number
    thesisNote?: string
  }): void {
    if (this.openTrades.has(params.symbol)) return
    this.tradeCounter += 1
    const entry: TradeEntry = {
      tradeId: `t-${Date.now()}-${this.tradeCounter}`,
      symbol: params.symbol,
      side: params.side,
      entryPx: params.entryPx,
      entryAt: new Date().toISOString(),
      exitPx: null,
      exitAt: null,
      peakPx: params.entryPx,
      troughPx: params.entryPx,
      entryNotionalUsd: params.notionalUsd,
      realizedPnlUsd: null,
      realizedPnlPct: null,
      holdDurationMs: null,
      exitReason: null,
      thesisNote: params.thesisNote ?? null
    }
    this.openTrades.set(params.symbol, entry)
  }

  updateMarkPrice(symbol: string, markPx: number): void {
    const trade = this.openTrades.get(symbol)
    if (!trade || !Number.isFinite(markPx) || markPx <= 0) return
    trade.peakPx = Math.max(trade.peakPx, markPx)
    trade.troughPx = Math.min(trade.troughPx, markPx)
  }

  closeTrade(symbol: string, exitPx: number, reason: TradeEntry['exitReason']): TradeEntry | null {
    const trade = this.openTrades.get(symbol)
    if (!trade) return null

    trade.exitPx = exitPx
    trade.exitAt = new Date().toISOString()
    trade.exitReason = reason
    trade.holdDurationMs = Date.parse(trade.exitAt) - Date.parse(trade.entryAt)

    const direction = trade.side === 'LONG' ? 1 : -1
    trade.realizedPnlPct = direction * ((exitPx - trade.entryPx) / trade.entryPx) * 100
    trade.realizedPnlUsd = direction * (exitPx - trade.entryPx) * (trade.entryNotionalUsd / trade.entryPx)

    this.openTrades.delete(symbol)
    this.closedTrades.push(trade)
    if (this.closedTrades.length > this.maxClosed) {
      this.closedTrades = this.closedTrades.slice(-this.maxClosed)
    }

    void this.flush()
    return trade
  }

  /** Reconcile journal with actual positions — close any trades for symbols no longer held */
  reconcile(currentSymbols: Set<string>, markPrices: Record<string, number>): TradeEntry[] {
    const closed: TradeEntry[] = []
    for (const [symbol, trade] of this.openTrades) {
      if (!currentSymbols.has(symbol)) {
        const exitPx = markPrices[symbol] ?? trade.peakPx
        const result = this.closeTrade(symbol, exitPx, 'rebalance')
        if (result) closed.push(result)
      }
    }
    return closed
  }

  getOpenTrades(): TradeEntry[] {
    return [...this.openTrades.values()]
  }

  getRecentClosed(n: number): TradeEntry[] {
    return this.closedTrades.slice(-n)
  }

  summarize(): TradeJournalSummary {
    const closed = this.closedTrades
    const wins = closed.filter((t) => (t.realizedPnlPct ?? 0) > 0)
    const losses = closed.filter((t) => (t.realizedPnlPct ?? 0) <= 0)
    const holdDurations = closed.filter((t) => t.holdDurationMs != null).map((t) => t.holdDurationMs!)

    const winPcts = wins.map((t) => t.realizedPnlPct!).filter(Number.isFinite)
    const lossPcts = losses.map((t) => t.realizedPnlPct!).filter(Number.isFinite)

    const sorted = [...closed].sort((a, b) => (a.realizedPnlPct ?? 0) - (b.realizedPnlPct ?? 0))
    const best = sorted[sorted.length - 1]
    const worst = sorted[0]

    return {
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? wins.length / closed.length : 0,
      avgWinPct: winPcts.length > 0 ? winPcts.reduce((s, v) => s + v, 0) / winPcts.length : 0,
      avgLossPct: lossPcts.length > 0 ? lossPcts.reduce((s, v) => s + v, 0) / lossPcts.length : 0,
      avgHoldMs: holdDurations.length > 0 ? holdDurations.reduce((s, v) => s + v, 0) / holdDurations.length : 0,
      bestTrade: best?.realizedPnlPct != null ? { symbol: best.symbol, pnlPct: best.realizedPnlPct } : null,
      worstTrade: worst?.realizedPnlPct != null ? { symbol: worst.symbol, pnlPct: worst.realizedPnlPct } : null,
      recentClosed: this.closedTrades.slice(-10)
    }
  }

  private async flush(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const all = [...this.closedTrades, ...this.openTrades.values()]
    const ndjson = all.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await fs.writeFile(this.filePath, ndjson, 'utf-8')
  }
}
