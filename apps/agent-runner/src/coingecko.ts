type CoinGeckoSearchCoin = {
  id: string
  name: string
  symbol: string
  market_cap_rank?: number
}

export type CoinGeckoMarketSnapshot = {
  id: string
  symbol: string
  name: string
  marketCapUsd: number
  volume24hUsd: number
  marketCapRank: number | null
  change24hPct: number | null
  change7dPct: number | null
  change30dPct: number | null
}

export type CoinGeckoCategorySnapshot = {
  id: string
  name: string
  marketCapChange24hPct: number | null
}

export type CoinGeckoClient = {
  getCoinIdForSymbol: (symbol: string) => Promise<string | null>
  fetchMarkets: (ids: string[]) => Promise<CoinGeckoMarketSnapshot[]>
  fetchCoinCategories: (id: string) => Promise<string[]>
  fetchCategories: () => Promise<CoinGeckoCategorySnapshot[]>
}

type ClientConfig = {
  apiKey: string
  baseUrl: string
  timeoutMs: number
}

type CacheEntry<T> = { value: T; fetchedAtMs: number }

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function urlWithParams(baseUrl: string, path: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function fetchJson<T>(url: string, config: ClientConfig): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-cg-pro-api-key': config.apiKey
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`coingecko http ${response.status}`)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function pickBestId(symbolUpper: string, coins: CoinGeckoSearchCoin[]): string | null {
  const matches = coins.filter((coin) => coin.symbol.toUpperCase() === symbolUpper)
  if (matches.length === 0) {
    return null
  }

  matches.sort((a, b) => (a.market_cap_rank ?? 9e9) - (b.market_cap_rank ?? 9e9))
  return matches[0]?.id ?? null
}

