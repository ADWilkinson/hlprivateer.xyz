import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type RouteConfig
} from '@x402/core/server'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { registerExactEvmScheme } from '@x402/evm/exact/server'
import { createFacilitatorConfig } from '@coinbase/x402'

export type X402VerifiedContext = {
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
  declaredExtensions?: Record<string, unknown>
}

export async function createX402FacilitatorGate(params: {
  apiBaseUrl: string
  facilitatorUrl: string
  cdpApiKeyId?: string
  cdpApiKeySecret?: string
  routes: Record<string, RouteConfig>
  onSettled?: (route: string, paidAmountUsd: number) => void
}): Promise<{
  preHandler: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  preSerialization: (request: FastifyRequest, reply: FastifyReply, payload: unknown) => Promise<unknown>
}> {
  const facilitatorConfig = params.cdpApiKeyId && params.cdpApiKeySecret
    ? createFacilitatorConfig(params.cdpApiKeyId, params.cdpApiKeySecret)
    : { url: params.facilitatorUrl }
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig)
  const resourceServer = new x402ResourceServer(facilitatorClient)
  registerExactEvmScheme(resourceServer)

  const httpServer = new x402HTTPResourceServer(resourceServer, params.routes)
  await httpServer.initialize()

  const preHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(request.raw.url ?? request.url, params.apiBaseUrl)
    const adapter = fastifyAdapter(request, url)
    const ctx: HTTPRequestContext = {
      adapter,
      path: url.pathname,
      method: request.method,
      paymentHeader: adapter.getHeader('PAYMENT-SIGNATURE') ?? adapter.getHeader('X-PAYMENT')
    }

    const result = await httpServer.processHTTPRequest(ctx)
    if (result.type === 'no-payment-required') {
      ;(request as any).x402GateHandled = true
      return reply.code(500).send({ error: 'X402_MISCONFIGURED', message: 'paid route missing x402 configuration' })
    }
    if (result.type === 'payment-error') {
      ;(request as any).x402GateHandled = true
      reply.code(result.response.status)
      for (const [name, value] of Object.entries(result.response.headers ?? {})) {
        reply.header(name, value)
      }

      return reply.send(result.response.body ?? {})
    }

    if (result.type === 'payment-verified') {
      ;(request as any).x402Verified = {
        paymentPayload: result.paymentPayload,
        paymentRequirements: result.paymentRequirements,
        declaredExtensions: result.declaredExtensions
      } satisfies X402VerifiedContext
    }
  }

  const preSerialization = async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const verified = (request as any).x402Verified as X402VerifiedContext | undefined
    if (!verified) {
      return payload
    }

    if (reply.statusCode < 200 || reply.statusCode >= 300) {
      return payload
    }

    const settled = await httpServer.processSettlement(
      verified.paymentPayload,
      verified.paymentRequirements,
      verified.declaredExtensions
    )
    if (!settled.success) {
      reply.code(502)
      reply.header('content-type', 'application/json; charset=utf-8')
      return {
        error: 'X402_SETTLEMENT_FAILED',
        reason: settled.errorReason,
        message: settled.errorMessage
      }
    }

    for (const [name, value] of Object.entries(settled.headers ?? {})) {
      reply.header(name, value)
    }

    if (params.onSettled) {
      const url = new URL(request.raw.url ?? request.url, params.apiBaseUrl)
      const routeConfig = params.routes[`${request.method} ${url.pathname}`]
      const price = routeConfig?.accepts && typeof routeConfig.accepts === 'object' && 'price' in routeConfig.accepts
        ? Number(String(routeConfig.accepts.price).replace(/^\$/, ''))
        : 0.01
      params.onSettled(url.pathname, Number.isFinite(price) ? price : 0.01)
    }

    return payload
  }

  return { preHandler, preSerialization }
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0]
  }
  return undefined
}

function fastifyAdapter(request: FastifyRequest, url: URL): HTTPAdapter {
  return {
    getHeader(name: string) {
      return headerValue((request.headers as any)[name.toLowerCase()]) ?? headerValue((request.headers as any)[name])
    },
    getMethod() {
      return request.method
    },
    getPath() {
      return url.pathname
    },
    getUrl() {
      return url.toString()
    },
    getAcceptHeader() {
      return headerValue((request.headers as any).accept) ?? '*/*'
    },
    getUserAgent() {
      return headerValue((request.headers as any)['user-agent']) ?? 'unknown'
    }
  }
}
