import fs from 'node:fs/promises'

type TwitterCredsFile = {
  bearer_token?: unknown
  handle?: unknown
}

export type TwitterTweetSummary = {
  id: string
  url: string
  createdAt: string | null
  author: {
    id: string | null
    username: string | null
    name: string | null
    verified: boolean | null
  }
  text: string
  metrics: {
    likeCount: number | null
    retweetCount: number | null
    replyCount: number | null
    quoteCount: number | null
  }
}

export type TwitterQueryResult = {
  query: string
  fetchedAt: string
  tweets: TwitterTweetSummary[]
  error?: string
}

export type FearGreedSnapshot = {
  fetchedAt: string
  value: number | null
  classification: string | null
  timestamp: string | null
  error?: string
}

export type ExternalIntelPack = {
  computedAt: string
  symbols: string[]
  twitter: {
    enabled: boolean
    ok: boolean
    queries: TwitterQueryResult[]
    handleHint?: string
  }
  fearGreed: {
    ok: boolean
    snapshot: FearGreedSnapshot | null
  }
}

function sanitizeLine(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function decodeMaybeURIComponent(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!trimmed.includes('%')) return trimmed
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

async function loadTwitterCreds(params: { credsPath: string }): Promise<{ bearerToken: string | null; handleHint: string | null }> {
  try {
    const raw = await fs.readFile(params.credsPath, 'utf8')
    const parsed = JSON.parse(raw) as TwitterCredsFile
    const bearerRaw = typeof parsed?.bearer_token === 'string' ? parsed.bearer_token : ''
    const handleHint = typeof parsed?.handle === 'string' ? sanitizeLine(parsed.handle, 40) : null
    const bearerToken = bearerRaw ? decodeMaybeURIComponent(bearerRaw) : null
    return { bearerToken: bearerToken && bearerToken.trim() ? bearerToken.trim() : null, handleHint }
  } catch {
    return { bearerToken: null, handleHint: null }
  }
}

type TwitterApiResponse = {
  data?: Array<{
    id?: string
    text?: string
    created_at?: string
    author_id?: string
    public_metrics?: {
      like_count?: number
      retweet_count?: number
      reply_count?: number
      quote_count?: number
    }
  }>
  includes?: {
    users?: Array<{
      id?: string
      username?: string
      name?: string
      verified?: boolean
    }>
  }
  meta?: Record<string, unknown>
}

async function twitterSearchRecent(params: {
  bearerToken: string
  query: string
  maxResults: number
  timeoutMs: number
}): Promise<TwitterQueryResult> {
  const fetchedAt = new Date().toISOString()
  const maxResults = clampInt(params.maxResults, 5, 25)

  const query = sanitizeLine(params.query, 280)
  const url = new URL('https://api.twitter.com/2/tweets/search/recent')
  url.searchParams.set('query', query)
  url.searchParams.set('max_results', String(maxResults))
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id')
  url.searchParams.set('expansions', 'author_id')
  url.searchParams.set('user.fields', 'username,name,verified')

  try {
    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.bearerToken}`,
          'Content-Type': 'application/json'
        }
      },
      params.timeoutMs
    )

    const payloadRaw = await safeJson(response)
    if (!response.ok) {
      return {
        query,
        fetchedAt,
        tweets: [],
        error: `twitter status=${response.status} body=${sanitizeLine(
          typeof payloadRaw === 'string' ? payloadRaw : JSON.stringify(payloadRaw),
          240
        )}`
      }
    }

    if (typeof payloadRaw !== 'object' || payloadRaw === null) {
      return {
        query,
        fetchedAt,
        tweets: [],
        error: `twitter invalid JSON body: ${sanitizeLine(
          typeof payloadRaw === 'string' ? payloadRaw : JSON.stringify(payloadRaw),
          240
        )}`
      }
    }

    const payload = payloadRaw as TwitterApiResponse

    const users = payload.includes?.users ?? []
    const userById = new Map<string, { id: string; username: string | null; name: string | null; verified: boolean | null }>()
    for (const user of users) {
      const id = typeof user?.id === 'string' ? user.id : ''
      if (!id) continue
      userById.set(id, {
        id,
        username: typeof user.username === 'string' ? sanitizeLine(user.username, 32) : null,
        name: typeof user.name === 'string' ? sanitizeLine(user.name, 42) : null,
        verified: typeof user.verified === 'boolean' ? user.verified : null
      })
    }

    const tweets = payload.data ?? []
    const summarized = tweets
      .map((tweet) => {
        const id = typeof tweet?.id === 'string' ? tweet.id : ''
        if (!id) return null
        const authorId = typeof tweet.author_id === 'string' ? tweet.author_id : null
        const author = authorId ? userById.get(authorId) : undefined
        const text = typeof tweet?.text === 'string' ? sanitizeLine(tweet.text, 340) : ''
        const createdAt = typeof tweet?.created_at === 'string' ? tweet.created_at : null
        const metrics = tweet?.public_metrics ?? {}
        const safeMetric = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
        return {
          id,
          url: `https://x.com/i/web/status/${id}`,
          createdAt,
          author: {
            id: author?.id ?? authorId ?? null,
            username: author?.username ?? null,
            name: author?.name ?? null,
            verified: author?.verified ?? null
          },
          text,
          metrics: {
            likeCount: safeMetric(metrics.like_count),
            retweetCount: safeMetric(metrics.retweet_count),
            replyCount: safeMetric(metrics.reply_count),
            quoteCount: safeMetric(metrics.quote_count)
          }
        } satisfies TwitterTweetSummary
      })
      .filter((entry): entry is TwitterTweetSummary => Boolean(entry))

    summarized.sort((a, b) => (b.metrics.likeCount ?? 0) - (a.metrics.likeCount ?? 0))

    return {
      query,
      fetchedAt,
      tweets: summarized.slice(0, maxResults)
    }
  } catch (error) {
    return {
      query,
      fetchedAt,
      tweets: [],
      error: sanitizeLine(String(error), 240)
    }
  }
}

