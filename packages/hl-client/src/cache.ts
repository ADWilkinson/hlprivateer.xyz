export interface CacheConfig {
  defaultTtlMs?: number
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

export interface ResponseCache {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T, ttlMs: number): void
  getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T>
  clear(): void
  size(): number
}

const TTL_MAP: Record<string, number> = {
  openOrders: 4_000,
  clearinghouseState: 4_000,
  spotClearinghouseState: 10_000,
  userAbstraction: 300_000,
  userFills: 60_000,
  l2Book: 2_500,
  metaAndAssetCtxs: 60_000,
  candleSnapshot: 30_000,
  fundingHistory: 300_000,
}

const NEVER_CACHE = new Set(['orderStatus'])

export function getTtlForPayload(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const type = (payload as Record<string, unknown>).type
  if (typeof type !== 'string') return null
  if (NEVER_CACHE.has(type)) return null
  return TTL_MAP[type] ?? null
}

export function stableCacheKey(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(value).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k]
      }
      return sorted
    }
    return value
  })
}

export function createResponseCache(config?: CacheConfig): ResponseCache {
  const defaultTtlMs = config?.defaultTtlMs ?? 4_000
  const entries = new Map<string, CacheEntry>()
  const inflight = new Map<string, Promise<unknown>>()

  let pruneCounter = 0
  function maybePrune(): void {
    pruneCounter += 1
    if (pruneCounter % 50 !== 0) return
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key)
    }
  }

  function get<T>(key: string): T | undefined {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key)
      return undefined
    }
    return entry.value as T
  }

  function set<T>(key: string, value: T, ttlMs: number): void {
    entries.set(key, { value, expiresAt: Date.now() + ttlMs })
    maybePrune()
  }

  async function getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = get<T>(key)
    if (cached !== undefined) return cached

    const existing = inflight.get(key)
    if (existing) return existing as Promise<T>

    const promise = fetcher().then((result) => {
      inflight.delete(key)
      set(key, result, ttlMs)
      return result
    }).catch((err) => {
      inflight.delete(key)
      throw err
    })

    inflight.set(key, promise)
    return promise
  }

  function clear(): void {
    entries.clear()
    inflight.clear()
  }

  return {
    get,
    set,
    getOrFetch,
    clear,
    size: () => entries.size,
  }
}
