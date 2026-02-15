import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { timingSafeEqual } from 'node:crypto'
import {
  AuditEvent,
  CommandResultSchema,
  FloorTapeLineSchema,
  Entitlement,
  parseCommand,
  commandPolicy,
  PublicPnlResponseSchema,
  PublicSnapshotSchema,
  PaymentProofSchema,
  EntitlementSchema,
  EntitlementTierSchema,
  HttpReplayQuerySchema,
  ReplayRangeSchema
} from '@hl/privateer-contracts'
import { ulid } from 'ulid'
import promClient from 'prom-client'
import { env } from './config'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import { createChallenge, verifyChallenge } from './x402'
import type { RouteConfig } from '@x402/core/server'
import type { Network } from '@x402/core/types'
import { createX402FacilitatorGate } from './x402-facilitator'
import { registerAuth, OPERATOR_ADMIN_ROLE, OPERATOR_VIEW_ROLE } from './middleware'
import { ApiStore } from './store'
import { initializeTelemetry, stopTelemetry } from './telemetry'
import {
  ABUSE_BAN_THRESHOLD,
  ABUSE_BAN_WINDOW_MS,
  AbuseState,
  identifyClientActor,
  isLargePayload,
  isPromptInjection,
  isSuspiciousPath,
  recordFailure,
  sanitizeText
} from './security'

const app = Fastify({ logger: { level: env.LOG_LEVEL } }) as unknown as FastifyInstance & {
  authenticate: (request: FastifyRequest, reply: any) => Promise<void> | void
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  try {
    return JSON.stringify(error)
  } catch (stringifyError) {
    app.log.warn({ originalError: describeError(error), stringifyError }, 'failed to stringify error for logging')
    return String(error)
  }
}

interface EntitlementRequest extends FastifyRequest {
  entitlement?: Entitlement
}

function routeRateLimit(max: number, timeWindowMs: number) {
  return {
    config: {
      rateLimit: {
        max,
        timeWindow: timeWindowMs
      }
    }
  }
}

function recordPromptInjection(route: string, actor: string): void {
  securityEventCounter.inc({ type: `prompt_injection:${route}` })
  app.log.warn(`prompt injection blocked on ${route} by ${actor}`)
}

app.register(cors, {
  origin: (origin, callback) => {
    // Allow non-browser clients (curl, server-to-server) that do not send an Origin header.
    if (!origin) {
      callback(null, true)
      return
    }

    const explicitAllowed = new Set([
      env.PUBLIC_BASE_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://hlprivateer.xyz',
      'https://www.hlprivateer.xyz',
      'https://hlprivateer-xyz.pages.dev'
    ])
    if (explicitAllowed.has(origin)) {
      callback(null, true)
      return
    }

    try {
      const url = new URL(origin)

      if (url.protocol === 'https:' && (url.hostname === 'hlprivateer.xyz' || url.hostname.endsWith('.hlprivateer.xyz'))) {
        callback(null, true)
        return
      }

      // Allow Cloudflare Pages deployments for this project (preview + production).
      if (url.protocol === 'https:' && (url.hostname === 'hlprivateer-xyz.pages.dev' || url.hostname.endsWith('.hlprivateer-xyz.pages.dev'))) {
        callback(null, true)
        return
      }
    } catch (error) {
      app.log.warn({ origin, err: describeError(error) }, 'CORS origin parse failed')
    }

    callback(null, false)
  },
  credentials: true
})

app.register(rateLimit, {
  max: env.API_RATE_LIMIT_MAX,
  timeWindow: env.API_RATE_LIMIT_WINDOW_MS
})

void initializeTelemetry('hlprivateer-api')

const store = new ApiStore()
const bus = env.REDIS_URL
  ? new RedisEventBus(env.REDIS_URL, env.REDIS_STREAM_PREFIX)
  : new InMemoryEventBus()

await registerAuth(app)

void promClient.collectDefaultMetrics()

const requestCounter = new promClient.Counter({
  name: 'hlp_api_requests_total',
  help: 'Total API requests',
  labelNames: ['method', 'route', 'status', 'actor']
})

const requestDuration = new promClient.Histogram({
  name: 'hlp_api_request_duration_seconds',
  help: 'Request duration in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
})

const securityEventCounter = new promClient.Counter({
  name: 'hlp_api_security_events_total',
  help: 'Security enforcement events',
  labelNames: ['type']
})

app.setErrorHandler(async (error, request, reply) => {
  request.log.error(error)
  if (reply.sent || reply.raw?.headersSent) {
    return
  }

  const rawStatusCode = (error as { statusCode?: unknown }).statusCode
  const statusCode = typeof rawStatusCode === 'number' && Number.isInteger(rawStatusCode)
    ? rawStatusCode
    : 500
  const message = error instanceof Error ? error.message : String(error)
  const errorName = statusCode >= 500 ? 'INTERNAL' : 'BAD_REQUEST'

  reply.code(statusCode).send({ error: errorName, message })
})

let x402Facilitator: Awaited<ReturnType<typeof createX402FacilitatorGate>> | null = null
if (env.X402_ENABLED && env.X402_PROVIDER === 'facilitator') {
  const payTo = String(env.X402_PAYTO ?? '').trim()
  if (!payTo) {
    throw new Error('X402_PROVIDER=facilitator requires X402_PAYTO')
  }

  const network = env.X402_NETWORK as Network
  const acceptExact = (price: string) => ({
    scheme: 'exact',
    price,
    network,
    payTo,
    maxTimeoutSeconds: 120
  })

  const routes: Record<string, RouteConfig> = {
    'GET /v1/agent/stream/snapshot': {
      accepts: acceptExact(env.X402_PRICE_STREAM_SNAPSHOT),
      description: 'HL Privateer public floor snapshot (agent access)',
      mimeType: 'application/json'
    },
    'GET /v1/agent/analysis/latest': {
      accepts: acceptExact(env.X402_PRICE_ANALYSIS_LATEST),
      description: 'Latest HL Privateer agent analysis',
      mimeType: 'application/json'
    },
    'GET /v1/agent/analysis': {
      accepts: acceptExact(env.X402_PRICE_ANALYSIS_HISTORY),
      description: 'HL Privateer agent analysis history',
      mimeType: 'application/json'
    },
    'GET /v1/agent/positions': {
      accepts: acceptExact(env.X402_PRICE_POSITIONS),
      description: 'Current HL Privateer positions',
      mimeType: 'application/json'
    },
    'GET /v1/agent/orders': {
      accepts: acceptExact(env.X402_PRICE_ORDERS),
      description: 'Current HL Privateer orders',
      mimeType: 'application/json'
    },
    'GET /v1/agent/data/overview': {
      accepts: acceptExact(env.X402_PRICE_MARKET_DATA),
      description: 'HL Privateer market + execution overview for machine agents',
      mimeType: 'application/json'
    },
    'GET /v1/agent/insights': {
      accepts: acceptExact(env.X402_PRICE_AGENT_INSIGHTS),
      description: 'HL Privateer floor insights bundle (health, mode, policy, risk, tape)',
      mimeType: 'application/json'
    },
    'GET /v1/agent/copy-trade/signals': {
      accepts: acceptExact(env.X402_PRICE_COPY_TRADE_SIGNALS),
      description: 'HL Privateer copy-trade signals and analyst events',
      mimeType: 'application/json'
    },
    'GET /v1/agent/copy-trade/positions': {
      accepts: acceptExact(env.X402_PRICE_COPY_TRADE_POSITIONS),
      description: 'HL Privateer positions formatted for copy-trading consumers',
      mimeType: 'application/json'
    }
  }

  x402Facilitator = await createX402FacilitatorGate({
    apiBaseUrl: env.API_BASE_URL,
    facilitatorUrl: env.X402_FACILITATOR_URL,
    routes
  })

  app.addHook('preSerialization', x402Facilitator.preSerialization)
  app.log.info(`x402 facilitator gate enabled network=${network} payTo=${payTo.slice(0, 10)}...`)
}