export function createCoinGeckoClient(params: { apiKey: string; baseUrl?: string; timeoutMs?: number }): CoinGeckoClient {
  const config: ClientConfig = {
    apiKey: params.apiKey,
    baseUrl: params.baseUrl ?? 'https://pro-api.coingecko.com/api/v3',
    timeoutMs: params.timeoutMs ?? 2000
  }

  const idBySymbol = new Map<string, CacheEntry<string | null>>()
  const marketById = new Map<string, CacheEntry<CoinGeckoMarketSnapshot>>()
  const categoriesById = new Map<string, CacheEntry<string[]>>()
  let categoriesCache: CacheEntry<CoinGeckoCategorySnapshot[]> | null = null

  const ID_TTL_MS = 30 * 24 * 60 * 60_000
  const MARKET_TTL_MS = 5 * 60_000
  const COIN_CATEGORIES_TTL_MS = 24 * 60 * 60_000
  const CATEGORIES_LIST_TTL_MS = 10 * 60_000

  const getCoinIdForSymbol = async (symbol: string): Promise<string | null> => {
    const upper = symbol.trim().toUpperCase()
    if (!upper) {
      return null
    }

    const cached = idBySymbol.get(upper)
    const nowMs = Date.now()
    if (cached && nowMs - cached.fetchedAtMs < ID_TTL_MS) {
      return cached.value
    }

    type SearchResponse = { coins?: unknown }
    const url = urlWithParams(config.baseUrl, '/search', { query: symbol })
    const raw = await fetchJson<SearchResponse>(url, config)
    const coinsRaw = (raw as any)?.coins
    const coins: CoinGeckoSearchCoin[] = Array.isArray(coinsRaw)
      ? coinsRaw
        .map((coin: any) => ({
          id: typeof coin?.id === 'string' ? coin.id : '',
          name: typeof coin?.name === 'string' ? coin.name : '',
          symbol: typeof coin?.symbol === 'string' ? coin.symbol : '',
          market_cap_rank: typeof coin?.market_cap_rank === 'number' ? coin.market_cap_rank : undefined
        }))
        .filter((coin: CoinGeckoSearchCoin) => coin.id && coin.symbol)
      : []

    const picked = pickBestId(upper, coins)
    idBySymbol.set(upper, { value: picked, fetchedAtMs: nowMs })
    return picked
  }

  const fetchMarkets = async (ids: string[]): Promise<CoinGeckoMarketSnapshot[]> => {
    const nowMs = Date.now()
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    if (unique.length === 0) {
      return []
    }

    const fresh: CoinGeckoMarketSnapshot[] = []
    const missing: string[] = []
    for (const id of unique) {
      const cached = marketById.get(id)
      if (cached && nowMs - cached.fetchedAtMs < MARKET_TTL_MS) {
        fresh.push(cached.value)
      } else {
        missing.push(id)
      }
    }

    if (missing.length === 0) {
      return fresh
    }

    type MarketRow = Record<string, unknown>
    const url = urlWithParams(config.baseUrl, '/coins/markets', {
      vs_currency: 'usd',
      ids: missing.join(','),
      order: 'market_cap_desc',
      per_page: 250,
      page: 1,
      sparkline: false,
      price_change_percentage: '24h,7d,30d'
    })
    const raw = await fetchJson<unknown>(url, config)
    const rows: MarketRow[] = Array.isArray(raw) ? (raw as MarketRow[]) : []

    const parsed: CoinGeckoMarketSnapshot[] = []
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? String(row.id) : ''
      if (!id) {
        continue
      }

      const snapshot: CoinGeckoMarketSnapshot = {
        id,
        symbol: typeof row?.symbol === 'string' ? String(row.symbol) : '',
        name: typeof row?.name === 'string' ? String(row.name) : '',
        marketCapUsd: asFiniteNumber(row?.market_cap) ?? 0,
        volume24hUsd: asFiniteNumber(row?.total_volume) ?? 0,
        marketCapRank: typeof row?.market_cap_rank === 'number' && Number.isFinite(row.market_cap_rank) ? row.market_cap_rank : null,
        change24hPct: asFiniteNumber((row as any)?.price_change_percentage_24h_in_currency),
        change7dPct: asFiniteNumber((row as any)?.price_change_percentage_7d_in_currency),
        change30dPct: asFiniteNumber((row as any)?.price_change_percentage_30d_in_currency)
      }

      marketById.set(id, { value: snapshot, fetchedAtMs: nowMs })
      parsed.push(snapshot)
    }

    return [...fresh, ...parsed]
  }

  const fetchCoinCategories = async (id: string): Promise<string[]> => {
    const trimmed = id.trim()
    if (!trimmed) {
      return []
    }

    const nowMs = Date.now()
    const cached = categoriesById.get(trimmed)
    if (cached && nowMs - cached.fetchedAtMs < COIN_CATEGORIES_TTL_MS) {
      return cached.value
    }

    const url = urlWithParams(config.baseUrl, `/coins/${encodeURIComponent(trimmed)}`, {
      localization: false,
      tickers: false,
      market_data: false,
      community_data: false,
      developer_data: false,
      sparkline: false
    })
    const raw = await fetchJson<Record<string, unknown>>(url, config)
    const categoriesRaw = (raw as any)?.categories
    const categories = Array.isArray(categoriesRaw)
      ? categoriesRaw.map((value: unknown) => String(value)).map((value: string) => value.trim()).filter(Boolean).slice(0, 12)
      : []

    categoriesById.set(trimmed, { value: categories, fetchedAtMs: nowMs })
    return categories
  }

  const fetchCategories = async (): Promise<CoinGeckoCategorySnapshot[]> => {
    const nowMs = Date.now()
    if (categoriesCache && nowMs - categoriesCache.fetchedAtMs < CATEGORIES_LIST_TTL_MS) {
      return categoriesCache.value
    }

    const url = urlWithParams(config.baseUrl, '/coins/categories', { order: 'market_cap_desc' })
    const raw = await fetchJson<unknown>(url, config)
    const rows: Array<Record<string, unknown>> = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []

    const parsed: CoinGeckoCategorySnapshot[] = rows
      .map((row) => ({
        id: typeof row?.id === 'string' ? String(row.id) : '',
        name: typeof row?.name === 'string' ? String(row.name) : '',
        marketCapChange24hPct: asFiniteNumber((row as any)?.market_cap_change_24h)
      }))
      .filter((row) => row.id && row.name)
      .slice(0, 250)

    categoriesCache = { value: parsed, fetchedAtMs: nowMs }
    return parsed
  }

  return {
    getCoinIdForSymbol,
    fetchMarkets,
    fetchCoinCategories,
    fetchCategories
  }
}
