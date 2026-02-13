import { PluginContext, PluginRuntime, PluginSignal } from './index'

const plugin: PluginRuntime = {
  manifest: {
    id: 'feed-funding',
    version: '1.0.0',
    compatVersion: '1',
    actorType: 'internal',
    requiredTier: 'tier0',
    capabilities: ['signal.funding'],
    permissions: ['market.read'],
    cooldownMs: 10000
  },
  initialize: async (_context: PluginContext) => {
    return Promise.resolve()
  },
  poll: async (): Promise<PluginSignal[]> => {
    return [
      {
        pluginId: 'feed-funding',
        signalType: 'funding',
        symbol: 'HYPE',
        value: 0,
        ts: new Date().toISOString()
      }
    ]
  },
  shutdown: async () => Promise.resolve()
}

export default plugin