export async function buildExternalIntelPack(params: {
  symbols: string[]
  twitterCredsPath: string
  twitterBearerToken?: string
  twitterEnabled: boolean
  twitterMaxResults: number
  timeoutMs: number
}): Promise<ExternalIntelPack> {
  const computedAt = new Date().toISOString()
  const symbols = params.symbols.map((s) => sanitizeLine(String(s).toUpperCase(), 24)).filter(Boolean).slice(0, 12)

  const pack: ExternalIntelPack = {
    computedAt,
    symbols,
    twitter: {
      enabled: Boolean(params.twitterEnabled),
      ok: false,
      queries: []
    },
    fearGreed: {
      ok: false,
      snapshot: null
    }
  }

  const twitterBearer =
    params.twitterBearerToken && params.twitterBearerToken.trim()
      ? params.twitterBearerToken.trim()
      : (await loadTwitterCreds({ credsPath: params.twitterCredsPath })).bearerToken

  const handleHint =
    params.twitterBearerToken && params.twitterBearerToken.trim()
      ? null
      : (await loadTwitterCreds({ credsPath: params.twitterCredsPath })).handleHint
  if (handleHint) {
    pack.twitter.handleHint = handleHint
  }

  if (!pack.twitter.enabled || !twitterBearer) {
    pack.twitter.ok = false
  } else {
    const baseClauses = ['-is:retweet', 'lang:en']
    const symbolQueries = symbols.map((symbol) => {
      const cashtag = `$${symbol}`
      const symbolClause = symbol.length <= 5 ? `(${symbol} OR ${cashtag})` : symbol
      // Keep it practical: focus on perp/funding/flow chatter.
      const focus = '(perp OR perpetual OR funding OR liquidation OR OI OR "open interest" OR leverage OR hyperliquid)'
      return `${symbolClause} ${focus} ${baseClauses.join(' ')}`
    })

    const globalQueries = [
      `hyperliquid (funding OR liquidation OR outage OR bug OR exploit OR "risk") ${baseClauses.join(' ')}`,
      `perp funding (rotation OR squeeze OR unwind OR deleveraging) ${baseClauses.join(' ')}`
    ]

    const queries = [...symbolQueries, ...globalQueries].slice(0, 10)
    const results = await Promise.all(
      queries.map((query) =>
        twitterSearchRecent({
          bearerToken: twitterBearer,
          query,
          maxResults: params.twitterMaxResults,
          timeoutMs: params.timeoutMs
        })
      )
    )
    pack.twitter.queries = results
    pack.twitter.ok = results.some((r) => r.tweets.length > 0 && !r.error)
  }

  // Fear & greed is a single call; it's optional context, not a trading trigger.
  try {
    const response = await fetchWithTimeout(
      'https://api.alternative.me/fng/?limit=1&format=json',
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      params.timeoutMs
    )
    const payload = (await safeJson(response)) as any
    if (!response.ok) {
      pack.fearGreed.snapshot = {
        fetchedAt: new Date().toISOString(),
        value: null,
        classification: null,
        timestamp: null,
        error: `fng status=${response.status}`
      }
      pack.fearGreed.ok = false
    } else {
      const entry = Array.isArray(payload?.data) ? payload.data[0] : null
      const value = entry && typeof entry.value === 'string' ? Number(entry.value) : entry && typeof entry.value === 'number' ? entry.value : null
      pack.fearGreed.snapshot = {
        fetchedAt: new Date().toISOString(),
        value: typeof value === 'number' && Number.isFinite(value) ? value : null,
        classification: entry && typeof entry.value_classification === 'string' ? sanitizeLine(entry.value_classification, 40) : null,
        timestamp: entry && typeof entry.timestamp === 'string' ? sanitizeLine(entry.timestamp, 40) : null
      }
      pack.fearGreed.ok = true
    }
  } catch (error) {
    pack.fearGreed.snapshot = {
      fetchedAt: new Date().toISOString(),
      value: null,
      classification: null,
      timestamp: null,
      error: sanitizeLine(String(error), 120)
    }
    pack.fearGreed.ok = false
  }

  return pack
}

