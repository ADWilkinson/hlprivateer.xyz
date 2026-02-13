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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(`hyperliquid info http ${response.status}`)
  }

  return (await response.json()) as T
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

