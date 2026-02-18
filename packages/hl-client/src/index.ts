import { HttpTransport } from '@nktkas/hyperliquid'
import type { IRequestTransport } from '@nktkas/hyperliquid'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRateLimiter, type RateLimiter, type RateLimiterConfig } from './rate-limiter'
import { createResponseCache, getTtlForPayload, stableCacheKey, type ResponseCache, type CacheConfig } from './cache'
import { ThrottledTransport, type ThrottledTransportConfig } from './transport'

export type { RateLimiter, RateLimiterConfig } from './rate-limiter'
export type { ResponseCache, CacheConfig } from './cache'
export { getTtlForPayload, stableCacheKey } from './cache'
export { createRateLimiter } from './rate-limiter'
export { createResponseCache } from './cache'
export { ThrottledTransport, type ThrottledTransportConfig } from './transport'

const DEFAULT_INFO_URL = 'https://api.hyperliquid.xyz/info'
const execFileAsync = promisify(execFile)

function isCertVerificationError(error: unknown): boolean {
  const text = String((error as any)?.message ?? error ?? '').toLowerCase()
  const code = String((error as any)?.code ?? '').toLowerCase()
  return (
    text.includes('certificate') ||
    text.includes('tls') ||
    code.includes('certificate') ||
    code.includes('tls')
  )
}

async function postInfoViaCurl<T>(infoUrl: string, body: unknown, timeoutMs: number): Promise<T> {
  const payload = JSON.stringify(body)
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000))
  const { stdout } = await execFileAsync('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--max-time',
    String(timeoutSec),
    '-H',
    'content-type: application/json',
    '--data',
    payload,
    infoUrl,
  ])

  return JSON.parse(stdout) as T
}

export interface HlClientConfig {
  isTestnet?: boolean
  apiUrl?: string
  timeout?: number
  tokensPerMinute: number
  startupDelayMs?: number
  infoUrl?: string
}

export interface HlClient {
  transport: IRequestTransport
  postInfo: <T>(body: unknown) => Promise<T>
  limiter: RateLimiter
  cache: ResponseCache
  destroy: () => void
}

export function createHlClient(config: HlClientConfig): HlClient {
  const inner = new HttpTransport({
    isTestnet: config.isTestnet,
    timeout: config.timeout,
    apiUrl: config.apiUrl,
  })

  const limiter = createRateLimiter({
    tokensPerMinute: config.tokensPerMinute,
    startupDelayMs: config.startupDelayMs,
  })

  const cache = createResponseCache()

  const transport = new ThrottledTransport(inner, { limiter, cache })

  const infoUrl = config.infoUrl ?? DEFAULT_INFO_URL
  const timeoutMs = config.timeout ?? 10_000

  async function postInfo<T>(body: unknown): Promise<T> {
    const ttl = getTtlForPayload(body)
    const key = ttl !== null ? stableCacheKey(body) : null

    if (key && ttl !== null) {
      const cached = cache.get<T>(key)
      if (cached !== undefined) return cached
    }

    await limiter.acquire()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(infoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (response.status === 429) {
        const backoff = 500 + Math.floor(Math.random() * 500)
        await new Promise((r) => setTimeout(r, backoff))
        await limiter.acquire()

        const retryResponse = await fetch(infoUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!retryResponse.ok) {
          throw new Error(`hyperliquid info http ${retryResponse.status}`)
        }

        const result = (await retryResponse.json()) as T
        if (key && ttl !== null) cache.set(key, result, ttl)
        return result
      }

      if (!response.ok) {
        throw new Error(`hyperliquid info http ${response.status}`)
      }

      const result = (await response.json()) as T
      if (key && ttl !== null) cache.set(key, result, ttl)
      return result
    } catch (error) {
      if (!isCertVerificationError(error)) {
        throw error
      }

      const result = await postInfoViaCurl<T>(infoUrl, body, timeoutMs)
      if (key && ttl !== null) cache.set(key, result, ttl)
      return result
    } finally {
      clearTimeout(timeout)
    }
  }

  function destroy(): void {
    limiter.destroy()
    cache.clear()
  }

  return { transport, postInfo, limiter, cache, destroy }
}
