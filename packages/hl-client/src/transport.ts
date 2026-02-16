import type { IRequestTransport } from '@nktkas/hyperliquid'
import type { RateLimiter } from './rate-limiter'
import type { ResponseCache } from './cache'
import { getTtlForPayload, stableCacheKey } from './cache'

export interface ThrottledTransportConfig {
  limiter: RateLimiter
  cache: ResponseCache
}

export class ThrottledTransport implements IRequestTransport {
  readonly isTestnet: boolean
  private readonly inner: IRequestTransport
  private readonly limiter: RateLimiter
  private readonly cache: ResponseCache

  constructor(inner: IRequestTransport, config: ThrottledTransportConfig) {
    this.inner = inner
    this.isTestnet = inner.isTestnet
    this.limiter = config.limiter
    this.cache = config.cache
  }

  async request<T>(endpoint: "info" | "exchange" | "explorer", payload: unknown, signal?: AbortSignal): Promise<T> {
    if (endpoint !== 'info') {
      await this.limiter.acquire(signal)
      return this.inner.request<T>(endpoint, payload, signal)
    }

    const ttl = getTtlForPayload(payload)
    if (ttl === null) {
      await this.limiter.acquire(signal)
      return this.inner.request<T>(endpoint, payload, signal)
    }

    const key = stableCacheKey(payload)
    return this.cache.getOrFetch<T>(key, ttl, async () => {
      await this.limiter.acquire(signal)
      return this.inner.request<T>(endpoint, payload, signal)
    })
  }
}
