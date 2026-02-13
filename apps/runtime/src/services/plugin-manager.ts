import { PluginManifestSchema, PluginRuntime, PluginSignal, PluginSignalSchema, PluginContext } from '@hl/privateer-plugin-sdk'
import { EventBus } from '@hl/privateer-event-bus'
import { StreamName, StreamNameSchema } from '@hl/privateer-contracts'
import funding from '../plugins/funding'
import correlation from '../plugins/correlation'
import volatility from '../plugins/volatility'

const PLUGIN_STREAM: StreamName = 'hlp.plugin.signals'
const MAX_SIGNAL_HISTORY = 256
const POLL_INTERVAL_MS = 10_000

const PLUGINS: PluginRuntime[] = [funding, correlation, volatility]

export interface RuntimePluginManager {
  start(): Promise<void>
  stop(): Promise<void>
  getSignals(): PluginSignal[]
}

export async function createRuntimePluginManager(eventBus: EventBus): Promise<RuntimePluginManager> {
  const signals: PluginSignal[] = []
  const timers = new Set<ReturnType<typeof setInterval>>()
  const started = new Set<string>()

  const publishSignal = async (signal: PluginSignal) => {
    PluginSignalSchema.parse(signal)
    await eventBus.publish(PLUGIN_STREAM, {
      type: 'plugin.signal',
      stream: PLUGIN_STREAM,
      source: 'runtime.plugin',
      correlationId: `plugin-${signal.pluginId}-${signal.ts}`,
      actorType: 'system',
      actorId: 'runtime.plugin-manager',
      payload: {
        ...signal
      }
    })

    signals.push(signal)
    if (signals.length > MAX_SIGNAL_HISTORY) {
      signals.splice(0, signals.length - MAX_SIGNAL_HISTORY)
    }
  }

  const initializePlugin = async (plugin: PluginRuntime) => {
    const manifest = PluginManifestSchema.parse(plugin.manifest)
    if (started.has(manifest.id)) {
      return
    }

    started.add(manifest.id)

    const poll = async () => {
      try {
        const updates = await plugin.poll()
        for (const update of updates) {
          await publishSignal(update)
        }
      } catch (error) {
        // plugin failure must not fail runtime
        void console.error(`plugin ${manifest.id} poll failure`, error)
      }
    }

    const context: PluginContext = {
      pluginId: manifest.id,
      eventBusPublish: async <T>(stream: string, event: Omit<Parameters<PluginContext['eventBusPublish']>[1], 'stream'>) => {
        const parsed = StreamNameSchema.safeParse(stream)
        if (!parsed.success) {
          throw new Error(`plugin ${manifest.id} attempted to publish to invalid stream ${stream}`)
        }

        return eventBus.publish(parsed.data, {
          ...event,
          stream: parsed.data,
          type: 'plugin.event',
          source: 'runtime.plugin-manager'
        })
      },
      getConfig: (key: string) => {
        const value = process.env[key]
        return value
      },
      logger: (level, message, details) => {
        const line = details ? `${message} ${JSON.stringify(details)}` : message
        if (level === 'error') {
          console.error(`[plugin:${manifest.id}] ${line}`)
        } else if (level === 'warn') {
          console.warn(`[plugin:${manifest.id}] ${line}`)
        } else {
          console.log(`[plugin:${manifest.id}] ${line}`)
        }
      }
    }

    await plugin.initialize(context)

    await poll()
    await publishSignal({
      pluginId: manifest.id,
      signalType: 'custom',
      symbol: 'HYPE',
      value: 0,
      ts: new Date().toISOString()
    })

    const timer = setInterval(() => {
      void poll()
    }, manifest.cooldownMs > 0 ? manifest.cooldownMs : POLL_INTERVAL_MS)

    timers.add(timer)
  }

  return {
    start: async () => {
      for (const candidate of PLUGINS) {
        await initializePlugin(candidate)
      }
    },
    stop: async () => {
      for (const id of [...started]) {
        const candidate = PLUGINS.find((candidatePlugin) => candidatePlugin.manifest.id === id)
        if (candidate) {
          await candidate.shutdown()
        }
      }

      for (const timer of timers) {
        clearInterval(timer)
      }
    },
    getSignals: () => [...signals]
  }
}
