import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { fetchAixbtIntel, summarizeAixbtIntel, type AixbtIntelPack } from './aixbt'

type TwitterCredsFile = {
  bearer_token?: unknown
  auth_token?: unknown
  ct0?: unknown
  handle?: unknown
  consumer_key?: unknown
  consumer_secret?: unknown
  access_token?: unknown
  access_token_secret?: unknown
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
  aixbt: {
    enabled: boolean
    ok: boolean
    pack: AixbtIntelPack | null
  }
}

function sanitizeLine(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= maxLength) return cleaned
  const truncated = cleaned.slice(0, maxLength)
  const lastChar = truncated.charCodeAt(truncated.length - 1)
  if (lastChar >= 0xd800 && lastChar <= 0xdbff) return truncated.slice(0, -1)
  return truncated
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(items.length, concurrency))
  const results: R[] = new Array(items.length)
  let index = 0

  const workers = new Array(limit).fill(0).map(async () => {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) {
        break
      }
      results[current] = await fn(items[current] as T)
    }
  })

  await Promise.all(workers)
  return results
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

type TwitterCreds = {
  bearerToken: string | null
  authToken: string | null
  ct0: string | null
  handleHint: string | null
  consumerKey: string | null
  consumerSecret: string | null
  accessToken: string | null
  accessTokenSecret: string | null
}

type TwitterQueryCacheEntry = {
  key: string
  expiresAtMs: number
  results: TwitterQueryResult[]
  ok: boolean
}

let twitterQueryCache: TwitterQueryCacheEntry | null = null