const adminUsers = new Set(
  env.OPERATOR_ADMIN_USERS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
)

function normalizeLimit(value: unknown, fallback: number, max = 200): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  const safe = Math.floor(parsed)
  if (!Number.isFinite(safe)) {
    return fallback
  }

  if (safe > max) {
    return max
  }

  return safe
}

function getEffectiveRiskConfig() {
  const runtimePolicy = store.snapshot.riskPolicy
  const riskPolicy =
    typeof runtimePolicy === 'object' && runtimePolicy !== null
      ? (runtimePolicy as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  const num = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    return fallback
  }

  return {
    maxLeverage: Number.isFinite(riskPolicy.maxLeverage) ? Number(riskPolicy.maxLeverage) : env.RISK_MAX_LEVERAGE,
    targetLeverage: num(riskPolicy.targetLeverage, Number.isFinite(riskPolicy.maxLeverage) ? Number(riskPolicy.maxLeverage) : env.RISK_MAX_LEVERAGE),
    maxDrawdownPct: Number.isFinite(riskPolicy.maxDrawdownPct)
      ? Number(riskPolicy.maxDrawdownPct)
      : env.RISK_MAX_DRAWDOWN_PCT,
    maxNotionalUsd: Number.isFinite(riskPolicy.maxExposureUsd)
      ? Number(riskPolicy.maxExposureUsd)
      : env.RISK_MAX_NOTIONAL_USD,
    maxSlippageBps: num(riskPolicy.maxSlippageBps, env.RISK_MAX_SLIPPAGE_BPS),
    staleDataMs: num(riskPolicy.staleDataMs, env.RISK_STALE_DATA_MS),
    liquidityBufferPct: num(riskPolicy.liquidityBufferPct, env.RISK_LIQUIDITY_BUFFER_PCT),
    notionalParityTolerance: num(riskPolicy.notionalParityTolerance, env.RISK_NOTIONAL_PARITY_TOLERANCE)
  }
}

function buildCopyTradePositionSummary(positions: typeof store.positions) {
  const bySide = positions.reduce<Record<string, { count: number; notionalUsd: number }>>((acc, position) => {
    const side = position.side
    if (!acc[side]) {
      acc[side] = { count: 0, notionalUsd: 0 }
    }

    acc[side].count += 1
    acc[side].notionalUsd += Number.isFinite(position.notionalUsd) ? position.notionalUsd : 0
    return acc
  }, {})

  const totalNotionalUsd = positions.reduce(
    (sum, position) => sum + (Number.isFinite(position.notionalUsd) ? position.notionalUsd : 0),
    0
  )
  const basketSymbols = [...new Set(positions.map((position) => position.symbol))].filter(Boolean)
  const longShortBalance = {
    long: bySide.LONG ? Number(bySide.LONG.notionalUsd.toFixed(4)) : 0,
    short: bySide.SHORT ? Number(bySide.SHORT.notionalUsd.toFixed(4)) : 0
  }

  const netExposureUsd = longShortBalance.long + longShortBalance.short
  return {
    sideSummary: bySide,
    basketSymbols,
    totalNotionalUsd,
    netExposureUsd,
    longShortBalance
  }
}

function sanitizeCopySignalLimit(value: unknown): number {
  return normalizeLimit(value, 50, 500)
}

const bannedActors = new Map<string, number>()
const agentAbuse = new Map<string, AbuseState>()

interface EntitlementUsage {
  windowStart: number
  requestCount: number
  abuseCount: number
}

const agentUsage = new Map<string, EntitlementUsage>()

const usageWindowMs = 60_000

function isEntitlementBanned(entitlementId: string): boolean {
  const expiresAt = bannedActors.get(entitlementId)
  if (!expiresAt) {
    return false
  }

  if (Date.now() > expiresAt) {
    bannedActors.delete(entitlementId)
    return false
  }

  return true
}

function applyBan(entitlementId: string): void {
  bannedActors.set(entitlementId, Date.now() + ABUSE_BAN_WINDOW_MS)
}

function consumeQuota(entitlement: Entitlement): { quotaRemaining: number; overLimit: boolean } {
  if (entitlement.quotaRemaining <= 0) {
    return { quotaRemaining: 0, overLimit: true }
  }

  entitlement.quotaRemaining -= 1
  return { quotaRemaining: entitlement.quotaRemaining, overLimit: false }
}

function ensureUsageRecord(entitlementId: string): EntitlementUsage {
  const existing = agentUsage.get(entitlementId)
  const now = Date.now()
  if (!existing || now - existing.windowStart >= usageWindowMs) {
    const next: EntitlementUsage = { windowStart: now, requestCount: 0, abuseCount: existing?.abuseCount ?? 0 }
    agentUsage.set(entitlementId, next)
    return next
  }

  return existing
}

function recordAbuse(entitlementId: string): number {
  const record = ensureUsageRecord(entitlementId)
  record.abuseCount += 1

  if (record.abuseCount >= ABUSE_BAN_THRESHOLD) {
    applyBan(entitlementId)
  }

  return record.abuseCount
}

function getProofFromRequest(request: any): unknown {
  const header = request.headers['x402-payment'] ?? request.headers['x-agent-proof'] ?? request.headers['x-payment'] ?? request.headers['payment-signature']
  if (!header) {
    return undefined
  }

  const raw = Array.isArray(header) ? header[0] : header
  if (typeof raw !== 'string') {
    return undefined
  }

  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed)
      } catch (error) {
        app.log.warn(
          { operation: 'x402-proof-json', rawPrefix: trimmed.slice(0, 80), err: describeError(error) },
          'failed to parse x402 proof header as JSON'
        )
        return undefined
      }
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64url').toString('utf8')
    if (decoded.startsWith('{')) {
      return JSON.parse(decoded)
    }
      } catch (error) {
        app.log.warn({ operation: 'x402-proof-base64url', rawPrefix: trimmed.slice(0, 80), err: describeError(error) }, 'failed to parse x402 proof base64url payload')
        // Fall through and try standard base64.
      }

  // x402 v2 docs refer to Base64-encoded JSON header values; accept both base64url and base64.
      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
        if (decoded.startsWith('{')) {
          return JSON.parse(decoded)
        }
      } catch (error) {
        app.log.warn(
          { operation: 'x402-proof-base64', rawPrefix: trimmed.slice(0, 80), err: describeError(error) },
          'failed to parse x402 proof base64 payload'
        )
        // Ignore and fall through.
      }

  return undefined
}

function normalizeAmountUsd(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.max(0, Math.round(parsed))
}

