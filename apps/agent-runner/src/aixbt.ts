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

type AixbtRawMomentumPoint = {
  timestamp?: string
  momentumScore?: number
  tweetCount?: number
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

export type AixbtMomentumPoint = {
  timestamp: string
  momentumScore: number
  tweetCount: number
}

export type AixbtProjectMomentumSummary = {
  projectId: string
  name: string
  ticker: string
  history: AixbtMomentumPoint[]
  trend: 'rising' | 'falling' | 'flat' | 'insufficient_data'
}

export type AixbtIntelPack = {
  fetchedAt: string
  ok: boolean
  basketSignals: AixbtSignalSummary[]
  signals: AixbtSignalSummary[]
  topMomentum: AixbtProjectSummary[]
  momentumHistory: AixbtProjectMomentumSummary[]
  indigoInsight: string | null
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

// Trading-relevant signal categories only — excludes OPINION_SPECULATION and VISIBILITY_EVENT
const TRADING_SIGNAL_CATEGORIES = [
  'FINANCIAL_EVENT', 'TOKEN_ECONOMICS', 'TECH_EVENT', 'MARKET_ACTIVITY',
  'ONCHAIN_METRICS', 'WHALE_ACTIVITY', 'RISK_ALERT', 'REGULATORY', 'PARTNERSHIP'
].join(',')

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

function normalizeSignals(raw: AixbtRawSignal[], limit: number): AixbtSignalSummary[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, limit)
    .map((s) => ({
      projectName: sanitize(String(s.projectName ?? ''), 60),
      category: sanitize(String(s.category ?? ''), 40),
      description: sanitize(String(s.description ?? ''), 400),
      detectedAt: String(s.detectedAt ?? ''),
      reinforcedAt: typeof s.reinforcedAt === 'string' ? s.reinforcedAt : null,
      sourceCount: Array.isArray(s.activity) ? s.activity.length : 0
    }))
    .filter((s) => s.description.length > 0)
}

function normalizeProjects(raw: AixbtRawProject[], limit: number): AixbtProjectSummary[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => typeof p.momentumScore === 'number')
    .sort((a, b) => (b.momentumScore ?? 0) - (a.momentumScore ?? 0))
    .slice(0, limit)
    .map((p) => ({
      name: sanitize(String(p.name ?? ''), 60),
      ticker: sanitize(String(p.coingeckoData?.symbol ?? p.name ?? '').toUpperCase(), 20),
      momentumScore: p.momentumScore!,
      rationale: sanitize(String(p.rationale ?? ''), 200)
    }))
}

function computeMomentumTrend(history: AixbtMomentumPoint[]): AixbtProjectMomentumSummary['trend'] {
  if (history.length < 6) return 'insufficient_data'
  const recent = history.slice(-3).map((h) => h.momentumScore)
  const prior = history.slice(-6, -3).map((h) => h.momentumScore)
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
  const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length
  const delta = recentAvg - priorAvg
  if (delta > 0.05) return 'rising'
  if (delta < -0.05) return 'falling'
  return 'flat'
}

async function fetchProjectMomentum(params: {
  projectId: string
  name: string
  ticker: string
  apiKey: string
  timeoutMs: number
}): Promise<AixbtProjectMomentumSummary> {
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const raw = await aixbtGet<AixbtRawMomentumPoint[]>({
    path: `/projects/${params.projectId}/momentum`,
    apiKey: params.apiKey,
    timeoutMs: params.timeoutMs,
    query: { start }
  }).catch((): AixbtRawMomentumPoint[] => [])

  const history: AixbtMomentumPoint[] = (Array.isArray(raw) ? raw : [])
    .filter((p) => typeof p.timestamp === 'string' && typeof p.momentumScore === 'number')
    .map((p) => ({
      timestamp: p.timestamp!,
      momentumScore: p.momentumScore!,
      tweetCount: typeof p.tweetCount === 'number' ? p.tweetCount : 0
    }))
    .slice(0, 48)

  return {
    projectId: params.projectId,
    name: params.name,
    ticker: params.ticker,
    history,
    trend: computeMomentumTrend(history)
  }
}

async function fetchIndigoInsight(params: {
  apiKey: string
  tickers: string[]
  timeoutMs: number
}): Promise<string | null> {
  const tickerList = params.tickers.join(', ')
  const question = `For crypto tokens ${tickerList}: summarize the most significant AIXBT signals from the last 48 hours — include whale activity, risk alerts, tech events, financial events, and key partnerships. What are the trading implications for each? Be concise and specific.`

  try {
    const response = await fetchWithTimeout(
      'https://api.aixbt.tech/v2/agents/indigo',
      {
        method: 'POST',
        headers: {
          'x-api-key': params.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: question }] })
      },
      params.timeoutMs
    )

    if (!response.ok) return null

    const json = (await response.json()) as { status: number; data?: { text?: string } }
    const text = json?.data?.text
    return typeof text === 'string' && text.trim() ? sanitize(text, 1200) : null
  } catch {
    return null
  }
}

