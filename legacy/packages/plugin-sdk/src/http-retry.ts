export type RetryOptions = {
  /** Total retry attempts after the initial try. */
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  timeoutMs?: number
  label?: string
  /** Optional custom classification; return true to retry. */
  retryOnError?: (error: unknown) => boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(ms: number): number {
  // Full jitter-ish: 0.5x .. 1.5x
  const factor = 0.5 + Math.random()
  return Math.max(0, Math.round(ms * factor))
}

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // attempt: 0,1,2... (for retries)
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt))
  return jitter(exp)
}

function parseRetryAfterMs(retryAfter: string | null | undefined): number | null {
  if (!retryAfter) return null

  const trimmed = retryAfter.trim()
  if (!trimmed) return null

  // 1) delta-seconds
  const asSeconds = Number(trimmed)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000)
  }

  // 2) HTTP-date
  const asDate = Date.parse(trimmed)
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now()
    return delta > 0 ? delta : 0
  }

  return null
}

function isRetryableNetworkError(error: unknown): boolean {
  const anyErr = error as any
  const code = String(anyErr?.code ?? '')

  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) return true

  const msg = String(anyErr?.message ?? '')
  if (/timeout/i.test(msg)) return true
  if (/fetch failed/i.test(msg)) return true
  if (/network/i.test(msg)) return true

  return false
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 200
  const maxDelayMs = opts.maxDelayMs ?? 5_000

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const canRetry = attempt < maxRetries && (opts.retryOnError?.(error) ?? isRetryableNetworkError(error))
      if (!canRetry) {
        throw error
      }

      const waitMs = backoffDelayMs(attempt, baseDelayMs, maxDelayMs)
      await sleep(waitMs)
    }
  }

  throw lastError
}

export type FetchRetryOptions = RetryOptions & {
  retryOnStatus?: (status: number) => boolean
}

export async function fetchWithRetry(url: string, init: RequestInit, opts: FetchRetryOptions = {}): Promise<Response> {
  const retryOnStatus = opts.retryOnStatus ?? ((status) => status === 429 || status >= 500)

  return await withRetry(
    async () => {
      const controller = new AbortController()
      const timeout = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        })

        if (retryOnStatus(response.status)) {
          // If we're going to retry, consume the body to free the connection.
          try {
            await response.arrayBuffer()
          } catch {
            // ignore
          }

          if (response.status === 429) {
            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
            if (retryAfterMs !== null) {
              await sleep(retryAfterMs)
            }
          }

          throw new Error(`http ${response.status}`)
        }

        return response
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    },
    {
      ...opts,
      retryOnError: (error) => {
        const anyErr = error as any
        // Treat our synthetic http errors as retryable unless the status is not retryable.
        const msg = String(anyErr?.message ?? '')
        const match = msg.match(/http (\d+)/)
        if (match) {
          const status = Number(match[1])
          return retryOnStatus(status)
        }
        return opts.retryOnError?.(error) ?? isRetryableNetworkError(error)
      }
    }
  )
}

export async function fetchJsonWithRetry<T>(url: string, init: RequestInit, opts: FetchRetryOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, init, opts)
  if (!response.ok) {
    throw new Error(`http ${response.status}`)
  }
  return (await response.json()) as T
}
