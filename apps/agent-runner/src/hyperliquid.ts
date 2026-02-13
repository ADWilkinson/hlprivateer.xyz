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

