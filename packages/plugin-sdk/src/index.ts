import { z } from 'zod'
import type { EventEnvelope } from '@hl/privateer-contracts'

export const PluginManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    compatVersion: z.string().min(1),
    actorType: z.enum(['internal', 'external']),
    requiredTier: z.enum(['tier0', 'tier1', 'tier2', 'tier3']).default('tier0'),
    capabilities: z.array(z.string()),
    permissions: z.array(z.string()),
    cooldownMs: z.number().int().nonnegative().default(0)
  })
  .strict()

export type PluginManifest = z.infer<typeof PluginManifestSchema>

export interface PluginContext {
  pluginId: string
  eventBusPublish: <T>(stream: string, event: Omit<EventEnvelope<T>, 'id' | 'ts'>) => Promise<string>
  getConfig: (key: string) => string | undefined
  logger: (level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>) => void
}

export interface PluginSignal {
  pluginId: string
  signalType: 'funding' | 'correlation' | 'volatility' | 'custom'
  symbol: string
  value: number
  ts: string
}

export const PluginSignalSchema = z.object({
  pluginId: z.string().min(1),
  signalType: z.enum(['funding', 'correlation', 'volatility', 'custom']),
  symbol: z.string().min(1),
  value: z.number(),
  ts: z.string().datetime()
})

export interface PluginRuntime {
  manifest: PluginManifest
  initialize: (context: PluginContext) => Promise<void>
  poll: () => Promise<PluginSignal[]>
  shutdown: () => Promise<void>
}

export interface PluginLoader {
  loadPlugin: (path: string) => Promise<PluginRuntime>
  enablePlugin: (pluginId: string) => Promise<void>
  disablePlugin: (pluginId: string) => Promise<void>
  list: () => string[]
}

export function createSafePluginModule(plugin: PluginRuntime) {
  return {
    manifest: PluginManifestSchema.parse(plugin.manifest),
    initialize: plugin.initialize,
    poll: plugin.poll,
    shutdown: plugin.shutdown
  }
}

class LocalPluginManager {
  private plugins = new Map<string, PluginRuntime>()
  private tasks = new Map<string, ReturnType<typeof setInterval>>()

  constructor(private context: PluginContext, private pollMs: number = 5000) {}

  async loadPlugin(path: string): Promise<PluginRuntime> {
    const imported = await import(path)
    const candidate = imported.default ?? imported
    const resolved = createSafePluginModule(candidate as PluginRuntime)
    this.plugins.set(resolved.manifest.id, resolved)
    return resolved
  }

  list(): string[] {
    return Array.from(this.plugins.keys())
  }

  async enablePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id)
    if (!plugin) {
      throw new Error(`plugin ${id} not loaded`)
    }

    await plugin.initialize(this.context)
    const runner = setInterval(async () => {
      try {
        await plugin.poll()
      } catch (error) {
        this.context.logger('error', `plugin ${id} poll failed`, { error: String(error) })
      }
    }, this.pollMs)
    this.tasks.set(id, runner)
  }

  async disablePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id)
    const task = this.tasks.get(id)
    if (task) {
      clearInterval(task)
      this.tasks.delete(id)
    }

    if (plugin) {
      await plugin.shutdown()
    }
  }
}

export function createPluginManager(context: PluginContext): PluginLoader {
  return new LocalPluginManager(context)
}
