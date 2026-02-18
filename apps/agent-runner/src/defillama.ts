export type DefiLlamaChainTvlSnapshot = {
  name: string
  tvlUsd: number
}

export type DefiLlamaStablecoinChainSnapshot = {
  name: string
  circulatingUsd: number
}

export type DefiLlamaProtocolSnapshot = {
  name: string
  total24hUsd: number | null
  total7dUsd: number | null
  total30dUsd: number | null
  totalAllTimeUsd: number | null
  change1dPct: number | null
  change7dPct: number | null
}

export type DefiLlamaIntelPack = {
  fetchedAt: string
  ok: boolean
  chainTvlTop: DefiLlamaChainTvlSnapshot[]
  stablecoinChainsTop: DefiLlamaStablecoinChainSnapshot[]
  hyperliquidDex: DefiLlamaProtocolSnapshot | null
  hyperliquidFees: DefiLlamaProtocolSnapshot | null
  error?: string
}

type DefiLlamaCacheEntry = {
  expiresAtMs: number
  data: DefiLlamaIntelPack
}

let cache: DefiLlamaCacheEntry | null = null

function sanitize(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`status=${response.status} body=${sanitize(raw, 180)}`)
    }
    if (!raw.trim()) return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new Error(`invalid JSON body=${sanitize(raw, 180)}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeProtocolSnapshot(raw: unknown, fallbackName: string): DefiLlamaProtocolSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const name = typeof row.name === 'string' && row.name.trim() ? sanitize(row.name, 80) : fallbackName
  return {
    name,
    total24hUsd: finiteNumber(row.total24h),
    total7dUsd: finiteNumber(row.total7d),
    total30dUsd: finiteNumber(row.total30d),
    totalAllTimeUsd: finiteNumber(row.totalAllTime),
    change1dPct: finiteNumber(row.change_1d),
    change7dPct: finiteNumber(row.change_7d)
  }
}

export async function fetchDefiLlamaIntel(params: {
  enabled: boolean
  timeoutMs: number
  cacheTtlMs?: number
}): Promise<DefiLlamaIntelPack> {
  const fetchedAt = new Date().toISOString()
  if (!params.enabled) {
    return {
      fetchedAt,
      ok: false,
      chainTvlTop: [],
      stablecoinChainsTop: [],
      hyperliquidDex: null,
      hyperliquidFees: null
    }
  }

  const nowMs = Date.now()
  const ttlMs = Math.max(0, params.cacheTtlMs ?? 5 * 60_000)
  if (cache && nowMs < cache.expiresAtMs) {
    return cache.data
  }

  const errors: string[] = []
  let chainTvlTop: DefiLlamaChainTvlSnapshot[] = []
  let stablecoinChainsTop: DefiLlamaStablecoinChainSnapshot[] = []
  let hyperliquidDex: DefiLlamaProtocolSnapshot | null = null
  let hyperliquidFees: DefiLlamaProtocolSnapshot | null = null

  await Promise.all([
    (async () => {
      try {
        const raw = await fetchWithTimeout('https://api.llama.fi/v2/chains', params.timeoutMs)
        const rows = Array.isArray(raw) ? raw : []
        chainTvlTop = rows
          .map((row) => {
            if (!row || typeof row !== 'object') return null
            const obj = row as Record<string, unknown>
            const name = typeof obj.name === 'string' ? sanitize(obj.name, 60) : ''
            const tvlUsd = finiteNumber(obj.tvl)
            if (!name || tvlUsd === null) return null
            return { name, tvlUsd }
          })
          .filter((row): row is DefiLlamaChainTvlSnapshot => Boolean(row))
          .sort((a, b) => b.tvlUsd - a.tvlUsd)
          .slice(0, 8)
      } catch (error) {
        errors.push(`chains ${sanitize(String(error), 140)}`)
      }
    })(),
    (async () => {
      try {
        const raw = await fetchWithTimeout('https://stablecoins.llama.fi/stablecoinchains', params.timeoutMs)
        const rows = Array.isArray(raw) ? raw : []
        stablecoinChainsTop = rows
          .map((row) => {
            if (!row || typeof row !== 'object') return null
            const obj = row as Record<string, unknown>
            const name = typeof obj.name === 'string' ? sanitize(obj.name, 60) : ''
            const total = obj.totalCirculatingUSD as Record<string, unknown> | undefined
            const circulatingUsd = finiteNumber(total?.peggedUSD)
            if (!name || circulatingUsd === null) return null
            return { name, circulatingUsd }
          })
          .filter((row): row is DefiLlamaStablecoinChainSnapshot => Boolean(row))
          .sort((a, b) => b.circulatingUsd - a.circulatingUsd)
          .slice(0, 8)
      } catch (error) {
        errors.push(`stablecoins ${sanitize(String(error), 140)}`)
      }
    })(),
    (async () => {
      try {
        const raw = await fetchWithTimeout('https://api.llama.fi/summary/dexs/hyperliquid', params.timeoutMs)
        hyperliquidDex = normalizeProtocolSnapshot(raw, 'Hyperliquid DEX')
      } catch (error) {
        errors.push(`dex ${sanitize(String(error), 140)}`)
      }
    })(),
    (async () => {
      try {
        const raw = await fetchWithTimeout('https://api.llama.fi/summary/fees/hyperliquid', params.timeoutMs)
        hyperliquidFees = normalizeProtocolSnapshot(raw, 'Hyperliquid Fees')
      } catch (error) {
        errors.push(`fees ${sanitize(String(error), 140)}`)
      }
    })()
  ])

  const ok = chainTvlTop.length > 0 || stablecoinChainsTop.length > 0 || hyperliquidDex !== null || hyperliquidFees !== null
  const pack: DefiLlamaIntelPack = {
    fetchedAt,
    ok,
    chainTvlTop,
    stablecoinChainsTop,
    hyperliquidDex,
    hyperliquidFees,
    ...(errors.length > 0 ? { error: sanitize(errors.join(' | '), 300) } : {})
  }

  if (ttlMs > 0 && ok) {
    cache = {
      expiresAtMs: nowMs + ttlMs,
      data: pack
    }
  }

  return pack
}

export function summarizeDefiLlamaIntel(pack: DefiLlamaIntelPack): Record<string, unknown> {
  return {
    ok: pack.ok,
    fetchedAt: pack.fetchedAt,
    chainTvlTop: pack.chainTvlTop.slice(0, 6),
    stablecoinChainsTop: pack.stablecoinChainsTop.slice(0, 6),
    hyperliquid: {
      dex: pack.hyperliquidDex,
      fees: pack.hyperliquidFees
    },
    error: pack.error ? sanitize(pack.error, 240) : null
  }
}
