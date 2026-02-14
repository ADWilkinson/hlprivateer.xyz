type HyperliquidUniverseEntry = {
  szDecimals: number
  name: string
  maxLeverage: number
  isDelisted?: boolean
}

type HyperliquidMetaResponse = {
  universe: HyperliquidUniverseEntry[]
}

type HyperliquidAssetCtx = {
  funding?: string
  openInterest?: string
  dayNtlVlm?: string
  premium?: string
  oraclePx?: string
  markPx?: string
  midPx?: string
  prevDayPx?: string
  impactPxs?: string[]
  dayBaseVlm?: string
}

export type HyperliquidUniverseAsset = {
  symbol: string
  szDecimals: number
  maxLeverage: number
  isDelisted: boolean
  funding: number
  openInterest: number
  dayNtlVlmUsd: number
  premium: number
  oraclePx: number
  markPx: number
  midPx: number
  prevDayPx: number
  dayBaseVlm: number
}

function parseFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return 0
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJson<T>(url: string, body: unknown, timeoutMs?: number, retries = 3): Promise<T> {
  const effectiveTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : 2500

  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs)
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
      const backoffMs = 150 * (attempt + 1) + Math.floor(Math.random() * 150)
      await sleep(backoffMs)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchMetaAndAssetCtxs(infoUrl: string): Promise<HyperliquidUniverseAsset[]> {
  const payload = await postJson<[HyperliquidMetaResponse, HyperliquidAssetCtx[]]>(infoUrl, {
    type: 'metaAndAssetCtxs'
  })

  const meta = payload?.[0]
  const ctxs = payload?.[1]
  if (!meta?.universe || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) {
    throw new Error('invalid hyperliquid metaAndAssetCtxs response')
  }

  const out: HyperliquidUniverseAsset[] = []
  const count = Math.min(meta.universe.length, ctxs.length)
  for (let i = 0; i < count; i += 1) {
    const entry = meta.universe[i]
    const ctx = ctxs[i] ?? {}
    if (!entry?.name) {
      continue
    }
    out.push({
      symbol: String(entry.name).trim(),
      szDecimals: Number.isFinite(entry.szDecimals) ? entry.szDecimals : 0,
      maxLeverage: Number.isFinite(entry.maxLeverage) ? entry.maxLeverage : 0,
      isDelisted: Boolean(entry.isDelisted),
      funding: parseFiniteNumber(ctx.funding),
      openInterest: parseFiniteNumber(ctx.openInterest),
      dayNtlVlmUsd: parseFiniteNumber(ctx.dayNtlVlm),
      premium: parseFiniteNumber(ctx.premium),
      oraclePx: parseFiniteNumber(ctx.oraclePx),
      markPx: parseFiniteNumber(ctx.markPx),
      midPx: parseFiniteNumber(ctx.midPx),
      prevDayPx: parseFiniteNumber(ctx.prevDayPx),
      dayBaseVlm: parseFiniteNumber(ctx.dayBaseVlm)
    })
  }

  return out
}

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

export async function fetchCandleSnapshot(params: {
  infoUrl: string
  coin: string
  interval: string
  startTime: number
  endTime: number
  timeoutMs?: number
}): Promise<HyperliquidCandle[]> {
  return await postJson<HyperliquidCandle[]>(params.infoUrl, {
    type: 'candleSnapshot',
    req: {
      coin: params.coin,
      interval: params.interval,
      startTime: params.startTime,
      endTime: params.endTime
    }
  }, params.timeoutMs)
}
