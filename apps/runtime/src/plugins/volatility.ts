import { PluginRuntime } from '@hl/privateer-plugin-sdk'

export default {
  manifest: {
    id: 'volatility',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.volatility'],
    permissions: ['market.read'],
    cooldownMs: 30000
  },
  initialize: async () => Promise.resolve(),
  poll: async () => [
    {
      pluginId: 'volatility',
      signalType: 'volatility',
      symbol: 'HYPE',
      value: Math.random() * 10,
      ts: new Date().toISOString()
    }
  ],
  shutdown: async () => Promise.resolve()
} as PluginRuntime