function issuePaymentRecord(
  params: {
    agentId: string
    entitlementId: string
    challengeId: string
    status: string
    provider?: string
    amountUsd: number
    proof?: unknown
    verifiedAt?: string
    metadata?: Record<string, unknown>
    txRef?: string
  }
): void {
  void store.recordPaymentAttempt({
    agentId: params.agentId,
    entitlementId: params.entitlementId,
    challengeId: params.challengeId,
    status: params.status,
    provider: params.provider ?? 'x402-mock',
    amountUsd: params.amountUsd,
    txRef: params.txRef,
    verificationPayload: params.proof as Record<string, unknown> | undefined,
    verifiedAt: params.verifiedAt,
    metadata: params.metadata
  })
}

function requestActor(request: FastifyRequest, entitlementId?: string): string {
  return identifyClientActor({
    ip: request.ip ?? 'anonymous',
    entitlementId,
    userId: (request.user as { sub?: string } | undefined)?.sub
  })
}

function encodePaymentHeader(payload: unknown): string {
  try {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    } catch (error) {
      app.log.warn(
        { operation: 'x402-proof-encode', payloadType: typeof payload, err: describeError(error) },
        'failed to encode payment header; returning empty payload'
      )
      return Buffer.from('{}', 'utf8').toString('base64')
    }
}

function parseRouteLabel(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url ?? 'unknown'
}

app.addHook('onResponse', (request, reply, done) => {
  const startedAt = (request as unknown as { startTime: number }).startTime
  const route = parseRouteLabel(request)
  const entitlementId = request.headers['x-agent-entitlement']
  const actor = entitlementId
    ? `entitlement:${String(entitlementId)}`
    : request.headers.authorization
      ? 'operator'
      : 'public'

  requestCounter.inc({
    method: request.method,
    route,
    status: String(reply.statusCode),
    actor
  })
  const duration = startedAt ? (Date.now() - startedAt) / 1000 : 0
  requestDuration.observe(duration)
  done()
})

app.addHook('onRequest', async (request) => {
  ;(request as unknown as { startTime: number }).startTime = Date.now()
})

app.addHook('onRequest', async (request, reply) => {
  if (isLargePayload(request.headers['content-length'])) {
    securityEventCounter.inc({ type: 'payload_too_large' })
    reply.code(413).send({ error: 'PAYLOAD_TOO_LARGE', message: 'payload exceeds limit' })
    return
  }

  if (isSuspiciousPath(request.url || '')) {
    const actor = requestActor(request)
    const result = recordFailure(actor, agentAbuse)
    securityEventCounter.inc({ type: 'waf_path_reject' })
    if (result.banned) {
      reply.code(429).send({ error: 'TEMPORARY_BAN', message: 'request pattern abuse detected' })
      return
    }

    reply.code(400).send({ error: 'BAD_REQUEST', message: 'invalid request path' })
    return
  }
})

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff')
  reply.header('x-frame-options', 'DENY')
  reply.header('referrer-policy', 'no-referrer')
  reply.header('x-xss-protection', '0')
  reply.header('permissions-policy', 'geolocation=(), microphone=(), camera=()')
  return payload
})

app.get('/healthz', routeRateLimit(60, 60_000), async () => ({ status: 'ok' }))

function getCapabilitiesForTier(tier: string | undefined): string[] {
  const normalizedTier = tier === 'tier0' || tier === 'tier1' || tier === 'tier2' || tier === 'tier3' ? tier : 'tier0'
  return store.getCapabilitiesForTier(normalizedTier)
}

function errorMessages(errors: Array<{ message: string }>): string {
  return errors.map((error) => error.message).join('; ')
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  if (providedBuf.length !== expectedBuf.length) {
    return false
  }
  return timingSafeEqual(providedBuf, expectedBuf)
}

const commandCounter = new promClient.Counter({
  name: 'hlp_command_total',
  help: 'Total submitted operator/agent commands',
  labelNames: ['actor']
})

const auditCounter = new promClient.Counter({
  name: 'hlp_audit_records_total',
  help: 'Total audit records emitted'
})

interface OperatorClaims {
  sub: string
  roles: string[]
  mfa?: boolean
}

function operatorClaimsFromRequest(request: FastifyRequest): OperatorClaims {
  const user = request as { user?: OperatorClaims }
  return {
    sub: String(user.user?.sub ?? ''),
    roles: Array.isArray(user.user?.roles) ? user.user.roles : [],
    mfa: user.user?.mfa
  }
}

const resolveOperatorClaims = (request: FastifyRequest): OperatorClaims => {
  const user = operatorClaimsFromRequest(request)
  return {
    sub: user.sub,
    roles: user.roles,
    mfa: user.mfa
  }
}

const hasRole = (request: FastifyRequest, role: string): boolean => {
  const { roles } = resolveOperatorClaims(request)
  return roles.includes(role)
}

const hasAnyRole = (request: FastifyRequest, roles: string[]): boolean => {
  return roles.some((role) => hasRole(request, role))
}

app.addHook('onRequest', async (request, _reply) => {
  if (request.headers['x-forwarded-proto'] === 'http') {
    if (env.NODE_ENV === 'production') {
      void request.log.warn('non-https request observed in production')
    }
  }
})

app.get('/health', routeRateLimit(180, 60_000), async () => ({ status: 'ok', service: 'api' }))

app.get('/v1/public/pnl', routeRateLimit(180, 60_000), async () => {
  return PublicPnlResponseSchema.parse(store.getPublicPnl())
})

app.get('/v1/public/floor-snapshot', routeRateLimit(180, 60_000), async () => {
  return PublicSnapshotSchema.parse(store.getPublicSnapshot())
})

app.get('/v1/public/floor-tape', routeRateLimit(180, 60_000), async () => {
  return FloorTapeLineSchema.array().parse(store.getPublicSnapshot().recentTape)
})

app.post('/v1/operator/login', routeRateLimit(20, 60_000), async (request, reply) => {
  const operatorLoginSecret = env.OPERATOR_LOGIN_SECRET?.trim()
  if (!operatorLoginSecret && env.NODE_ENV === 'production') {
    return reply.code(404).send({ error: 'DISABLED', message: 'operator login disabled in production' })
  }

  if (operatorLoginSecret) {
    const providedSecret = String(request.headers['x-operator-login-secret'] ?? '')
    if (!providedSecret || !secretsEqual(providedSecret, operatorLoginSecret)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'missing or invalid operator login secret' })
    }
  }

  const body = (request.body as { user?: string; mfa?: boolean } | undefined) ?? {}
  const user = String(body.user ?? 'operator')
  // MFA is currently a boolean claim gate. In production, enforce `mfa=true` on issued tokens.
  const mfa = env.NODE_ENV === 'production' ? true : Boolean(body.mfa ?? true)
  const roles = [OPERATOR_VIEW_ROLE, ...(adminUsers.has(user) ? [OPERATOR_ADMIN_ROLE] : [])]
  const token = await app.jwt.sign({ sub: user, roles, mfa })
  return reply.send({ token })
})

app.post('/v1/operator/refresh', { ...routeRateLimit(30, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  const claims = resolveOperatorClaims(request)
  if (!claims.sub) {
    return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'missing subject claim' })
  }

  const refreshedToken = await app.jwt.sign({
    sub: claims.sub,
    roles: claims.roles,
    mfa: claims.mfa ?? false
  })
  addAudit(store, claims.sub, 'operator.session.refresh', {
    roles: claims.roles,
    mfa: claims.mfa ?? false
  })
  return {
    token: refreshedToken,
    expiresIn: '8h'
  }
})

