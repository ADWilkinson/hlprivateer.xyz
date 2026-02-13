import { PluginContext, PluginRuntime } from '@hl/privateer-plugin-sdk'
import { fetchFundingHistory, parseFiniteNumber } from './hyperliquid'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default {
  manifest: {
    id: 'funding',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.funding'],
    permissions: ['market.read'],
    cooldownMs: 60000
  },
  initialize: async (context: PluginContext) => {
    ctx = context
  },
  poll: async () => {
    if (!ctx) {
      return []
    }

    const infoUrl = ctx.getConfig('HL_INFO_URL')
    const symbol = (ctx.getConfig('HLP_FUNDING_SYMBOL') ?? 'HYPE').trim() || 'HYPE'
    const windowDaysRaw = ctx.getConfig('HLP_FUNDING_WINDOW_DAYS')
    const windowDays = clamp(Number(windowDaysRaw ?? 7), 1, 30)

    const startTime = Date.now() - windowDays * 24 * 60 * 60 * 1000
    const history = await fetchFundingHistory({
      coin: symbol,
      startTime,
      infoUrl: infoUrl || undefined
    })

    const latest = history.length > 0 ? history[history.length - 1] : undefined
    const rate = latest ? parseFiniteNumber(latest.fundingRate) : null
    const value = typeof rate === 'number' ? Number(rate.toFixed(8)) : 0

    return [
      {
        pluginId: 'funding',
        signalType: 'funding',
        symbol,
        value,
        ts: new Date().toISOString()
      }
    ]
  },
  shutdown: async () => Promise.resolve()
} as PluginRuntime

let ctx: PluginContext | null = null
