const DEFAULT_HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

export interface HyperliquidCandle {
  // Start time (ms)
  t: number
  // End time (ms)
  T: number
  // Symbol
  s: string
  // Interval string (e.g. "1m")
  i: string
  // Open / close / high / low
  o: string
  c: string
  h: string
  l: string
  // Volume + trade count
  v: string
  n: number
}

export interface HyperliquidFundingEntry {
  coin: string
  fundingRate: string
  premium: string
  time: number
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const timeoutMs = 2500
  const retries = 3
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`hyperliquid info http ${response.status}`)
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (attempt >= retries) {
        break
      }
      // Mitigate occasional TLS/DNS edge failures by retrying with jitter.
      const backoffMs = 150 * (attempt + 1) + Math.floor(Math.random() * 150)
      await sleep(backoffMs)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchCandleSnapshot(params: {
  coin: string
  interval: string
  startTime: number
  endTime: number
  infoUrl?: string
}): Promise<HyperliquidCandle[]> {
  const infoUrl = params.infoUrl ?? DEFAULT_HL_INFO_URL
  return await postJson<HyperliquidCandle[]>(infoUrl, {
    type: 'candleSnapshot',
    req: {
      coin: params.coin,
      interval: params.interval,
      startTime: params.startTime,
      endTime: params.endTime
    }
  })
}

export async function fetchFundingHistory(params: {
  coin: string
  startTime: number
  infoUrl?: string
}): Promise<HyperliquidFundingEntry[]> {
  const infoUrl = params.infoUrl ?? DEFAULT_HL_INFO_URL
  return await postJson<HyperliquidFundingEntry[]>(infoUrl, {
    type: 'fundingHistory',
    coin: params.coin,
    startTime: params.startTime
  })
}

export function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
