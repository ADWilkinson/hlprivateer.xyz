import { readFile } from 'node:fs/promises'
import { ulid } from 'ulid'
import { SentimentItemSchema, type SentimentItem } from './contracts'

export interface SentimentSourceAdapter {
  name: string
  poll(): Promise<SentimentItem[]>
}

interface RawItem {
  marketId: string
  source: SentimentItem['source']
  summary: string
  url?: string
  observedAt?: string
}

function normalize(raw: RawItem): SentimentItem {
  return SentimentItemSchema.parse({
    id: ulid(),
    marketId: raw.marketId,
    source: raw.source,
    summary: raw.summary.slice(0, 1000),
    url: raw.url,
    observedAt: raw.observedAt ?? new Date().toISOString()
  })
}

export class FixtureSource implements SentimentSourceAdapter {
  readonly name = 'fixture'
  private seen = new Set<string>()

  constructor(private readonly path: string) {}

  async poll(): Promise<SentimentItem[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return []
    }
    const raws = JSON.parse(text) as RawItem[]
    const fresh: SentimentItem[] = []
    for (const raw of raws) {
      const key = `${raw.marketId}|${raw.source}|${raw.url ?? raw.summary}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      fresh.push(normalize(raw))
    }
    return fresh
  }
}

export class InMemorySource implements SentimentSourceAdapter {
  readonly name = 'memory'
  constructor(private readonly queue: RawItem[] = []) {}

  push(item: RawItem): void {
    this.queue.push(item)
  }

  async poll(): Promise<SentimentItem[]> {
    const drained = this.queue.splice(0, this.queue.length)
    return drained.map(normalize)
  }
}
