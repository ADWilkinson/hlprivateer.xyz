import http from 'node:http'
import promClient from 'prom-client'
import { runtimeEnv as env } from './config'
import { createRuntime } from './orchestrator/state'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
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

void createRuntimeStore(env.DATABASE_URL)
  .then(async (store) => {
    const runtime = await createRuntime({ env, bus, store, hlClient })
    await initializeTelemetry('hlprivateer-runtime')
    console.log(`runtime started mode=READY`) // eslint-disable-line no-console
    startMetricsServer(env.RUNTIME_METRICS_PORT)

    process.on('SIGINT', async () => {
      await runtime.stop()
      await stopTelemetry()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await runtime.stop()
      await stopTelemetry()
      process.exit(0)
    })
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
