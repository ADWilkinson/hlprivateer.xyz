import fs from 'node:fs/promises'
import path from 'node:path'

export interface ResearchHistoryEntry {
  ts: string
  headline: string
  regime: string
  recommendation: string
  confidence: number
}

export interface RiskHistoryEntry {
  ts: string
  headline: string
  posture: string
  risks: string[]
  confidence: number
}

export interface DirectiveHistoryEntry {
  ts: string
  decision: string
  rationale: string
  confidence: number
  hadPlan: boolean
}

export interface IntelHistoryEntry {
  ts: string
  twitterOk: boolean
  fearGreedValue: number | null
  symbolCount: number
  tweetCount: number
}

type HistoryEntry = ResearchHistoryEntry | RiskHistoryEntry | DirectiveHistoryEntry | IntelHistoryEntry

export class HistoryStore<T extends HistoryEntry> {
  private entries: T[] = []
  private readonly maxEntries: number
  private readonly filePath: string

  constructor(dir: string, filename: string, maxEntries = 20) {
    this.filePath = path.join(dir, filename)
    this.maxEntries = maxEntries
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean)
      this.entries = lines
        .map((line) => {
          try {
            return JSON.parse(line) as T
          } catch {
            return null
          }
        })
        .filter((e): e is T => e !== null)
        .slice(-this.maxEntries)
    } catch {
      // File doesn't exist yet — start empty
    }
  }

  async push(entry: T): Promise<void> {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }
    await this.flush()
  }

  recent(n: number): T[] {
    return this.entries.slice(-n)
  }

  all(): T[] {
    return [...this.entries]
  }

  countConsecutiveFromEnd(predicate: (entry: T) => boolean): number {
    let count = 0
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (predicate(this.entries[i])) {
        count++
      } else {
        break
      }
    }
    return count
  }

  private async flush(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const ndjson = this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await fs.writeFile(this.filePath, ndjson, 'utf-8')
  }
}

export function formatHistoryForPrompt<T extends HistoryEntry>(
  label: string,
  entries: T[],
  fields: (keyof T)[]
): Record<string, unknown> | null {
  if (entries.length === 0) return null
  return {
    label,
    count: entries.length,
    entries: entries.map((e) => {
      const out: Record<string, unknown> = {}
      for (const f of fields) {
        out[f as string] = e[f]
      }
      return out
    })
  }
}
