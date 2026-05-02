import { fetchCandleSnapshot, type HyperliquidCandle } from './hyperliquid'

export type PriceFeature = {
  symbol: string
  windowMin: number
  interval: string
  samples: number
  retWindowPct: number
  ret60mPct: number | null
  volWindowPct: number
  corrToBase: number | null
  betaToBase: number | null
  relRetWindowPct: number | null
}

type ClosePoint = { t: number; c: number }

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(0, variance))
}

function returnsByTs(candles: Array<{ t: number; c: string }>): Map<number, number> {
  const closes: ClosePoint[] = candles
    .map((candle) => ({ t: candle.t, c: parseFiniteNumber(candle.c) }))
    .filter((entry): entry is ClosePoint => typeof entry.c === 'number' && entry.c > 0)
    .sort((a, b) => a.t - b.t)

  const out = new Map<number, number>()
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]
    const next = closes[i]
    if (!prev || !next) continue
    const r = Math.log(next.c / prev.c)
    if (Number.isFinite(r)) {
      out.set(next.t, r)
    }
  }
  return out
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length < 3 || right.length < 3 || left.length !== right.length) {
    return null
  }

  const meanLeft = left.reduce((sum, v) => sum + v, 0) / left.length
  const meanRight = right.reduce((sum, v) => sum + v, 0) / right.length

  let num = 0
  let denLeft = 0
  let denRight = 0
  for (let i = 0; i < left.length; i += 1) {
    const dl = left[i] - meanLeft
    const dr = right[i] - meanRight
    num += dl * dr
    denLeft += dl * dl
    denRight += dr * dr
  }

  const denom = Math.sqrt(denLeft * denRight)
  if (!Number.isFinite(denom) || denom === 0) {
    return null
  }

  const value = num / denom
  return Number.isFinite(value) ? value : null
}

function beta(left: number[], right: number[]): number | null {
  if (left.length < 3 || right.length < 3 || left.length !== right.length) {
    return null
  }

  const meanLeft = left.reduce((sum, v) => sum + v, 0) / left.length
  const meanRight = right.reduce((sum, v) => sum + v, 0) / right.length

  let cov = 0
  let varRight = 0
  for (let i = 0; i < left.length; i += 1) {
    const dl = left[i] - meanLeft
    const dr = right[i] - meanRight
    cov += dl * dr
    varRight += dr * dr
  }

  if (!Number.isFinite(varRight) || varRight === 0) {
    return null
  }

  const value = cov / varRight
  return Number.isFinite(value) ? value : null
}

function computeCloseSeries(candles: HyperliquidCandle[]): ClosePoint[] {
  return candles
    .map((candle) => ({ t: candle.t, c: parseFiniteNumber(candle.c) }))
    .filter((entry): entry is ClosePoint => typeof entry.c === 'number' && entry.c > 0)
    .sort((a, b) => a.t - b.t)
}

function computeWindowReturnPct(closes: ClosePoint[]): number | null {
  if (closes.length < 2) {
    return null
  }

  const first = closes[0]?.c ?? 0
  const last = closes[closes.length - 1]?.c ?? 0
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0 || last <= 0) {
    return null
  }

  const ret = (last / first - 1) * 100
  return Number.isFinite(ret) ? ret : null
}

function computeReturnSinceMinutesPct(closes: ClosePoint[], minutes: number): number | null {
  if (closes.length < 2) {
    return null
  }

  const last = closes[closes.length - 1]
  if (!last) {
    return null
  }

  const targetMs = minutes * 60_000
  let anchor: ClosePoint | null = null
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const candidate = closes[i]
    if (!candidate) {
      continue
    }
    if (last.t - candidate.t >= targetMs) {
      anchor = candidate
      break
    }
  }

  if (!anchor || anchor.c <= 0 || last.c <= 0) {
    return null
  }

  const ret = (last.c / anchor.c - 1) * 100
  return Number.isFinite(ret) ? ret : null
}

