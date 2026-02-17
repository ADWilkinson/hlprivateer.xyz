type AixbtSignal = {
  id: string
  projectId: string
  projectName: string
  ticker: string
  category: string
  title: string
  summary: string
  detectedAt: string
  reinforcedAt: string | null
  sourceCount: number
}

type AixbtProject = {
  id: string
  name: string
  ticker: string
  momentumScore: number
  chain: string | null
  xHandle: string | null
}

type AixbtMomentumPoint = {
  timestamp: string
  score: number
}

export type AixbtSignalSummary = {
  ticker: string
  projectName: string
  category: string
  title: string
  summary: string
  detectedAt: string
  sourceCount: number
}

export type AixbtProjectSummary = {
  ticker: string
  name: string
  momentumScore: number
}

export type AixbtIntelPack = {
  fetchedAt: string
  ok: boolean
  signals: AixbtSignalSummary[]
  topMomentum: AixbtProjectSummary[]
  error?: string
}

type AixbtApiResponse<T> = {
  status: number
  data: T
  pagination?: {
    page: number
    limit: number
    totalCount: number
    hasMore: boolean
  }
}

type AixbtCacheEntry = {
  data: AixbtIntelPack
  expiresAtMs: number
}

let cache: AixbtCacheEntry | null = null

const CACHE_TTL_MS = 5 * 60_000

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function sanitize(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

async function aixbtGet<T>(params: {
  path: string
  apiKey: string
  timeoutMs: number
  query?: Record<string, string>
}): Promise<T> {
  const url = new URL(`https://api.aixbt.tech/v2${params.path}`)
  if (params.query) {
    for (const [key, value] of Object.entries(params.query)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: 'GET',
      headers: {
        'x-api-key': params.apiKey,
        'Content-Type': 'application/json'
      }
    },
    params.timeoutMs
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`aixbt ${params.path} status=${response.status} body=${sanitize(body, 200)}`)
  }

  const json = (await response.json()) as AixbtApiResponse<T>
  return json.data
}

export async function fetchAixbtIntel(params: {
  apiKey: string
  tickers: string[]
  timeoutMs: number
  cacheTtlMs?: number
}): Promise<AixbtIntelPack> {
  const nowMs = Date.now()
  const ttl = params.cacheTtlMs ?? CACHE_TTL_MS

  if (cache && nowMs < cache.expiresAtMs) {
    return cache.data
  }

  const fetchedAt = new Date().toISOString()

  try {
    const tickerFilter = params.tickers.slice(0, 50).join(',')

    const [signals, topProjects] = await Promise.all([
      aixbtGet<AixbtSignal[]>({
        path: '/signals',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          tickers: tickerFilter,
          limit: '50',
          sortBy: 'reinforcedAt'
        }
      }).catch((): AixbtSignal[] => []),

      aixbtGet<AixbtProject[]>({
        path: '/projects',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          tickers: tickerFilter,
          limit: '50',
          sortBy: 'momentumScore',
          excludeStables: 'true'
        }
      }).catch((): AixbtProject[] => [])
    ])

    const signalSummaries: AixbtSignalSummary[] = (Array.isArray(signals) ? signals : [])
      .slice(0, 30)
      .map((s) => ({
        ticker: sanitize(String(s.ticker ?? ''), 20),
        projectName: sanitize(String(s.projectName ?? ''), 60),
        category: sanitize(String(s.category ?? ''), 40),
        title: sanitize(String(s.title ?? ''), 120),
        summary: sanitize(String(s.summary ?? ''), 300),
        detectedAt: String(s.detectedAt ?? ''),
        sourceCount: typeof s.sourceCount === 'number' ? s.sourceCount : 0
      }))

    const topMomentum: AixbtProjectSummary[] = (Array.isArray(topProjects) ? topProjects : [])
      .filter((p) => typeof p.momentumScore === 'number')
      .sort((a, b) => (b.momentumScore ?? 0) - (a.momentumScore ?? 0))
      .slice(0, 20)
      .map((p) => ({
        ticker: sanitize(String(p.ticker ?? ''), 20),
        name: sanitize(String(p.name ?? ''), 60),
        momentumScore: p.momentumScore
      }))

    const pack: AixbtIntelPack = {
      fetchedAt,
      ok: signalSummaries.length > 0 || topMomentum.length > 0,
      signals: signalSummaries,
      topMomentum
    }

    cache = { data: pack, expiresAtMs: nowMs + ttl }
    return pack
  } catch (error) {
    const pack: AixbtIntelPack = {
      fetchedAt,
      ok: false,
      signals: [],
      topMomentum: [],
      error: sanitize(String(error), 200)
    }
    return pack
  }
}

export function summarizeAixbtIntel(pack: AixbtIntelPack): Record<string, unknown> {
  return {
    fetchedAt: pack.fetchedAt,
    ok: pack.ok,
    error: pack.error ?? null,
    signalCount: pack.signals.length,
    signals: pack.signals.slice(0, 15).map((s) => ({
      ticker: s.ticker,
      category: s.category,
      title: s.title,
      summary: s.summary.slice(0, 200),
      detectedAt: s.detectedAt,
      sourceCount: s.sourceCount
    })),
    topMomentum: pack.topMomentum.slice(0, 10).map((p) => ({
      ticker: p.ticker,
      name: p.name,
      momentumScore: p.momentumScore
    }))
  }
}
