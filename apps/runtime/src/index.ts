import http from 'node:http'
import promClient from 'prom-client'
import { runtimeEnv as env } from './config'
import { createRuntime } from './orchestrator/state'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import { initializeTelemetry, stopTelemetry } from './telemetry'

const METRICS_PATH = '/metrics'

function startMetricsServer(port: number): void {
  const server = http.createServer(async (request, response) => {
    if (request.url === METRICS_PATH && request.method === 'GET') {
      response.setHeader('content-type', promClient.register.contentType)
      response.end(await promClient.register.metrics())
      return
    }

    if (request.url === '/healthz' && request.method === 'GET') {
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

const bus = env.REDIS_URL
  ? new RedisEventBus(env.REDIS_URL, env.REDIS_STREAM_PREFIX)
  : new InMemoryEventBus()

void createRuntime({ env, bus })
  .then(async (runtime) => {
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