export async function fetchAixbtIntel(params: {
  apiKey: string
  tickers: string[]
  timeoutMs: number
  cacheTtlMs?: number
  indigoEnabled?: boolean
}): Promise<AixbtIntelPack> {
  const nowMs = Date.now()
  const ttl = params.cacheTtlMs ?? CACHE_TTL_MS

  if (cache && nowMs < cache.expiresAtMs) {
    return cache.data
  }

  const fetchedAt = new Date().toISOString()
  const tickerFilter = params.tickers.map((t) => t.toLowerCase()).slice(0, 20).join(',')
  const reinforcedAfter = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString()

  try {
    // Phase 1: all independent fetches in parallel
    const [basketSignalsRaw, broadSignalsRaw, basketProjectsRaw, topProjectsRaw, indigoText] = await Promise.all([
      // Basket-specific signals via tickers param — precise match, time-bounded
      aixbtGet<AixbtRawSignal[]>({
        path: '/signals',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          tickers: tickerFilter,
          categories: TRADING_SIGNAL_CATEGORIES,
          reinforcedAfter,
          limit: '20',
          sortBy: 'reinforcedAt'
        }
      }).catch((): AixbtRawSignal[] => []),

      // Broad market signals — top recent signals across all crypto for macro context
      aixbtGet<AixbtRawSignal[]>({
        path: '/signals',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          categories: TRADING_SIGNAL_CATEGORIES,
          reinforcedAfter,
          limit: '30',
          sortBy: 'reinforcedAt'
        }
      }).catch((): AixbtRawSignal[] => []),

      // Basket projects — fetched by tickers to get project IDs for momentum history
      aixbtGet<AixbtRawProject[]>({
        path: '/projects',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          tickers: tickerFilter,
          limit: '10',
          sortBy: 'momentumScore',
          excludeStables: 'true'
        }
      }).catch((): AixbtRawProject[] => []),

      // Top momentum globally — market-wide momentum leaderboard
      aixbtGet<AixbtRawProject[]>({
        path: '/projects',
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
        query: {
          limit: '20',
          sortBy: 'momentumScore',
          excludeStables: 'true'
        }
      }).catch((): AixbtRawProject[] => []),

      // Indigo AI synthesis of basket signals
      params.indigoEnabled !== false
        ? fetchIndigoInsight({ apiKey: params.apiKey, tickers: params.tickers, timeoutMs: params.timeoutMs })
        : Promise.resolve(null)
    ])

    // Phase 2: momentum history requires project IDs from phase 1
    const basketProjectsWithIds = (Array.isArray(basketProjectsRaw) ? basketProjectsRaw : [])
      .filter((p): p is AixbtRawProject & { id: string } => typeof p.id === 'string' && p.id.length > 0)
      .slice(0, 6)

    const momentumHistory = await Promise.all(
      basketProjectsWithIds.map((p) =>
        fetchProjectMomentum({
          projectId: p.id,
          name: sanitize(String(p.name ?? ''), 60),
          ticker: sanitize(String(p.coingeckoData?.symbol ?? p.name ?? '').toUpperCase(), 20),
          apiKey: params.apiKey,
          timeoutMs: params.timeoutMs
        })
      )
    )

    const basketSignals = normalizeSignals(basketSignalsRaw as AixbtRawSignal[], 20)
    const signals = normalizeSignals(broadSignalsRaw as AixbtRawSignal[], 30)
    const topMomentum = normalizeProjects(topProjectsRaw as AixbtRawProject[], 20)

    const pack: AixbtIntelPack = {
      fetchedAt,
      ok: basketSignals.length > 0 || signals.length > 0 || topMomentum.length > 0,
      basketSignals,
      signals,
      topMomentum,
      momentumHistory,
      indigoInsight: typeof indigoText === 'string' ? indigoText : null
    }

    cache = { data: pack, expiresAtMs: nowMs + ttl }
    return pack
  } catch (error) {
    const pack: AixbtIntelPack = {
      fetchedAt,
      ok: false,
      basketSignals: [],
      signals: [],
      topMomentum: [],
      momentumHistory: [],
      indigoInsight: null,
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

    // Basket-specific signals — most actionable, ticker-matched
    basketSignalCount: pack.basketSignals.length,
    basketSignals: pack.basketSignals.slice(0, 10).map((s) => ({
      projectName: s.projectName,
      category: s.category,
      description: s.description.slice(0, 300),
      detectedAt: s.detectedAt,
      reinforcedAt: s.reinforcedAt,
      sourceCount: s.sourceCount
    })),

    // Hourly momentum time-series for basket assets
    momentumHistory: pack.momentumHistory.map((p) => ({
      name: p.name,
      ticker: p.ticker,
      trend: p.trend,
      recentHours: p.history.slice(-6).map((h) => ({
        timestamp: h.timestamp,
        momentumScore: h.momentumScore,
        tweetCount: h.tweetCount
      }))
    })),

    // Indigo AI synthesis of basket signals
    indigoInsight: pack.indigoInsight ? pack.indigoInsight.slice(0, 800) : null,

    // Broad market context
    broadSignalCount: pack.signals.length,
    signals: pack.signals.slice(0, 10).map((s) => ({
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
