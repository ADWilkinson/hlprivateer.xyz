import type { OutcomeMarket } from '@hl/privateer-contracts'
import { OutcomeMarketSchema } from '@hl/privateer-contracts'

export interface OutcomeMarketProvider {
  list(): Promise<OutcomeMarket[]>
  get(id: string): Promise<OutcomeMarket | undefined>
}

// Test helper. Production wires an HL-backed provider; this exists so test
// files don't have to repeat the trivial Map<id, OutcomeMarket> wrapper.
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
