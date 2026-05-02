import { describe, expect, it } from 'vitest'
import { PluginSignalSchema, createSafePluginModule, PluginManifestSchema, type PluginRuntime } from './index'

describe('plugin sdk', () => {
  it('validates plugin runtime structures', async () => {
    const plugin: PluginRuntime = {
      manifest: PluginManifestSchema.parse({
        id: 'seed',
        version: '1.0.0',
        compatVersion: '1',
        actorType: 'internal',
        requiredTier: 'tier0',
        capabilities: ['signal.custom'],
        permissions: ['market.read'],
        cooldownMs: 0
      }),
      initialize: async () => undefined,
      poll: async () => [
        {
          pluginId: 'seed',
          signalType: 'custom',
          symbol: 'HYPE',
          value: 1,
          ts: new Date().toISOString()
        }
      ],
      shutdown: async () => undefined
    }

    const safe = createSafePluginModule(plugin)
    const signals = await safe.poll()

    expect(safe.manifest.id).toBe('seed')
    expect(signals).toHaveLength(1)
    expect(() => PluginSignalSchema.parse(signals[0])).not.toThrow()
  })
})
