import fs from 'node:fs/promises'
import path from 'node:path'

export interface ConvictionEntry {
  symbol: string
  score: number // -100 (strong short) to +100 (strong long)
  catalysts: string[]
  lastUpdatedAt: string
  triggerDistance: number // 0-1, how close to actionable (1 = trade now)
  consecutiveMentions: number
  decayFactor: number // 0-1, how much to decay per cycle
}

export interface ConvictionSnapshot {
  entries: ConvictionEntry[]
  updatedAt: string
}

const DEFAULT_DECAY = 0.92
const MIN_SCORE_THRESHOLD = 5

export class ConvictionBoard {
  private board = new Map<string, ConvictionEntry>()
  private readonly filePath: string

  constructor(dir: string) {
    this.filePath = path.join(dir, 'conviction-board.json')
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as { entries?: ConvictionEntry[] }
      if (Array.isArray(data.entries)) {
        for (const entry of data.entries) {
          if (entry.symbol) {
            this.board.set(entry.symbol, entry)
          }
        }
      }
    } catch { /* start empty */ }
  }

  /** Update conviction for a symbol based on LLM analysis */
  update(symbol: string, params: {
    scoreDelta: number
    catalyst?: string
    triggerDistance?: number
  }): void {
    const existing = this.board.get(symbol)
    const now = new Date().toISOString()

    if (existing) {
      existing.score = clamp(existing.score + params.scoreDelta, -100, 100)
      existing.lastUpdatedAt = now
      existing.consecutiveMentions += 1
      if (params.catalyst) {
        existing.catalysts = [...existing.catalysts.slice(-4), params.catalyst]
      }
      if (params.triggerDistance != null) {
        existing.triggerDistance = clamp(params.triggerDistance, 0, 1)
      }
    } else {
      this.board.set(symbol, {
        symbol,
        score: clamp(params.scoreDelta, -100, 100),
        catalysts: params.catalyst ? [params.catalyst] : [],
        lastUpdatedAt: now,
        triggerDistance: params.triggerDistance ?? 0.3,
        consecutiveMentions: 1,
        decayFactor: DEFAULT_DECAY
      })
    }
  }

  /** Decay all scores toward zero — call once per pipeline cycle */
  decay(): void {
    for (const [symbol, entry] of this.board) {
      entry.score *= entry.decayFactor
      if (Math.abs(entry.score) < MIN_SCORE_THRESHOLD) {
        this.board.delete(symbol)
      }
    }
  }

  /** Update from strategist decisions — boost symbols the LLM traded, decay others */
  updateFromDirective(decision: string, legSymbols: string[]): void {
    for (const symbol of legSymbols) {
      const boost = decision === 'OPEN' ? 15 : -10
      this.update(symbol, { scoreDelta: boost, triggerDistance: boost > 0 ? 0.8 : undefined })
    }
  }

  /** Get top conviction symbols sorted by absolute score */
  topConvictions(n: number): ConvictionEntry[] {
    return [...this.board.values()]
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, n)
  }

  /** Get symbols closest to trigger */
  nearTrigger(n: number): ConvictionEntry[] {
    return [...this.board.values()]
      .filter((e) => e.triggerDistance > 0.2)
      .sort((a, b) => b.triggerDistance - a.triggerDistance)
      .slice(0, n)
  }

  snapshot(): ConvictionSnapshot {
    return {
      entries: [...this.board.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)),
      updatedAt: new Date().toISOString()
    }
  }

  /** Format for strategist prompt input */
  forPrompt(): Record<string, unknown> | null {
    const top = this.topConvictions(10)
    if (top.length === 0) return null

    return {
      label: 'conviction scoreboard — persistent cross-cycle watchlist',
      entries: top.map((e) => ({
        symbol: e.symbol,
        conviction: e.score > 0 ? `BULLISH ${e.score.toFixed(0)}` : `BEARISH ${Math.abs(e.score).toFixed(0)}`,
        triggerDistance: e.triggerDistance.toFixed(2),
        catalysts: e.catalysts.slice(-2).join('; '),
        mentions: e.consecutiveMentions
      }))
    }
  }

  async flush(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const data: ConvictionSnapshot = this.snapshot()
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