function computeVolPct(returns: number[]): number {
  const sigma = stdev(returns)
  const vol = sigma * Math.sqrt(Math.max(1, returns.length)) * 100
  return Number.isFinite(vol) ? vol : 0
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

export async function computePriceFeaturePack(params: {
  postInfo: <T>(body: unknown) => Promise<T>
  baseSymbol: string
  symbols: string[]
  windowMin: number
  interval?: string
  concurrency?: number
}): Promise<{ base: PriceFeature | null; bySymbol: Record<string, PriceFeature> }> {
  const interval = params.interval ?? '1m'
  const concurrency = params.concurrency ?? 6

  const endTime = Date.now()
  const startTime = endTime - params.windowMin * 60_000

  let baseCandles: HyperliquidCandle[] = []
  try {
    baseCandles = await fetchCandleSnapshot({
      postInfo: params.postInfo,
      coin: params.baseSymbol,
      interval,
      startTime,
      endTime,
    })
  } catch {
    return { base: null, bySymbol: {} }
  }

  const baseCloses = computeCloseSeries(baseCandles)
  const baseReturnsMap = returnsByTs(baseCandles)
  const baseReturns = [...baseReturnsMap.values()]
  const baseRetWindowPct = computeWindowReturnPct(baseCloses)
  const baseVolWindowPct = computeVolPct(baseReturns)

  const base: PriceFeature | null =
    typeof baseRetWindowPct === 'number'
      ? {
        symbol: params.baseSymbol,
        windowMin: params.windowMin,
        interval,
        samples: baseCloses.length,
        retWindowPct: Number(baseRetWindowPct.toFixed(4)),
        ret60mPct: computeReturnSinceMinutesPct(baseCloses, 60),
        volWindowPct: Number(baseVolWindowPct.toFixed(4)),
        corrToBase: 1,
        betaToBase: 1,
        relRetWindowPct: 0
      }
      : null

  const uniqueSymbols = [...new Set(params.symbols.map((s) => s.trim()).filter(Boolean))].filter(
    (symbol) => symbol.toUpperCase() !== params.baseSymbol.toUpperCase()
  )

  const rows = await mapWithConcurrency(uniqueSymbols, concurrency, async (symbol) => {
    try {
      const candles = await fetchCandleSnapshot({
        postInfo: params.postInfo,
        coin: symbol,
        interval,
        startTime,
        endTime,
      })

      const closes = computeCloseSeries(candles)
      const retWindowPct = computeWindowReturnPct(closes)
      if (typeof retWindowPct !== 'number') {
        return null
      }

      const returnsMap = returnsByTs(candles)
      const left: number[] = []
      const right: number[] = []
      for (const [ts, baseR] of baseReturnsMap.entries()) {
        const otherR = returnsMap.get(ts)
        if (typeof otherR === 'number') {
          left.push(otherR)
          right.push(baseR)
        }
      }

      const corr = correlation(left, right)
      const b = beta(left, right)
      const vol = computeVolPct([...returnsMap.values()])
      const rel = typeof baseRetWindowPct === 'number' ? retWindowPct - baseRetWindowPct : null

      const ret60mPct = computeReturnSinceMinutesPct(closes, 60)

      return {
        symbol,
        windowMin: params.windowMin,
        interval,
        samples: closes.length,
        retWindowPct: Number(retWindowPct.toFixed(4)),
        ret60mPct: typeof ret60mPct === 'number' ? Number(ret60mPct.toFixed(4)) : null,
        volWindowPct: Number(vol.toFixed(4)),
        corrToBase: typeof corr === 'number' ? Number(corr.toFixed(4)) : null,
        betaToBase: typeof b === 'number' ? Number(b.toFixed(4)) : null,
        relRetWindowPct: typeof rel === 'number' ? Number(rel.toFixed(4)) : null
      } satisfies PriceFeature
    } catch {
      return null
    }
  })

  const bySymbol: Record<string, PriceFeature> = {}
  for (const row of rows) {
    if (!row) continue
    bySymbol[row.symbol] = row
  }

  return { base, bySymbol }
}

