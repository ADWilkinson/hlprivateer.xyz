const DEFAULT_HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

export interface HyperliquidCandle {
  t: number
  T: number
  s: string
  i: string
  o: string
  c: string
  h: string
  l: string
  v: string
  n: number
}

export interface HyperliquidFundingEntry {
  coin: string
  fundingRate: string
  premium: string
  time: number
}

let _postInfo: (<T>(body: unknown) => Promise<T>) | null = null

export function setPostInfo(fn: <T>(body: unknown) => Promise<T>): void {
  _postInfo = fn
}

export function getPostInfo(): <T>(body: unknown) => Promise<T> {
  if (!_postInfo) throw new Error('hl-client postInfo not initialized')
  return _postInfo
}

async function fallbackPost<T>(infoUrl: string, body: unknown): Promise<T> {
  const response = await fetch(infoUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`hyperliquid info http ${response.status}`)
  return (await response.json()) as T
}

export async function fetchCandleSnapshot(params: {
  coin: string
  interval: string
  startTime: number
  endTime: number
  postInfo?: <T>(body: unknown) => Promise<T>
  infoUrl?: string
}): Promise<HyperliquidCandle[]> {
  const body = {
    type: 'candleSnapshot',
    req: {
      coin: params.coin,
      interval: params.interval,
      startTime: params.startTime,
      endTime: params.endTime,
    },
  }
  if (params.postInfo) return params.postInfo(body)
  return fallbackPost(params.infoUrl ?? DEFAULT_HL_INFO_URL, body)
}

export async function fetchFundingHistory(params: {
  coin: string
  startTime: number
  postInfo?: <T>(body: unknown) => Promise<T>
  infoUrl?: string
}): Promise<HyperliquidFundingEntry[]> {
  const body = { type: 'fundingHistory', coin: params.coin, startTime: params.startTime }
  if (params.postInfo) return params.postInfo(body)
  return fallbackPost(params.infoUrl ?? DEFAULT_HL_INFO_URL, body)
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
