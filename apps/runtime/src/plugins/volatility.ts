import { PluginContext, PluginRuntime } from '@hl/privateer-plugin-sdk'
import { fetchCandleSnapshot, parseFiniteNumber, getPostInfo } from './hyperliquid'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(0, variance))
}

export default {
  manifest: {
    id: 'volatility',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.volatility'],
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

    const symbol = (ctx.getConfig('HLP_VOL_SYMBOL') ?? 'BTC').trim() || 'BTC'
    const windowMinRaw = ctx.getConfig('HLP_VOL_WINDOW_MIN')
    const windowMin = clamp(Number(windowMinRaw ?? 60), 10, 360)

    const endTime = Date.now()
    const startTime = endTime - windowMin * 60_000

    const candles = await fetchCandleSnapshot({
      coin: symbol,
      interval: '1m',
      startTime,
      endTime,
      postInfo: getPostInfo()
    })

    const closes = candles
      .map((candle) => parseFiniteNumber(candle.c))
      .filter((value): value is number => typeof value === 'number')

    const returns: number[] = []
    for (let i = 1; i < closes.length; i += 1) {
      const prev = closes[i - 1]
      const next = closes[i]
      if (!prev || !next) continue
      const r = Math.log(next / prev)
      if (Number.isFinite(r)) {
        returns.push(r)
      }
    }

    const sigma = stdev(returns)
    // Return a single, stable scalar. Interpreted as "approx 1h realized vol %".
    const vol1hPct = sigma * Math.sqrt(Math.max(1, returns.length)) * 100
    const value = Number.isFinite(vol1hPct) ? Number(vol1hPct.toFixed(4)) : 0

    return [
      {
        pluginId: 'volatility',
        signalType: 'volatility',
        symbol,
        value,
        ts: new Date().toISOString()
      }
    ]
  },
  shutdown: async () => Promise.resolve()
} as PluginRuntime

let ctx: PluginContext | null = null
