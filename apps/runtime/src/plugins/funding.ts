import { PluginRuntime } from '@hl/privateer-plugin-sdk'

export default {
  manifest: {
    id: 'funding',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.funding'],
    permissions: ['market.read'],
    cooldownMs: 10000
  },
  initialize: async () => Promise.resolve(),
  poll: async () => {
    return [
      {
        pluginId: 'funding',
        signalType: 'funding',
        symbol: 'HYPE',
        value: 0.01 * (Math.random() - 0.5),
        ts: new Date().toISOString()
      }
    ]
  },
  shutdown: async () => Promise.resolve()
} as PluginRuntime
