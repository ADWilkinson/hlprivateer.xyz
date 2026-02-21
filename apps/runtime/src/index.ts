import http from 'node:http'
import promClient from 'prom-client'
import { runtimeEnv as env } from './config'
import { createRuntime } from './orchestrator/state'
import { RedisEventBus, InMemoryEventBus, type AuditArchiver } from '@hl/privateer-event-bus'
import { createRuntimeStore } from './db/persistence'
import { initializeTelemetry, stopTelemetry } from './telemetry'
import { createHlClient } from '@hl/privateer-hl-client'
import { setPostInfo } from './plugins/hyperliquid'

const METRICS_PATH = '/metrics'
const HEALTH_PATH = '/health'

function startMetricsServer(port: number): void {
  const server = http.createServer(async (request, response) => {
    if (request.url === METRICS_PATH && request.method === 'GET') {
      response.setHeader('content-type', promClient.register.contentType)
      response.end(await promClient.register.metrics())
      return
    }

    if ((request.url === '/healthz' || request.url === HEALTH_PATH) && request.method === 'GET') {
      response.statusCode = 200
      response.end('ok')
      return
    }

    response.statusCode = 404
    response.end('not found')
  })

  server.listen(port, () => {
    console.log(`runtime metrics server listening on :${port}`) // eslint-disable-line no-console
  })
}

const hlClient = createHlClient({
  isTestnet: env.HL_IS_TESTNET,
  apiUrl: env.HL_API_URL,
  timeout: env.HL_REQUEST_TIMEOUT_MS,
  infoUrl: env.HL_INFO_URL,
  tokensPerMinute: 600,
})
setPostInfo(hlClient.postInfo)

const bus = env.REDIS_URL
  ? new RedisEventBus(env.REDIS_URL, env.REDIS_STREAM_PREFIX)
  : new InMemoryEventBus()

const AUDIT_ARCHIVE_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const AUDIT_RETAIN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in Redis

void createRuntimeStore(env.DATABASE_URL)
  .then(async (store) => {
    const runtime = await createRuntime({ env, bus, store, hlClient })
    await initializeTelemetry('hlprivateer-runtime')
    console.log(`runtime started mode=READY`) // eslint-disable-line no-console
    startMetricsServer(env.RUNTIME_METRICS_PORT)

    // Periodic audit archival: Redis → Postgres, then trim old entries
    let archiveTimer: ReturnType<typeof setInterval> | undefined
    if (bus instanceof RedisEventBus && store.enabled) {
      const archiver: AuditArchiver = async (envelope) => {
        await store.saveAudit({
          id: envelope.id,
          ts: envelope.ts,
          actorType: envelope.actorType as 'human' | 'internal_agent' | 'external_agent' | 'system',
          actorId: envelope.actorId,
          action: envelope.type,
          resource: envelope.stream,
          correlationId: envelope.correlationId,
          details: (envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {}) as Record<string, unknown>,
        })
      }

      const runArchive = async () => {
        try {
          const result = await bus.archiveAuditStream(archiver, AUDIT_RETAIN_MS)
          if (result.archived > 0) {
            console.log(`audit-archive: archived ${result.archived} events to postgres, trimmed up to ${result.trimmedUpTo}`) // eslint-disable-line no-console
          }
        } catch (error) {
          console.warn('audit-archive: failed', error instanceof Error ? error.message : String(error)) // eslint-disable-line no-console
        }
      }

      // Run once at startup, then every 6 hours
      void runArchive()
      archiveTimer = setInterval(() => void runArchive(), AUDIT_ARCHIVE_INTERVAL_MS)
    }

    process.on('SIGINT', async () => {
      if (archiveTimer) clearInterval(archiveTimer)
      await runtime.stop()
      await stopTelemetry()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      if (archiveTimer) clearInterval(archiveTimer)
      await runtime.stop()
      await stopTelemetry()
      process.exit(0)
    })
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