app.get('/v1/operator/status', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
  }

  const riskConfig = getEffectiveRiskConfig()

  return {
    mode: store.snapshot.mode,
    pnlPct: store.snapshot.pnlPct,
    riskConfig,
    activeAgents: 0,
    timestamp: new Date().toISOString()
  }
})

app.get('/v1/operator/positions', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
  }
  return store.positions
})

app.get('/v1/operator/orders', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
  }

  const query = request.query as { limit?: string; cursor?: string }
  const hasPagination = typeof query.limit !== 'undefined' || typeof query.cursor !== 'undefined'
  if (!hasPagination) {
    return store.orders
  }

  const limit = Math.min(200, Number(query.limit ?? 100))
  const cursor = Number(query.cursor ?? 0)
  const offset = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100
  const data = store.orders.slice(offset, offset + safeLimit)
  return { data, nextCursor: offset + data.length, total: store.orders.length }
})

app.get('/v1/operator/audit', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
  }

  const query = request.query as any
  const limit = Math.min(200, Number(query.limit ?? 100))
  const cursor = Number(query.cursor ?? 0)
  const data = store.getAudit(limit, cursor)
  const nextCursor = cursor + data.length
  const total = await store.getAuditTotalCount()
  return { data, nextCursor, total }
})

app.post('/v1/operator/command', { ...routeRateLimit(60, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  const parsed = parseCommand(request.body)
  if (!parsed.ok) {
    reply.code(400).send({ error: 'INVALID_COMMAND', message: errorMessages(parsed.errors) })
    return
  }

  const command = parsed.command
  const policy = commandPolicy(command.command)
  const claims = resolveOperatorClaims(request)
  const actorRole =
    claims.roles.includes(OPERATOR_ADMIN_ROLE) ? OPERATOR_ADMIN_ROLE : (claims.roles[0] ?? OPERATOR_VIEW_ROLE)

  if (policy.requiredRoles.includes(OPERATOR_ADMIN_ROLE) && env.OPERATOR_MFA_REQUIRED && !claims.mfa) {
    reply.code(403).send({ error: 'MFA_REQUIRED', message: 'mfa required for this command' })
    return
  }

  if (policy.requiredRoles.length > 0 && !policy.requiredRoles.some((role) => claims.roles.includes(role))) {
    reply.code(403).send({ error: 'FORBIDDEN', message: `missing role: ${policy.requiredRoles.join(',')}` })
    return
  }

  if (!policy.allowedActorTypes.includes('human')) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'human actor not allowed' })
    return
  }

  const requestId = ulid()
  const reasonInput = String(command.reason ?? '')
  if (isPromptInjection(reasonInput)) {
    recordPromptInjection('/v1/operator/command', resolveOperatorClaims(request).sub)
    reply.code(400).send({ error: 'INVALID_COMMAND', message: 'command reason blocked by prompt policy' })
    return
  }

  const sanitizedReason = sanitizeText(reasonInput, { maxLength: 200 })
  const sanitizedArgs = command.args.map((arg) => sanitizeText(arg, { maxLength: 64 }))
  await store.persistCommand({
    command: command.command,
    actorType: 'human',
    actorId: claims.sub,
      reason: sanitizedReason,
      args: sanitizedArgs
    })
  await bus.publish('hlp.commands', {
    type: 'operator.command',
    stream: 'hlp.commands',
    source: 'api',
    correlationId: requestId,
    actorType: 'human',
    actorId: resolveOperatorClaims(request).sub,
    payload: {
      command: command.command,
      args: sanitizedArgs,
      reason: sanitizedReason,
      actor: {
        actorType: 'human',
        actorId: claims.sub,
        role: actorRole,
        requestedAt: new Date().toISOString()
      },
      actorRole,
      capabilities: ['command.execute']
    }
  })

  const result = CommandResultSchema.parse({
    ok: true,
    command: command.command,
    message: 'command submitted',
    requestId
  })

  commandCounter.inc({ actor: 'operator' })
  addAudit(store, resolveOperatorClaims(request).sub, 'operator.command', {
    command: command.command,
    args: command.args,
    reason: sanitizedReason,
    actor: 'operator'
  })
  return reply.send(result)
})

app.patch('/v1/operator/config/risk', { ...routeRateLimit(30, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasRole(request, OPERATOR_ADMIN_ROLE)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'admin role required' })
    return
  }

  const body = request.body as Record<string, unknown>
  const reason = sanitizeText(String(body.reason ?? ''), { maxLength: 200 })
  if (reason.length < 3) {
    reply.code(400).send({ error: 'INVALID_REASON', message: 'mutating config updates require a reason' })
    return
  }

  if (isPromptInjection(reason)) {
    recordPromptInjection('/v1/operator/config/risk', resolveOperatorClaims(request).sub)
    reply.code(400).send({ error: 'INVALID_REASON', message: 'reason blocked by prompt policy' })
    return
  }

  store.setSnapshot({ driftState: 'IN_TOLERANCE', healthCode: 'GREEN' })
  addAudit(store, resolveOperatorClaims(request).sub, 'operator.config.risk', {
    ...body,
    reason
  })
  reply.send({ ok: true })
})

const replayWindow = async (
  request: any,
  reply: any,
  from?: string,
  to?: string,
  correlationId?: string,
  resource?: string,
  limit = 200
) => {
  if (!hasRole(request, OPERATOR_ADMIN_ROLE)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'admin role required' })
    return
  }

  const parsedFrom = from ?? String(request.body?.from ?? request.query.from)
  const parsedTo = to ?? String(request.body?.to ?? request.query.to)
  const parsedCorrelationId = correlationId ?? request.query.correlationId ?? request.body?.correlationId
  const parsedResource = resource ?? request.query.resource ?? request.body?.resource
  const range = ReplayRangeSchema.safeParse({
    from: parsedFrom,
    to: parsedTo,
    correlationId: parsedCorrelationId,
    resource: parsedResource
  })

  if (!range.success) {
    const errors = range.error.issues.map((issue) => issue.message).join('; ')
    reply.code(400).send({ error: 'INVALID_REPLAY', message: errors })
    return
  }

  const parsedLimit = Number(request.query.limit ?? limit)
  const maxLimit = Math.min(5000, Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 200)
  const events: Array<unknown> = []

  const matchesResource = (payload: unknown, stream: string, resource?: string): boolean => {
    if (!resource) {
      return true
    }

    if (stream === resource) {
      return true
    }

    const candidate = typeof payload === 'object' && payload !== null ? (payload as { resource?: unknown }) : undefined
    return candidate?.resource === resource
  }

  await bus.replay('hlp.audit.events', range.data.from, range.data.to, (envelope) => {
    if (range.data.correlationId && envelope.correlationId !== range.data.correlationId) {
      return
    }

    if (!matchesResource(envelope.payload, envelope.stream, range.data.resource)) {
      return
    }

    events.push(envelope)
  })

  reply.send({
    ok: true,
    from: range.data.from,
    to: range.data.to,
    resource: range.data.resource,
    count: events.length,
    events: events.slice(0, maxLimit)
  })
}

