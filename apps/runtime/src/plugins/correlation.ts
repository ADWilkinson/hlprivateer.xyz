import { PluginRuntime } from '@hl/privateer-plugin-sdk'

export default {
  manifest: {
    id: 'correlation',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.correlation'],
    permissions: ['market.read'],
    cooldownMs: 20000
  },
  initialize: async () => Promise.resolve(),
  poll: async () => [
    {
      pluginId: 'correlation',
      signalType: 'correlation',
      symbol: 'BTC',
      value: Math.random(),
      ts: new Date().toISOString()
    }
  ],
  shutdown: async () => Promise.resolve()
} as PluginRuntime