async function loadTwitterCreds(params: { credsPath: string }): Promise<TwitterCreds> {
  try {
    const raw = await fs.readFile(params.credsPath, 'utf8')
    const parsed = JSON.parse(raw) as TwitterCredsFile
    const bearerRaw = typeof parsed?.bearer_token === 'string' ? parsed.bearer_token : ''
    const handleHint = typeof parsed?.handle === 'string' ? sanitizeLine(parsed.handle, 40) : null
    const bearerToken = bearerRaw ? decodeMaybeURIComponent(bearerRaw) : null
    const authToken = typeof parsed?.auth_token === 'string' && parsed.auth_token.trim() ? parsed.auth_token.trim() : null
    const ct0 = typeof parsed?.ct0 === 'string' && parsed.ct0.trim() ? parsed.ct0.trim() : null
    const consumerKey = typeof parsed?.consumer_key === 'string' && parsed.consumer_key.trim() ? parsed.consumer_key.trim() : null
    const consumerSecret = typeof parsed?.consumer_secret === 'string' && parsed.consumer_secret.trim() ? parsed.consumer_secret.trim() : null
    const accessTokenRaw = typeof parsed?.access_token === 'string' && parsed.access_token.trim() ? parsed.access_token.trim() : null
    const accessTokenSecret = typeof parsed?.access_token_secret === 'string' && parsed.access_token_secret.trim() ? parsed.access_token_secret.trim() : null
    return {
      bearerToken: bearerToken && bearerToken.trim() ? bearerToken.trim() : null,
      authToken,
      ct0,
      handleHint,
      consumerKey,
      consumerSecret,
      accessToken: accessTokenRaw,
      accessTokenSecret
    }
  } catch {
    return { bearerToken: null, authToken: null, ct0: null, handleHint: null, consumerKey: null, consumerSecret: null, accessToken: null, accessTokenSecret: null }
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

const TWITTER_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

function buildOAuth1Header(params: {
  method: string
  url: string
  queryParams: Record<string, string>
  consumerKey: string
  consumerSecret: string
  accessToken: string
  accessTokenSecret: string
}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: params.accessToken,
    oauth_version: '1.0'
  }

  const allParams: Record<string, string> = { ...params.queryParams, ...oauthParams }
  const sortedKeys = Object.keys(allParams).sort()
  const paramString = sortedKeys.map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(allParams[k]!)}`).join('&')
  const baseString = `${params.method.toUpperCase()}&${rfc3986Encode(params.url)}&${rfc3986Encode(paramString)}`
  const signingKey = `${rfc3986Encode(params.consumerSecret)}&${rfc3986Encode(params.accessTokenSecret)}`
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')

  oauthParams['oauth_signature'] = signature
  const headerParts = Object.keys(oauthParams).sort().map((k) => `${rfc3986Encode(k)}="${rfc3986Encode(oauthParams[k]!)}"`)
  return `OAuth ${headerParts.join(', ')}`
}

function buildTwitterHeaders(params: {
  bearerToken: string
  authToken?: string | null
  ct0?: string | null
  useCookie: boolean
}): Record<string, string> {
  if (params.useCookie && params.authToken && params.ct0) {
    return {
      Authorization: `Bearer ${decodeMaybeURIComponent(TWITTER_WEB_BEARER)}`,
      'Content-Type': 'application/json',
      Cookie: `auth_token=${params.authToken}; ct0=${params.ct0}`,
      'X-Csrf-Token': params.ct0
    }
  }
  return {
    Authorization: `Bearer ${params.bearerToken}`,
    'Content-Type': 'application/json'
  }
}

async function twitterSearchRecent(params: {
  bearerToken: string
  authToken?: string | null
  ct0?: string | null
  consumerKey?: string | null
  consumerSecret?: string | null
  accessToken?: string | null
  accessTokenSecret?: string | null
  query: string
  maxResults: number
  timeoutMs: number
}): Promise<TwitterQueryResult> {
  const fetchedAt = new Date().toISOString()
  const maxResults = clampInt(params.maxResults, 10, 100)

  const query = sanitizeLine(params.query, 280)
  const baseUrl = 'https://api.twitter.com/2/tweets/search/recent'
  const queryParams: Record<string, string> = {
    query,
    max_results: String(maxResults),
    'tweet.fields': 'created_at,public_metrics,author_id',
    expansions: 'author_id',
    'user.fields': 'username,name,verified'
  }
  const url = new URL(baseUrl)
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v)
  }

  const hasOAuth1 = Boolean(params.consumerKey && params.consumerSecret && params.accessToken && params.accessTokenSecret)
  const hasBearerCreds = Boolean(params.bearerToken)
  const hasCookieCreds = Boolean(params.authToken && params.ct0)

  type AuthStrategy = 'oauth1' | 'bearer' | 'cookie'
  const strategies: AuthStrategy[] = []
  if (hasOAuth1) strategies.push('oauth1')
  if (hasBearerCreds) strategies.push('bearer')
  if (hasCookieCreds) strategies.push('cookie')

  if (strategies.length === 0) {
    return { query, fetchedAt, tweets: [], error: 'no twitter credentials available' }
  }

  let lastError = ''
  for (const strategy of strategies) {
    let headers: Record<string, string>
    if (strategy === 'oauth1') {
      headers = {
        Authorization: buildOAuth1Header({
          method: 'GET',
          url: baseUrl,
          queryParams,
          consumerKey: params.consumerKey!,
          consumerSecret: params.consumerSecret!,
          accessToken: params.accessToken!,
          accessTokenSecret: params.accessTokenSecret!
        }),
        'Content-Type': 'application/json'
      }
    } else {
      headers = buildTwitterHeaders({ ...params, useCookie: strategy === 'cookie' })
    }
    try {
      const response = await fetchWithTimeout(
        url.toString(),
        { method: 'GET', headers },
        params.timeoutMs
      )

      const payloadRaw = await safeJson(response)
      if (!response.ok) {
        lastError = `twitter ${strategy} status=${response.status} body=${sanitizeLine(
          typeof payloadRaw === 'string' ? payloadRaw : JSON.stringify(payloadRaw),
          240
        )}`
        if (response.status === 401 || response.status === 403) {
          continue
        }
        return { query, fetchedAt, tweets: [], error: lastError }
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
      lastError = sanitizeLine(String(error), 240)
      continue
    }
  }

  return { query, fetchedAt, tweets: [], error: lastError || 'all twitter auth strategies failed' }
}

export async function buildExternalIntelPack(params: {
  symbols: string[]
  twitterCredsPath: string
  twitterBearerToken?: string
  twitterEnabled: boolean
  twitterMaxResults: number
  twitterCacheTtlMs?: number
  timeoutMs: number
  customQueries?: string[]
  cachedTwitter?: { data: ExternalIntelPack['twitter']; fetchedAtMs: number }
  twitterCooldownMs?: number
  aixbtApiKey?: string
  aixbtEnabled?: boolean
  aixbtTimeoutMs?: number
  aixbtCacheTtlMs?: number
}): Promise<ExternalIntelPack> {
  const computedAt = new Date().toISOString()
  const nowMs = Date.now()
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
    },
    aixbt: {
      enabled: Boolean(params.aixbtEnabled && params.aixbtApiKey),
      ok: false,
      pack: null
    }
  }

  const cooldownMs = params.twitterCooldownMs ?? 0
  const cached = params.cachedTwitter
  if (cached && cooldownMs > 0 && nowMs - cached.fetchedAtMs < cooldownMs) {
    pack.twitter = cached.data
  } else {
    const creds = await loadTwitterCreds({ credsPath: params.twitterCredsPath })
    if (params.twitterBearerToken && params.twitterBearerToken.trim()) {
      creds.bearerToken = decodeMaybeURIComponent(params.twitterBearerToken)
    }

    const twitterBearer = creds.bearerToken
    const hasCookieAuth = Boolean(creds.authToken && creds.ct0)
    const hasOAuth1 = Boolean(creds.consumerKey && creds.consumerSecret && creds.accessToken && creds.accessTokenSecret)

    if (creds.handleHint) {
      pack.twitter.handleHint = creds.handleHint
    }

    if (!pack.twitter.enabled || (!twitterBearer && !hasCookieAuth && !hasOAuth1)) {
      pack.twitter.ok = false
    } else {
      let queries: string[]
      if (params.customQueries && params.customQueries.length > 0) {
        queries = params.customQueries.slice(0, 10)
      } else {
        const baseClauses = ['-is:retweet', 'lang:en']
        const symbolQueries = symbols.map((symbol) => {
          const cashtag = `$${symbol}`
          const symbolClause = symbol.length <= 5 ? `(${symbol} OR ${cashtag})` : symbol
          const focus = '(perp OR perpetual OR funding OR liquidation OR OI OR "open interest" OR leverage OR hyperliquid)'
          return `${symbolClause} ${focus} ${baseClauses.join(' ')}`
        })

        const globalQueries = [
          `hyperliquid (funding OR liquidation OR outage OR bug OR exploit OR "risk") ${baseClauses.join(' ')}`,
          `perp funding (rotation OR squeeze OR unwind OR deleveraging) ${baseClauses.join(' ')}`
        ]

        queries = [...symbolQueries, ...globalQueries].slice(0, 10)
      }

      const cacheTtlMs = clampInt(params.twitterCacheTtlMs ?? 180_000, 0, 900_000)
      const cacheKey = JSON.stringify({
        maxResults: params.twitterMaxResults,
        hasBearer: Boolean(twitterBearer),
        hasCookie: hasCookieAuth,
        queries
      })

      if (cacheTtlMs > 0 && twitterQueryCache && twitterQueryCache.key === cacheKey && nowMs < twitterQueryCache.expiresAtMs) {
        pack.twitter.queries = twitterQueryCache.results
        pack.twitter.ok = twitterQueryCache.ok
      } else {
        const results = await mapWithConcurrency(queries, 2, async (query) =>
          twitterSearchRecent({
            bearerToken: twitterBearer ?? '',
            authToken: creds.authToken,
            ct0: creds.ct0,
            consumerKey: creds.consumerKey,
            consumerSecret: creds.consumerSecret,
            accessToken: creds.accessToken,
            accessTokenSecret: creds.accessTokenSecret,
            query,
            maxResults: params.twitterMaxResults,
            timeoutMs: params.timeoutMs
          })
        )
        pack.twitter.queries = results
        pack.twitter.ok = results.some((r) => r.tweets.length > 0 && !r.error)

        if (cacheTtlMs > 0 && results.some((result) => !result.error)) {
          twitterQueryCache = {
            key: cacheKey,
            expiresAtMs: nowMs + cacheTtlMs,
            results,
            ok: pack.twitter.ok
          }
        }
      }
    }
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

  if (pack.aixbt.enabled && params.aixbtApiKey) {
    try {
      const aixbtPack = await fetchAixbtIntel({
        apiKey: params.aixbtApiKey,
        tickers: symbols,
        timeoutMs: params.aixbtTimeoutMs ?? params.timeoutMs,
        cacheTtlMs: params.aixbtCacheTtlMs
      })
      pack.aixbt.pack = aixbtPack
      pack.aixbt.ok = aixbtPack.ok
    } catch (error) {
      pack.aixbt.ok = false
      pack.aixbt.pack = {
        fetchedAt: new Date().toISOString(),
        ok: false,
        signals: [],
        topMomentum: [],
        error: sanitizeLine(String(error), 200)
      }
    }
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

  const twitterStatusNote = !pack.twitter.enabled
    ? 'Twitter is DISABLED. This is a SUPPLEMENTARY source — trade using price/funding/OI data.'
    : !pack.twitter.ok
      ? 'Twitter is OFFLINE. This is a SUPPLEMENTARY source — it does NOT affect trading capability. Trade on price/funding/OI/orderbook data.'
      : null

  return {
    computedAt: pack.computedAt,
    symbols: pack.symbols,
    statusNote: twitterStatusNote
      ? `SUPPLEMENTARY DATA NOTE: ${twitterStatusNote}`
      : null,
    twitter: {
      enabled: pack.twitter.enabled,
      ok: pack.twitter.ok,
      statusNote: twitterStatusNote,
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
      : null,
    aixbt: pack.aixbt.pack
      ? summarizeAixbtIntel(pack.aixbt.pack)
      : { enabled: pack.aixbt.enabled, ok: false }
  }
}
