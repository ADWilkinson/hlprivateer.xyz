import { fetchCandleSnapshot, type HyperliquidCandle } from './hyperliquid'

export interface TechnicalSignal {
  symbol: string
  rsi14: number | null
  trend1h: 'UP' | 'DOWN' | 'FLAT'
  trend4h: 'UP' | 'DOWN' | 'FLAT'
  trend1d: 'UP' | 'DOWN' | 'FLAT'
  fundingZScore: number | null
  atrPct: number | null
  volumeRatio: number | null
  computedAt: string
}

export interface TechnicalSignalPack {
  signals: Record<string, TechnicalSignal>
  computedAt: string
}

function parseClose(c: string): number {
  const v = Number(c)
  return Number.isFinite(v) && v > 0 ? v : 0
}

function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null

  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta > 0) avgGain += delta
    else avgLoss += Math.abs(delta)
  }

  avgGain /= period
  avgLoss /= period

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta > 0) {
      avgGain = (avgGain * (period - 1) + delta) / period
      avgLoss = (avgLoss * (period - 1)) / period
    } else {
      avgGain = (avgGain * (period - 1)) / period
      avgLoss = (avgLoss * (period - 1) + Math.abs(delta)) / period
    }
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  const rsi = 100 - (100 / (1 + rs))
  return Number.isFinite(rsi) ? Number(rsi.toFixed(2)) : null
}

function computeTrend(closes: number[]): 'UP' | 'DOWN' | 'FLAT' {
  if (closes.length < 5) return 'FLAT'

  // Simple EMA crossover: short (5) vs long (20 or available)
  const shortPeriod = Math.min(5, Math.floor(closes.length / 2))
  const longPeriod = Math.min(20, closes.length)

  const shortEma = ema(closes, shortPeriod)
  const longEma = ema(closes, longPeriod)

  if (shortEma == null || longEma == null) return 'FLAT'

  const diff = (shortEma - longEma) / longEma
  if (diff > 0.002) return 'UP'
  if (diff < -0.002) return 'DOWN'
  return 'FLAT'
}

function ema(values: number[], period: number): number | null {
  if (values.length === 0 || period <= 0) return null
  const k = 2 / (period + 1)
  let result = values[0]
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k)
  }
  return Number.isFinite(result) ? result : null
}

function computeAtrPct(candles: HyperliquidCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null

  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const high = Number(candles[i].h)
    const low = Number(candles[i].l)
    const prevClose = parseClose(candles[i - 1].c)
    if (!Number.isFinite(high) || !Number.isFinite(low) || prevClose <= 0) continue

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trs.push(tr)
  }

  if (trs.length < period) return null

  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
  }

  const lastClose = parseClose(candles[candles.length - 1].c)
  if (lastClose <= 0) return null

  const pct = (atr / lastClose) * 100
  return Number.isFinite(pct) ? Number(pct.toFixed(4)) : null
}

function computeVolumeRatio(candles: HyperliquidCandle[]): number | null {
  if (candles.length < 21) return null

  const volumes = candles.map((c) => Number(c.v)).filter(Number.isFinite)
  if (volumes.length < 21) return null

  const recent = volumes.slice(-1)[0]
  const avg20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20

  if (avg20 <= 0) return null
  const ratio = recent / avg20
  return Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null
}

export function computeFundingZScore(
  currentFunding: number,
  recentFundings: number[]
): number | null {
  if (recentFundings.length < 3) return null

  const mean = recentFundings.reduce((s, v) => s + v, 0) / recentFundings.length
  const variance = recentFundings.reduce((s, v) => s + (v - mean) ** 2, 0) / recentFundings.length
  const std = Math.sqrt(variance)

  if (std === 0) return 0
  const z = (currentFunding - mean) / std
  return Number.isFinite(z) ? Number(z.toFixed(2)) : null
}

export async function computeTechnicalSignals(params: {
  symbols: string[]
  postInfo: <T>(body: unknown) => Promise<T>
  fundingBySymbol?: Record<string, number>
  concurrency?: number
}): Promise<TechnicalSignalPack> {
  const concurrency = params.concurrency ?? 4
  const now = Date.now()
  const signals: Record<string, TechnicalSignal> = {}

  const work = params.symbols.map((symbol) => async () => {
    try {
      // Fetch 1h candles for 24h (RSI, ATR, trends)
      const candles1h = await fetchCandleSnapshot({
        postInfo: params.postInfo,
        coin: symbol,
        interval: '1h',
        startTime: now - 25 * 60 * 60_000,
        endTime: now
      })

      const closes1h = candles1h.map((c) => parseClose(c.c)).filter((c) => c > 0)
      const rsi14 = computeRsi(closes1h)
      const trend1h = computeTrend(closes1h.slice(-6))
      const trend4h = computeTrend(closes1h.slice(-12))
      const trend1d = computeTrend(closes1h)
      const atrPct = computeAtrPct(candles1h)
      const volumeRatio = computeVolumeRatio(candles1h)

      const fundingZScore = params.fundingBySymbol?.[symbol] != null
        ? computeFundingZScore(params.fundingBySymbol[symbol], []) // simplified — full history would need storage
        : null

      signals[symbol] = {
        symbol,
        rsi14,
        trend1h,
        trend4h,
        trend1d,
        fundingZScore,
        atrPct,
        volumeRatio,
        computedAt: new Date().toISOString()
      }
    } catch {
      // skip symbol on error
    }
  })

  // Run with concurrency limit
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (idx < work.length) {
      const current = idx++
      if (current < work.length) await work[current]()
    }
  })
  await Promise.all(workers)

  return { signals, computedAt: new Date().toISOString() }
}