app.post('/v1/operator/replay/start', { ...routeRateLimit(30, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  const body = request.body as any
  await replayWindow(
    request,
    reply,
    String(body.from),
    String(body.to),
    body.correlationId,
    body.resource,
    Number(body.limit ?? 200)
  )
})

app.get('/v1/operator/replay', { ...routeRateLimit(30, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  const query = HttpReplayQuerySchema.safeParse(request.query)
  if (!query.success) {
    const errors = query.error.issues.map((issue) => issue.message).join('; ')
    reply.code(400).send({ error: 'INVALID_REPLAY', message: errors })
    return
  }

  await replayWindow(
    request,
    reply,
    query.data.from,
    query.data.to,
    query.data.correlationId,
    query.data.resource,
    query.data.limit
  )
})

app.get('/v1/operator/replay/export', { ...routeRateLimit(20, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasRole(request, OPERATOR_ADMIN_ROLE)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'admin role required' })
    return
  }

  const query = HttpReplayQuerySchema.safeParse(request.query)
  if (!query.success) {
    const errors = query.error.issues.map((issue) => issue.message).join('; ')
    reply.code(400).send({ error: 'INVALID_REPLAY', message: errors })
    return
  }

  const events: Array<unknown> = []
  const parsedLimit = Math.min(5000, Number.isFinite(query.data.limit) && query.data.limit > 0 ? query.data.limit : 200)

  const matchesResource = (payload: unknown, stream: string, resource?: string): boolean => {
    if (!resource) {
      return true
    }

    if (stream === resource) {
      return true
    }

    const candidate = typeof payload === 'object' && payload !== null ? (payload as { resource?: unknown }) : undefined
    return candidate?.resource === resource
  }

  await bus.replay('hlp.audit.events', query.data.from, query.data.to, (envelope) => {
    if (query.data.correlationId && envelope.correlationId !== query.data.correlationId) {
      return
    }

    if (!matchesResource(envelope.payload, envelope.stream, query.data.resource)) {
      return
    }

    events.push(envelope)
  })

  const limited = events.slice(0, parsedLimit)
  reply.header(
    'content-disposition',
    `attachment; filename="hlp-replay-${query.data.from}-${query.data.to}.json"`
  )
  reply.send({
    exportedAt: new Date().toISOString(),
    from: query.data.from,
    to: query.data.to,
    resource: query.data.resource,
    correlationId: query.data.correlationId,
    events: limited
  })
})

app.post('/v1/agent/handshake', routeRateLimit(120, 60_000), async (request, reply) => {
  const body = request.body as any
  const proof = String(body.proof ?? '')
  const requestedTier = EntitlementTierSchema.safeParse(body.requestedTier)

  if (!requestedTier.success) {
    reply.code(400).send({ error: 'INVALID_HANDSHAKE', message: 'requestedTier must be tier0-3' })
    return
  }

  const agentId = String(body.agentId ?? '')
  const parsedTier = requestedTier.data
  const capabilityRequestRaw = Array.isArray(body.requestedCapabilities)
    ? body.requestedCapabilities
    : Array.isArray(body.capabilities)
      ? body.capabilities
      : []
  const requestedCapabilities = capabilityRequestRaw
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry: string) => sanitizeText(entry, { maxLength: 64 }))
    .filter((entry: string): entry is string => entry.length > 0)
  const tierCapabilities = getCapabilitiesForTier(parsedTier)
  const unsupportedCapabilities = requestedCapabilities.filter((entry: string) => !tierCapabilities.includes(entry))

  if (!agentId || !proof) {
    reply.code(400).send({ error: 'INVALID_HANDSHAKE', message: 'agentId and proof required' })
    return
  }

  if (unsupportedCapabilities.length > 0) {
    reply.code(400).send({
      error: 'INVALID_HANDSHAKE',
      message: `unsupported capabilities for ${parsedTier}: ${unsupportedCapabilities.join(',')}`
    })
    return
  }

  const challenge = createChallenge(agentId, '/v1/agent/command', parsedTier)
  if (proof.length < 8) {
    addAgentAudit(store, agentId, 'agent.handshake.failed', {
      reason: 'proof_too_short',
      requestedTier: parsedTier,
      requestedCapabilities
    })
    issuePaymentRecord({
      agentId,
      entitlementId: 'pending',
      challengeId: challenge.challengeId,
      status: 'handshake.failed',
      amountUsd: 0,
      proof,
      metadata: {
        route: '/v1/agent/handshake',
        reason: 'proof too short',
        requestedTier: parsedTier
      }
    })
    reply.code(401).send({ error: 'HANDSHAKE_FAILED', message: 'invalid proof' })
    return
  }

  const grantedCapabilities = requestedCapabilities.length > 0 ? requestedCapabilities : tierCapabilities
  const entitlement: Entitlement = EntitlementSchema.parse({
    agentId,
    tier: parsedTier,
    capabilities: grantedCapabilities,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    quotaRemaining: 1000,
    rateLimitPerMinute: 30
  })

  await store.setEntitlement({ entitlementId: challenge.challengeId, entitlement })
  issuePaymentRecord({
    agentId,
    entitlementId: challenge.challengeId,
    challengeId: challenge.challengeId,
    status: 'challenge.issued',
    amountUsd: 0,
    proof: {
      route: '/v1/agent/handshake',
      agentId,
      tier: parsedTier,
      challengeId: challenge.challengeId
    },
    metadata: {
      route: '/v1/agent/handshake',
      requestedTier: parsedTier
    }
  })
  addAgentAudit(store, agentId, 'agent.handshake', {
    tier: parsedTier,
    requestedCapabilities,
    grantedCapabilities,
    entitlementId: challenge.challengeId
  })
  return reply.send({ challenge, entitlement })
})