export function summarizeExternalIntel(pack: ExternalIntelPack): Record<string, unknown> {
  const compactTweets = (tweets: TwitterTweetSummary[]) =>
    tweets.slice(0, 4).map((tweet) => ({
      url: tweet.url,
      createdAt: tweet.createdAt,
      author: tweet.author.username ?? tweet.author.name ?? tweet.author.id ?? null,
      verified: tweet.author.verified ?? null,
      likes: tweet.metrics.likeCount ?? 0,
      retweets: tweet.metrics.retweetCount ?? 0,
      text: sanitizeLine(tweet.text, 180)
    }))

  return {
    computedAt: pack.computedAt,
    symbols: pack.symbols,
    twitter: {
      enabled: pack.twitter.enabled,
      ok: pack.twitter.ok,
      handleHint: pack.twitter.handleHint ?? null,
      queryCount: pack.twitter.queries.length,
      queries: pack.twitter.queries.slice(0, 8).map((result) => ({
        query: sanitizeLine(result.query, 180),
        fetchedAt: result.fetchedAt,
        tweetCount: result.tweets.length,
        error: result.error ? sanitizeLine(result.error, 180) : null,
        topTweets: compactTweets(result.tweets)
      }))
    },
    fearGreed: pack.fearGreed.snapshot
      ? {
          ok: pack.fearGreed.ok,
          fetchedAt: pack.fearGreed.snapshot.fetchedAt,
          value: pack.fearGreed.snapshot.value,
          classification: pack.fearGreed.snapshot.classification,
          timestamp: pack.fearGreed.snapshot.timestamp,
          error: pack.fearGreed.snapshot.error ? sanitizeLine(pack.fearGreed.snapshot.error, 160) : null
        }
      : null
  }
}
