import { readFile } from 'node:fs/promises'
import type { OutcomeMarket } from '@hl/privateer-contracts'
import { OutcomeMarketSchema } from '@hl/privateer-contracts'

export interface OutcomeMarketProvider {
  list(): Promise<OutcomeMarket[]>
  get(id: string): Promise<OutcomeMarket | undefined>
}

export class FixtureMarketProvider implements OutcomeMarketProvider {
  private cache: Map<string, OutcomeMarket> = new Map()
  private loaded = false

  constructor(private readonly path: string) {}

  private async ensure(): Promise<void> {
    if (this.loaded) return
    try {
      const text = await readFile(this.path, 'utf8')
      const raw = JSON.parse(text) as unknown[]
      for (const m of raw) {
        const parsed = OutcomeMarketSchema.parse(m)
        this.cache.set(parsed.id, parsed)
      }
    } catch {
      // empty fixture is fine
    }
    this.loaded = true
  }

  async list(): Promise<OutcomeMarket[]> {
    await this.ensure()
    return [...this.cache.values()]
  }

  async get(id: string): Promise<OutcomeMarket | undefined> {
    await this.ensure()
    return this.cache.get(id)
  }
}

export class InMemoryMarketProvider implements OutcomeMarketProvider {
  private cache = new Map<string, OutcomeMarket>()

  constructor(initial: OutcomeMarket[] = []) {
    for (const m of initial) this.cache.set(m.id, m)
  }

  upsert(m: OutcomeMarket): void {
    this.cache.set(m.id, OutcomeMarketSchema.parse(m))
  }

  async list(): Promise<OutcomeMarket[]> {
    return [...this.cache.values()]
  }

  async get(id: string): Promise<OutcomeMarket | undefined> {
    return this.cache.get(id)
  }
}