const x402Protected = (requiredCapability?: string) => {
  return async (request: any, reply: any) => {
    const token = String(request.headers['x-agent-token'] ?? '')
    const proofPayload = getProofFromRequest(request)
    const parsedProof = PaymentProofSchema.safeParse(proofPayload)
    const amountUsd = parsedProof.success ? normalizeAmountUsd(parsedProof.data.paidAmountUsd) : 0
    const proofAgentId = parsedProof.success ? parsedProof.data.agentId : (token || 'agent')

    const entitlementHeader = request.headers['x-agent-entitlement']
    const normalizedEntitlementHeader = Array.isArray(entitlementHeader) ? entitlementHeader[0] : entitlementHeader
    const entitlementFromProof = parsedProof.success ? parsedProof.data.challengeId : undefined
    const normalizedEntitlementId =
      typeof normalizedEntitlementHeader === 'string' && normalizedEntitlementHeader.trim().length > 0
        ? normalizedEntitlementHeader.trim()
        : typeof entitlementFromProof === 'string' && entitlementFromProof.trim().length > 0
          ? entitlementFromProof.trim()
          : ''

    if (!normalizedEntitlementId) {
      const challenge = createChallenge(token || 'agent', String(request.url), 'tier1')
      issuePaymentRecord({
        agentId: proofAgentId,
        entitlementId: 'pending',
        challengeId: challenge.challengeId,
        status: 'challenge.issued',
        amountUsd,
        proof: parsedProof.success ? parsedProof.data : proofPayload,
        metadata: {
          route: request.url,
          reason: 'missing entitlement/challenge id'
        }
      })
      request.x402GateHandled = true
      reply.header('PAYMENT-REQUIRED', encodePaymentHeader({ challenge }))
      reply.code(402).send({ error: 'PAYMENT_REQUIRED', reason: 'x402-payment required', challenge })
      return
    }

    if (isEntitlementBanned(normalizedEntitlementId)) {
      request.x402GateHandled = true
      reply.code(429).send({ error: 'TEMPORARY_BAN', message: 'rate-limited by abuse protection' })
      return
    }

    let entitlement = await store.getEntitlement(normalizedEntitlementId)

    if (!entitlement) {
      if (proofPayload) {
        const verifyResult = verifyChallenge(normalizedEntitlementId, proofPayload)
        if (!verifyResult.ok) {
          const reason = verifyResult.reason || 'proof verification failed'
          const abuseCount = recordAbuse(normalizedEntitlementId)
          issuePaymentRecord({
            agentId: proofAgentId,
            entitlementId: normalizedEntitlementId,
            challengeId: normalizedEntitlementId,
            status: parsedProof.success ? 'failed.verification_rejected' : 'failed.invalid_proof',
            amountUsd,
            proof: parsedProof.success ? parsedProof.data : proofPayload,
            metadata: {
              route: request.url,
              reason,
              abuseCount,
              paymentEnabled: true
            }
          })
          if (abuseCount >= ABUSE_BAN_THRESHOLD) {
            request.x402GateHandled = true
            reply.code(429).send({ error: 'TEMPORARY_BAN', message: `payment proof abuse (${abuseCount})` })
            return
          }

          request.x402GateHandled = true
          reply.header('PAYMENT-REQUIRED', encodePaymentHeader({ challengeId: normalizedEntitlementId, reason }))
          reply.code(402).send({
            error: 'PAYMENT_REQUIRED',
            reason,
            challenge: normalizedEntitlementId,
            abuseCount
          })
          return
        }

        const tier = parsedProof.success ? parsedProof.data.tier : 'tier0'
        const minted = EntitlementSchema.parse({
          agentId: proofAgentId,
          tier,
          capabilities: getCapabilitiesForTier(tier),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          quotaRemaining: 1000,
          rateLimitPerMinute: 30
        })

        await store.setEntitlement({ entitlementId: normalizedEntitlementId, entitlement: minted })
        entitlement = minted

        reply.header('PAYMENT-RESPONSE', encodePaymentHeader({
          ok: true,
          entitlementId: normalizedEntitlementId,
          verifiedAt: new Date().toISOString()
        }))
      } else {
        const challenge = createChallenge(token || proofAgentId || 'agent', String(request.url), 'tier1')
        issuePaymentRecord({
          agentId: proofAgentId,
          entitlementId: normalizedEntitlementId,
          challengeId: challenge.challengeId,
          status: 'challenge.issued',
          amountUsd,
          metadata: {
            route: request.url,
            reason: 'unknown entitlement'
          }
        })
        request.x402GateHandled = true
        reply.header('PAYMENT-REQUIRED', encodePaymentHeader({ challenge }))
        reply.code(402).send({ error: 'PAYMENT_REQUIRED', reason: 'unknown entitlement', challenge })
        return
      }
    } else if (proofPayload) {
      const verifyResult = verifyChallenge(normalizedEntitlementId, proofPayload)
      if (!verifyResult.ok) {
        const reason = verifyResult.reason || 'proof verification failed'
        const abuseCount = recordAbuse(normalizedEntitlementId)
        issuePaymentRecord({
          agentId: proofAgentId,
          entitlementId: normalizedEntitlementId,
          challengeId: normalizedEntitlementId,
          status: parsedProof.success ? 'failed.verification_rejected' : 'failed.invalid_proof',
          amountUsd,
          proof: parsedProof.success ? parsedProof.data : proofPayload,
          metadata: {
            route: request.url,
            reason,
            abuseCount,
            paymentEnabled: true
          }
        })
        if (abuseCount >= ABUSE_BAN_THRESHOLD) {
          request.x402GateHandled = true
          reply.code(429).send({ error: 'TEMPORARY_BAN', message: `payment proof abuse (${abuseCount})` })
          return
        }

        request.x402GateHandled = true
        reply.header('PAYMENT-REQUIRED', encodePaymentHeader({ challengeId: normalizedEntitlementId, reason }))
        reply.code(402).send({
          error: 'PAYMENT_REQUIRED',
          reason,
          challenge: normalizedEntitlementId,
          abuseCount
        })
        return
      }

      // Provide a settlement-style response header for clients implementing x402 v2 semantics.
      reply.header('PAYMENT-RESPONSE', encodePaymentHeader({
        ok: true,
        entitlementId: normalizedEntitlementId,
        verifiedAt: new Date().toISOString()
      }))
    }

    if (token && entitlement.agentId !== token) {
      const abuseCount = recordAbuse(normalizedEntitlementId)
      issuePaymentRecord({
        agentId: token,
        entitlementId: normalizedEntitlementId,
        challengeId: normalizedEntitlementId,
        status: 'failed.invalid_agent',
        amountUsd,
        metadata: {
          route: request.url,
          abuseCount,
          entitlementAgentId: entitlement.agentId
        }
      })
      if (abuseCount >= ABUSE_BAN_THRESHOLD) {
        request.x402GateHandled = true
        reply.code(429).send({ error: 'TEMPORARY_BAN', message: `agent identity mismatch (abuse ${abuseCount})` })
        return
      }

      request.x402GateHandled = true
      reply.code(403).send({ error: 'INVALID_AGENT', message: `agent mismatch (${abuseCount})` })
      return
    }

    if (new Date(entitlement.expiresAt) < new Date()) {
      issuePaymentRecord({
        agentId: entitlement.agentId,
        entitlementId: normalizedEntitlementId,
        challengeId: normalizedEntitlementId,
        status: 'failed.entitlement_expired',
        amountUsd,
        proof: proofPayload,
        metadata: {
          route: request.url,
          expiresAt: entitlement.expiresAt
        }
      })
      request.x402GateHandled = true
      reply.code(410).send({ error: 'EXPIRED', message: 'entitlement expired' })
      return
    }

    if (requiredCapability && !entitlement.capabilities.includes(requiredCapability)) {
      issuePaymentRecord({
        agentId: entitlement.agentId,
        entitlementId: normalizedEntitlementId,
        challengeId: normalizedEntitlementId,
        status: 'failed.missing_capability',
        amountUsd,
        proof: proofPayload,
        metadata: {
          route: request.url,
          requiredCapability
        }
      })
      request.x402GateHandled = true
      reply.code(403).send({ error: 'FORBIDDEN', message: `missing capability: ${requiredCapability}` })
      return
    }

    const usage = ensureUsageRecord(normalizedEntitlementId)
    usage.requestCount += 1
    if (usage.requestCount > entitlement.rateLimitPerMinute) {
      issuePaymentRecord({
        agentId: entitlement.agentId,
        entitlementId: normalizedEntitlementId,
        challengeId: normalizedEntitlementId,
        status: 'failed.rate_limited',
        amountUsd,
        proof: proofPayload,
        metadata: {
          route: request.url,
          requestCount: usage.requestCount,
          rateLimitPerMinute: entitlement.rateLimitPerMinute
        }
      })
      request.x402GateHandled = true
      reply.code(429).send({ error: 'RATE_LIMIT_EXCEEDED', message: 'too many requests for entitlement window' })
      return
    }

    const { quotaRemaining, overLimit } = consumeQuota(entitlement)
    if (overLimit) {
      issuePaymentRecord({
        agentId: entitlement.agentId,
        entitlementId: normalizedEntitlementId,
        challengeId: normalizedEntitlementId,
        status: 'failed.quota_exhausted',
        amountUsd,
        proof: proofPayload,
        metadata: {
          route: request.url,
          quotaRemaining
        }
      })
      request.x402GateHandled = true
      reply.code(403).send({ error: 'QUOTA_EXHAUSTED', message: 'quota exceeded' })
      return
    }

    await store.setEntitlement({
      entitlementId: normalizedEntitlementId,
      entitlement: {
        ...entitlement,
        quotaRemaining
      }
    })
    issuePaymentRecord({
      agentId: entitlement.agentId,
      entitlementId: normalizedEntitlementId,
      challengeId: normalizedEntitlementId,
      status: proofPayload ? 'verified' : 'entitlement.usage',
      amountUsd,
      proof: proofPayload ?? undefined,
      verifiedAt: new Date().toISOString(),
      metadata: {
        route: request.url,
        quotaRemaining
      }
    })

    ;(request as EntitlementRequest).entitlement = {
      ...entitlement,
      quotaRemaining
    }
  }
}

