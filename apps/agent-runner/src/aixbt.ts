type AixbtRawSignal = {
  id?: string
  projectId?: string
  projectName?: string
  category?: string
  description?: string
  detectedAt?: string
  reinforcedAt?: string | null
  activity?: Array<{
    date?: string
    source?: string
    incoming?: string
    result?: string
    cluster?: { name?: string }
  }>
}

type AixbtRawProject = {
  id?: string
  name?: string
  momentumScore?: number
  popularityScore?: number
  xHandle?: string | null
  rationale?: string
  coingeckoData?: {
    symbol?: string
    slug?: string
    categories?: string[]
  }
}

export type AixbtSignalSummary = {
  projectName: string
  category: string
  description: string
  detectedAt: string
  reinforcedAt: string | null
  sourceCount: number
}

export type AixbtProjectSummary = {
  name: string
  ticker: string
  momentumScore: number
  rationale: string
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
    const nameFilter = params.tickers.map((t) => t.toLowerCase()).slice(0, 50).join(',')

    const [signals, topProjects] = await Promise.all([
      aixbtGet<AixbtRawSignal[]>({
        path: '/signals',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          names: nameFilter,
          limit: '50',
          sortBy: 'reinforcedAt'
        }
      }).catch((): AixbtRawSignal[] => []),

      aixbtGet<AixbtRawProject[]>({
        path: '/projects',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          names: nameFilter,
          limit: '50',
          sortBy: 'momentumScore',
          excludeStables: 'true'
        }
      }).catch((): AixbtRawProject[] => [])
    ])

    const signalSummaries: AixbtSignalSummary[] = (Array.isArray(signals) ? signals : [])
      .slice(0, 30)
      .map((s) => ({
        projectName: sanitize(String(s.projectName ?? ''), 60),
        category: sanitize(String(s.category ?? ''), 40),
        description: sanitize(String(s.description ?? ''), 400),
        detectedAt: String(s.detectedAt ?? ''),
        reinforcedAt: typeof s.reinforcedAt === 'string' ? s.reinforcedAt : null,
        sourceCount: Array.isArray(s.activity) ? s.activity.length : 0
      }))
      .filter((s) => s.description.length > 0)

    const topMomentum: AixbtProjectSummary[] = (Array.isArray(topProjects) ? topProjects : [])
      .filter((p) => typeof p.momentumScore === 'number')
      .sort((a, b) => (b.momentumScore ?? 0) - (a.momentumScore ?? 0))
      .slice(0, 20)
      .map((p) => ({
        name: sanitize(String(p.name ?? ''), 60),
        ticker: sanitize(String(p.coingeckoData?.symbol ?? p.name ?? '').toUpperCase(), 20),
        momentumScore: p.momentumScore!,
        rationale: sanitize(String(p.rationale ?? ''), 200)
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
      projectName: s.projectName,
      category: s.category,
      description: s.description.slice(0, 300),
      detectedAt: s.detectedAt,
      reinforcedAt: s.reinforcedAt,
      sourceCount: s.sourceCount
    })),
    topMomentum: pack.topMomentum.slice(0, 10).map((p) => ({
      name: p.name,
      ticker: p.ticker,
      momentumScore: p.momentumScore,
      rationale: p.rationale
    }))
  }
}
