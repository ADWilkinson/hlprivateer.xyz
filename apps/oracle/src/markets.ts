import { readFile } from 'node:fs/promises'
import type { OutcomeMarket } from '@hl/privateer-contracts'
import { OutcomeMarketSchema } from '@hl/privateer-contracts'

/**
 * Read access to the universe of HIP-4 outcome markets and their order-book
 * state. Implementations:
 *  - `FixtureMarketProvider` — local JSON, used in dev/tests.
 *  - `HyperliquidMarketProvider` — live HL Info API. Stubbed until @nktkas/hyperliquid
 *    surfaces HIP-4 endpoints; the wire-up point is documented in code.
 */
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

/**
 * Live provider stub. HIP-4 outcome markets share HyperCore's CLOB and account
 * model with spot/perps, so the same `postInfo` transport in `@hl/privateer-hl-client`
 * is used here once @nktkas/hyperliquid surfaces the HIP-4 info endpoints.
 *
 * Until then this stub is wire-compatible and returns an empty universe — the
 * orchestrator degrades to "no markets to trade" rather than failing.
 */
export class HyperliquidMarketProvider implements OutcomeMarketProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly postInfo: <T>(body: unknown) => Promise<T>) {}

  async list(): Promise<OutcomeMarket[]> {
    // TODO(HIP-4): swap for the real outcome-markets info call when the SDK
    // surfaces it (likely something like `{ type: 'outcomeMarkets' }`).
    return []
  }

  async get(_id: string): Promise<OutcomeMarket | undefined> {
    return undefined
  }
}