const x402AgentReadGate = (requiredCapability?: string) => {
  if (x402Facilitator) {
    return x402Facilitator.preHandler
  }
  return x402Protected(requiredCapability)
}

app.get('/v1/agent/stream/snapshot', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('stream.read.public')] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return
  const token = request.headers['x-agent-token']
  const snapshot = store.getPublicSnapshot()
  reply.send({ ...snapshot, source: token ? 'agent' : 'public' })
})

app.get('/v1/agent/analysis/latest', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('analysis.read')] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return
  const latest = store.audits.find((event) => event.resource === 'agent.analysis')
  if (!latest) {
    reply.code(404).send({ error: 'NOT_FOUND', message: 'no analysis available' })
    return
  }

  reply.send(latest)
})

app.get('/v1/agent/analysis', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('analysis.read')] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return
  const query = request.query as any
  const limitRaw = Number(query?.limit ?? 20)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20
  const correlationId = typeof query?.correlationId === 'string' ? query.correlationId.trim() : ''

  const items = store.audits
    .filter((event) => event.resource === 'agent.analysis')
    .filter((event) => !correlationId || event.correlationId === correlationId)
    .slice(0, limit)

  reply.send({ count: items.length, items })
})

app.get('/v1/agent/positions', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('command.positions')] }, async (_request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if (((_request as any).x402GateHandled) || (reply as any).sent || (reply as any).raw?.headersSent) return
  reply.send(store.positions)
})

app.get('/v1/agent/orders', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('command.positions')] }, async (_request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if (((_request as any).x402GateHandled) || (reply as any).sent || (reply as any).raw?.headersSent) return
  reply.send(store.orders)
})

app.get('/v1/agent/data/overview', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('market.data.read')] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return

  const query = request.query as any
  const tapeLimit = normalizeLimit(query?.tapeLimit, 20, 100)
  const snapshot = store.getPublicSnapshot()
  const riskConfig = getEffectiveRiskConfig()
  const signalItems = store.audits
    .filter((event) => event.resource === 'agent.analysis' || event.resource === 'agent.proposal' || event.resource === 'agent.risk')
    .slice(0, tapeLimit)
    .map((event) => ({
      ts: event.ts,
      resource: event.resource,
      action: event.action,
      actorId: event.actorId,
      correlationId: event.correlationId
    }))

  reply.send({
    generatedAt: new Date().toISOString(),
    mode: snapshot.mode,
    pnlPct: snapshot.pnlPct,
    healthCode: snapshot.healthCode,
    driftState: snapshot.driftState,
    riskConfig,
    marketData: {
      openPositionCount: snapshot.openPositionCount ?? snapshot.openPositions.length,
      openPositionNotionalUsd: snapshot.openPositionNotionalUsd,
      openPositions: snapshot.openPositions
    },
    recentOrders: store.orders.slice(0, 25),
    signalHistory: signalItems,
    recentTape: snapshot.recentTape.slice(-tapeLimit)
  })
})

app.get('/v1/agent/insights', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('agent.insights.read')] }, async (_request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if (((_request as any).x402GateHandled) || (reply as any).sent || (reply as any).raw?.headersSent) return

  const snapshot = store.getPublicSnapshot()
  const riskConfig = getEffectiveRiskConfig()
  const latestAnalysis = store.audits.find((event) => event.resource === 'agent.analysis')
  const copySummary = buildCopyTradePositionSummary(store.positions)

  reply.send({
    generatedAt: new Date().toISOString(),
    floor: {
      mode: snapshot.mode,
      pnlPct: snapshot.pnlPct,
      healthCode: snapshot.healthCode,
      driftState: snapshot.driftState,
      updatedAt: snapshot.lastUpdateAt
    },
    riskConfig,
    latestAnalysis: latestAnalysis
      ? {
          ts: latestAnalysis.ts,
          action: latestAnalysis.action,
          resource: latestAnalysis.resource,
          correlationId: latestAnalysis.correlationId
        }
      : null,
    execution: {
      mode: store.snapshot.mode,
      riskPosture: store.snapshot.healthCode,
      openPositionCount: store.positions.length,
      netNotionalUsd: copySummary.totalNotionalUsd,
      longShortBalance: copySummary.longShortBalance
    },
    recentTape: snapshot.recentTape.slice(-20)
  })
})

app.get('/v1/agent/copy-trade/signals', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('copy.signals.read')] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return

  const query = request.query as any
  const limit = sanitizeCopySignalLimit(query?.limit)
  const resourceFilter = typeof query?.resource === 'string' ? query.resource.trim() : undefined

  const signals = store.audits
    .filter((event) => event.resource === 'agent.analysis' || event.resource === 'agent.proposal' || event.resource === 'agent.risk' || event.resource === 'agent.strategist' || event.resource === 'agent.basket')
    .filter((event) => !resourceFilter || event.resource === resourceFilter)
    .slice(0, limit)
    .map((event) => ({
      ts: event.ts,
      resource: event.resource,
      action: event.action,
      actorId: event.actorId,
      correlationId: event.correlationId,
      details: event.details
    }))

  reply.send({ generatedAt: new Date().toISOString(), count: signals.length, signals })
})

app.get('/v1/agent/copy-trade/positions', { ...routeRateLimit(180, 60_000), preHandler: [x402AgentReadGate('copy.positions.read')] }, async (_request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if (((_request as any).x402GateHandled) || (reply as any).sent || (reply as any).raw?.headersSent) return
  const copySummary = buildCopyTradePositionSummary(store.positions)
  const snapshot = store.getPublicSnapshot()

  reply.send({
    generatedAt: new Date().toISOString(),
    mode: snapshot.mode,
    copySignalCompatible: snapshot.mode === 'READY' || snapshot.mode === 'IN_TRADE' || snapshot.mode === 'REBALANCE',
    riskPolicy: getEffectiveRiskConfig(),
    positions: store.positions,
    summary: copySummary
  })
})

app.get('/v1/agent/entitlement', { ...routeRateLimit(180, 60_000), preHandler: [x402Protected()] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return
  reply.send((request as EntitlementRequest).entitlement)
})

