import { PluginContext, PluginRuntime } from '@hl/privateer-plugin-sdk'
import { fetchCandleSnapshot, parseFiniteNumber } from './hyperliquid'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function returnsByTs(candles: Array<{ t: number; c: string }>): Map<number, number> {
  const closes = candles
    .map((candle) => ({ t: candle.t, c: parseFiniteNumber(candle.c) }))
    .filter((entry): entry is { t: number; c: number } => typeof entry.c === 'number')
    .sort((a, b) => a.t - b.t)

  const out = new Map<number, number>()
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]
    const next = closes[i]
    if (!prev || !next) continue
    if (!prev.c || !next.c) continue
    const r = Math.log(next.c / prev.c)
    if (Number.isFinite(r)) {
      out.set(next.t, r)
    }
  }
  return out
}

function correlation(left: number[], right: number[]): number {
  if (left.length < 3 || right.length < 3 || left.length !== right.length) {
    return 0
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
    return 0
  }

  return num / denom
}

export default {
  manifest: {
    id: 'correlation',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.correlation'],
    permissions: ['market.read'],
    cooldownMs: 600000
  },
  initialize: async (context: PluginContext) => {
    ctx = context
  },
  poll: async () => {
    if (!ctx) {
      return []
    }

    const infoUrl = ctx.getConfig('HL_INFO_URL')
    const baseSymbol = (ctx.getConfig('HLP_CORR_BASE') ?? 'HYPE').trim() || 'HYPE'
    const basketCsv = ctx.getConfig('BASKET_SYMBOLS')
    if (!basketCsv) {
      return []
    }

    const basketSymbols = basketCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s.toUpperCase() !== baseSymbol.toUpperCase())

    if (basketSymbols.length === 0) {
      return []
    }

    const windowMinRaw = ctx.getConfig('HLP_CORR_WINDOW_MIN')
    const windowMin = clamp(Number(windowMinRaw ?? 60), 10, 360)
    const endTime = Date.now()
    const startTime = endTime - windowMin * 60_000

    const baseCandles = await fetchCandleSnapshot({
      coin: baseSymbol,
      interval: '1m',
      startTime,
      endTime,
      infoUrl: infoUrl || undefined
    })
    const baseReturns = returnsByTs(baseCandles)
    if (baseReturns.size < 5) {
      return []
    }

    const correlations: number[] = []
    for (const symbol of basketSymbols) {
      const candles = await fetchCandleSnapshot({
        coin: symbol,
        interval: '1m',
        startTime,
        endTime,
        infoUrl: infoUrl || undefined
      })
      const otherReturns = returnsByTs(candles)
      const left: number[] = []
      const right: number[] = []
      for (const [ts, baseR] of baseReturns.entries()) {
        const otherR = otherReturns.get(ts)
        if (typeof otherR === 'number') {
          left.push(baseR)
          right.push(otherR)
        }
      }
      const corr = correlation(left, right)
      if (Number.isFinite(corr)) {
        correlations.push(corr)
      }
    }

    if (correlations.length === 0) {
      return []
    }

    const avg = correlations.reduce((sum, v) => sum + v, 0) / correlations.length
    const value = Number.isFinite(avg) ? Number(avg.toFixed(4)) : 0

    return [
      {
        pluginId: 'correlation',
        signalType: 'correlation',
        symbol: baseSymbol,
        value,
        ts: new Date().toISOString()
      }
    ]
  },
  shutdown: async () => Promise.resolve()
} as PluginRuntime

let ctx: PluginContext | null = null
