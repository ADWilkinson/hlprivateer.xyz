import { readFile } from 'node:fs/promises'
import type { RawSentimentItem } from './scorer'

export interface SentimentSource {
  name: string
  poll(): Promise<RawSentimentItem[]>
}

export class FixtureSource implements SentimentSource {
  readonly name = 'fixture'
  private seen = new Set<string>()

  constructor(private readonly path: string) {}

  async poll(): Promise<RawSentimentItem[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return []
    }
    const items = JSON.parse(text) as RawSentimentItem[]
    const fresh: RawSentimentItem[] = []
    for (const it of items) {
      const key = `${it.marketId}|${it.source}|${it.url ?? it.summary}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      fresh.push(it)
    }
    return fresh
  }
}

export class InMemorySource implements SentimentSource {
  readonly name = 'memory'
  constructor(private readonly queue: RawSentimentItem[] = []) {}

  push(item: RawSentimentItem): void {
    this.queue.push(item)
  }

  async poll(): Promise<RawSentimentItem[]> {
    return this.queue.splice(0, this.queue.length)
  }
}