app.post('/v1/agent/command', { ...routeRateLimit(60, 60_000), preHandler: [x402Protected('command.status')] }, async (request, reply) => {
  // If the x402 gate already handled the response (e.g. 402), do not double-send.
  if ((request as any).x402GateHandled || (reply as any).sent || (reply as any).raw?.headersSent) return
  const parsed = parseCommand(request.body)
  if (!parsed.ok) {
    reply.code(400).send({ error: 'INVALID_COMMAND', message: errorMessages(parsed.errors) })
    return
  }

  const command = parsed.command
  const reasonInput = String(command.reason ?? '')
  if (isPromptInjection(reasonInput)) {
    const actor = (request as EntitlementRequest).entitlement?.agentId ?? 'agent'
    recordPromptInjection('/v1/agent/command', actor)
    reply.code(400).send({ error: 'INVALID_COMMAND', message: 'command reason blocked by prompt policy' })
    return
  }

  const policy = commandPolicy(command.command)
  const requestedCapability = (request as EntitlementRequest).entitlement?.capabilities ?? []

  if (!policy.allowedActorTypes.includes('external_agent')) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'external_agent commands blocked for this action' })
    return
  }

  if (!policy.requiredCapabilities.every((capability) => requestedCapability.includes(capability))) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'command capability not granted by entitlement' })
    return
  }

  const requestId = ulid()
  const sanitizedReason = sanitizeText(reasonInput, { maxLength: 200 })
  const sanitizedArgs = command.args.map((arg) => sanitizeText(arg, { maxLength: 64 }))
  const actorId = (request as EntitlementRequest).entitlement?.agentId ?? 'agent'
  await store.persistCommand({
    command: command.command,
    actorType: 'external_agent',
    actorId,
    reason: sanitizedReason,
    args: sanitizedArgs
  })
  await bus.publish('hlp.commands', {
    type: 'agent.command',
    stream: 'hlp.commands',
    source: 'agent',
    correlationId: requestId,
    actorType: 'external_agent',
    actorId,
      payload: {
      command: command.command,
      args: sanitizedArgs,
      reason: sanitizedReason,
      capabilities: requestedCapability
    }
  })

  commandCounter.inc({ actor: 'agent' })
  const result = CommandResultSchema.parse({
    ok: true,
    command: command.command,
    message: 'agent command queued',
    requestId
  })
  return reply.send(result)
})

app.post('/v1/agent/unlock/:tier', routeRateLimit(30, 60_000), async (request, reply) => {
  const parsed = EntitlementTierSchema.safeParse((request.params as any).tier)
  if (!parsed.success) {
    reply.code(400).send({ error: 'INVALID_TIER', message: 'tier must be tier0-3' })
    return
  }

  const tier = parsed.data
  const entitlement = EntitlementSchema.parse({
    agentId: String((request.body as any)?.agentId ?? 'agent'),
    tier,
    capabilities: getCapabilitiesForTier(tier),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    quotaRemaining: 1000,
    rateLimitPerMinute: 30
  })

  const challenge = createChallenge(entitlement.agentId, String(request.url), tier)
  issuePaymentRecord({
    agentId: entitlement.agentId,
    entitlementId: challenge.challengeId,
    challengeId: challenge.challengeId,
    status: 'challenge.issued',
    amountUsd: 0,
    metadata: {
      route: '/v1/agent/unlock',
      tier
    }
  })
  await store.setEntitlement({ entitlementId: challenge.challengeId, entitlement })
  return reply.send({ challenge, entitlement })
})

app.get('/v1/security/refresh-secrets', { ...routeRateLimit(10, 60_000), preHandler: [app.authenticate] }, async (_request, reply) => {
  reply.send({ ok: true, issuedAt: new Date().toISOString() })
})

app.get('/metrics', routeRateLimit(20, 60_000), async () => {
  return await promClient.register.metrics()
})

bus.consume('hlp.ui.events', '0-0', (envelope) => {
  if (envelope.type === 'STATE_UPDATE') {
    const payload = envelope.payload as any
    store.setSnapshot(payload)

    if (typeof payload?.message === 'string') {
      const text = payload.message.trim()
      if (text) {
        store.addPublicTapeLine({
          ts: typeof payload.ts === 'string' ? payload.ts : envelope.ts,
          role: 'ops',
          level: 'INFO',
          line: sanitizeText(text, { maxLength: 240 })
        })
      }
    }
  }

  if (envelope.type === 'FLOOR_TAPE') {
    const parsed = FloorTapeLineSchema.safeParse({
      ts: typeof (envelope.payload as any)?.ts === 'string' ? (envelope.payload as any).ts : envelope.ts,
      role: typeof (envelope.payload as any)?.role === 'string' ? (envelope.payload as any).role : undefined,
      level: (envelope.payload as any)?.level === 'WARN' || (envelope.payload as any)?.level === 'ERROR' ? (envelope.payload as any).level : 'INFO',
      line: typeof (envelope.payload as any)?.line === 'string' ? (envelope.payload as any).line : ''
    })
    if (parsed.success) {
      store.addPublicTapeLine(parsed.data)
    }
  }

  if (envelope.type === 'POSITION_UPDATE') {
    const payload = envelope.payload as any
    if (Array.isArray(payload)) {
      store.setPositions(payload)
    }
  }

  if (envelope.type === 'ORDER_UPDATE') {
    const payload = envelope.payload as any
    if (Array.isArray(payload)) {
      store.setOrders(payload)
    }
  }

  return Promise.resolve()
})

bus.consume('hlp.audit.events', '0-0', (envelope) => {
  const payload = envelope.payload as AuditEvent
  if (payload && payload.action && payload.actorId) {
    store.addAudit({
      ...payload,
      id: payload.id ?? ulid(),
      ts: payload.ts ?? new Date().toISOString(),
      actorType: payload.actorType,
      actorId: payload.actorId,
      action: payload.action,
      resource: payload.resource,
      correlationId: payload.correlationId,
      details: payload.details
    })
    auditCounter.inc()
  }
  return Promise.resolve()
})

const start = async () => {
  await store.ready()
  const address = await app.listen({ host: env.API_HOST ?? '0.0.0.0', port: env.API_PORT })
  app.log.info(`api listening on ${address}`)
}

const shutdown = async () => {
  await store.close().catch(() => undefined)
  await stopTelemetry()
  process.exit(0)
}

void start().catch((error) => {
  app.log.error(error)
  process.exit(1)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function addAudit(storeRef: ApiStore, actor: string, action: string, details: Record<string, unknown>) {
  const safeActor = sanitizeText(actor, { maxLength: 120 })
  const event: AuditEvent = {
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'human',
    actorId: safeActor,
    action,
    resource: 'api',
    correlationId: ulid(),
    details: { ...details },
    hash: 'pending'
  }
  storeRef.addAudit(event)
  void bus.publish('hlp.audit.events', {
    type: 'AUDIT_EVENT',
    stream: 'hlp.audit.events',
    source: 'api',
    correlationId: event.id,
    actorType: 'human',
    actorId: actor,
    payload: event
  })
}

function addAgentAudit(storeRef: ApiStore, agentId: string, action: string, details: Record<string, unknown>) {
  const safeActor = sanitizeText(agentId, { maxLength: 120 })
  const event: AuditEvent = {
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'external_agent',
    actorId: safeActor,
    action,
    resource: 'api.agent',
    correlationId: ulid(),
    details,
    hash: 'pending'
  }

  storeRef.addAudit(event)
  void bus.publish('hlp.audit.events', {
    type: 'AUDIT_EVENT',
    stream: 'hlp.audit.events',
    source: 'api',
    correlationId: event.id,
    actorType: 'external_agent',
    actorId: safeActor,
    payload: event
  })
}
