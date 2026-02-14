import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'

let sdk: NodeSDK | undefined

function getTraceEndpoint(): string {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!raw) {
    return ''
  }

  return raw.endsWith('/v1/traces') ? raw : `${raw.replace(/\/$/, '')}/v1/traces`
}

export async function initializeTelemetry(serviceName: string): Promise<void> {
  if (sdk) {
    return
  }

  const endpoint = getTraceEndpoint()
  if (!endpoint) {
    return
  }

  if (!process.env.OTEL_SERVICE_NAME) {
    process.env.OTEL_SERVICE_NAME = serviceName
  }

  const traceExporter = new OTLPTraceExporter({
    url: endpoint
  })

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0'
    }),
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()]
  })

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)

  try {
    await sdk.start()
  } catch (error) {
    sdk = undefined
    console.error('failed to initialize telemetry', error) // eslint-disable-line no-console
  }
}

export async function stopTelemetry(): Promise<void> {
  if (!sdk) {
    return
  }

  try {
    await sdk.shutdown()
  } catch (error) {
    console.warn('[runtime-telemetry] failed to shutdown telemetry', error) // eslint-disable-line no-console
    // keep shutdown idempotent
  }

  sdk = undefined
}
