export interface RateLimiterConfig {
  tokensPerMinute: number
  startupDelayMs?: number
}

export interface RateLimiter {
  acquire(signal?: AbortSignal): Promise<void>
  tryAcquire(): boolean
  destroy(): void
}

interface Waiter {
  resolve: () => void
  reject: (reason: unknown) => void
  cleanup?: () => void
}

const REFILL_INTERVAL_MS = 100

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { tokensPerMinute, startupDelayMs } = config
  const tokensPerRefill = (tokensPerMinute / 60_000) * REFILL_INTERVAL_MS
  const maxTokens = tokensPerMinute / 60

  let tokens = maxTokens
  let destroyed = false
  let startupReady = !startupDelayMs

  const queue: Waiter[] = []

  if (startupDelayMs && startupDelayMs > 0) {
    setTimeout(() => {
      startupReady = true
      drain()
    }, startupDelayMs)
  }

  const refillTimer = setInterval(() => {
    if (destroyed) return
    tokens = Math.min(maxTokens, tokens + tokensPerRefill)
    drain()
  }, REFILL_INTERVAL_MS)

  function drain(): void {
    while (queue.length > 0 && tokens >= 1 && startupReady) {
      tokens -= 1
      const waiter = queue.shift()!
      waiter.cleanup?.()
      waiter.resolve()
    }
  }

  function acquire(signal?: AbortSignal): Promise<void> {
    if (destroyed) return Promise.reject(new Error('RateLimiter destroyed'))

    if (startupReady && tokens >= 1) {
      tokens -= 1
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject }

      if (signal) {
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
          return
        }
        const onAbort = () => {
          const idx = queue.indexOf(waiter)
          if (idx !== -1) queue.splice(idx, 1)
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort)
      }

      queue.push(waiter)
    })
  }

  function tryAcquire(): boolean {
    if (!startupReady || tokens < 1) return false
    tokens -= 1
    return true
  }

  function destroy(): void {
    destroyed = true
    clearInterval(refillTimer)
    const err = new Error('RateLimiter destroyed')
    for (const waiter of queue) {
      waiter.cleanup?.()
      waiter.reject(err)
    }
    queue.length = 0
  }

  return { acquire, tryAcquire, destroy }
}
