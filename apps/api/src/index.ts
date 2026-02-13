import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import {
  AuditEvent,
  CommandResultSchema,
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
  origin: [env.PUBLIC_BASE_URL, 'http://localhost:3000', 'https://hlprivateer.xyz'],
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
  const message = error instanceof Error ? error.message : String(error)
  reply.code(500).send({ error: 'INTERNAL', message })
})

const adminUsers = new Set(
  env.OPERATOR_ADMIN_USERS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
)

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
    } catch {
      return undefined
    }
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64url').toString('utf8')
    if (decoded.startsWith('{')) {
      return JSON.parse(decoded)
    }
  } catch {
    // Fall through and try standard base64.
  }

  // x402 v2 docs refer to Base64-encoded JSON header values; accept both base64url and base64.
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
    if (decoded.startsWith('{')) {
      return JSON.parse(decoded)
    }
  } catch {
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
  } catch {
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

app.get('/v1/public/pnl', routeRateLimit(180, 60_000), async (_, reply) => {
  const payload = PublicPnlResponseSchema.parse(store.getPublicPnl())
  reply.send(payload)
})

app.get('/v1/public/floor-snapshot', routeRateLimit(180, 60_000), async (_, reply) => {
  const payload = PublicSnapshotSchema.parse(store.getPublicSnapshot())
  reply.send(payload)
})

app.post('/v1/operator/login', routeRateLimit(20, 60_000), async (request, reply) => {
  const body = request.body as any
  const user = String(body.user ?? 'operator')
  const mfa = Boolean(body.mfa ?? true)
  const roles = [OPERATOR_VIEW_ROLE, ...(adminUsers.has(user) ? [OPERATOR_ADMIN_ROLE] : [])]
  const token = await app.jwt.sign({ sub: user, roles, mfa })
  reply.send({ token })
})

app.post('/v1/operator/refresh', { ...routeRateLimit(30, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  const claims = resolveOperatorClaims(request)
  if (!claims.sub) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'missing subject claim' })
    return
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
  reply.send({
    token: refreshedToken,
    expiresIn: '8h'
  })
})

app.get('/v1/operator/status', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
    return
  }

  reply.send({
    mode: store.snapshot.mode,
    pnlPct: store.snapshot.pnlPct,
    riskConfig: {
      maxLeverage: 2,
      maxDrawdownPct: 5,
      maxNotionalUsd: 10000
    },
    activeAgents: 0,
    timestamp: new Date().toISOString()
  })
})

app.get('/v1/operator/positions', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
    return
  }
  reply.send(store.positions)
})

app.get('/v1/operator/orders', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
    return
  }

  const query = request.query as { limit?: string; cursor?: string }
  const hasPagination = typeof query.limit !== 'undefined' || typeof query.cursor !== 'undefined'
  if (!hasPagination) {
    reply.send(store.orders)
    return
  }

  const limit = Math.min(200, Number(query.limit ?? 100))
  const cursor = Number(query.cursor ?? 0)
  const offset = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100
  const data = store.orders.slice(offset, offset + safeLimit)
  reply.send({ data, nextCursor: offset + data.length, total: store.orders.length })
})

app.get('/v1/operator/audit', { ...routeRateLimit(120, 60_000), preHandler: [app.authenticate] }, async (request, reply) => {
  if (!hasAnyRole(request, [OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'view role required' })
    return
  }

  const query = request.query as any
  const limit = Math.min(200, Number(query.limit ?? 100))
  const cursor = Number(query.cursor ?? 0)
  const data = store.getAudit(limit, cursor)
  const nextCursor = cursor + data.length
  const total = await store.getAuditTotalCount()
  reply.send({ data, nextCursor, total })
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
        role: claims.roles[0],
        requestedAt: new Date().toISOString()
      },
      actorRole: claims.roles[0],
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
  reply.send(result)
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
  reply.send({ challenge, entitlement })
})

const x402Protected = (requiredCapability?: string) => {
  return async (request: any, reply: any) => {
    const token = String(request.headers['x-agent-token'] ?? '')
    const entitlementId = request.headers['x-agent-entitlement']
    const normalizedEntitlementId = Array.isArray(entitlementId) ? entitlementId[0] : entitlementId
    if (!normalizedEntitlementId || typeof normalizedEntitlementId !== 'string') {
      const challenge = createChallenge(token || 'agent', String(request.url), 'tier1')
      issuePaymentRecord({
        agentId: token || 'agent',
        entitlementId: 'pending',
        challengeId: challenge.challengeId,
        status: 'challenge.issued',
        amountUsd: 0,
        metadata: {
          route: request.url,
          reason: 'missing entitlement header'
        }
      })
      reply.header('PAYMENT-REQUIRED', encodePaymentHeader({ challenge }))
      reply.code(402).send({
        error: 'PAYMENT_REQUIRED',
        reason: 'x402-payment required',
        challenge
      })
      return
    }

    if (isEntitlementBanned(normalizedEntitlementId)) {
      reply.code(429).send({ error: 'TEMPORARY_BAN', message: 'rate-limited by abuse protection' })
      return
    }

    const entitlement = await store.getEntitlement(normalizedEntitlementId)
    if (!entitlement) {
      const challenge = createChallenge(token || 'agent', String(request.url), 'tier1')
      issuePaymentRecord({
        agentId: token || 'agent',
        entitlementId: normalizedEntitlementId,
        challengeId: challenge.challengeId,
        status: 'challenge.issued',
        amountUsd: 0,
        metadata: {
          route: request.url,
          reason: 'unknown entitlement'
        }
      })
      reply.header('PAYMENT-REQUIRED', encodePaymentHeader({ challenge }))
      reply.code(402).send({ error: 'PAYMENT_REQUIRED', reason: 'unknown entitlement', challenge })
      return
    }

    if (token && entitlement.agentId !== token) {
      const abuseCount = recordAbuse(normalizedEntitlementId)
      issuePaymentRecord({
        agentId: token,
        entitlementId: normalizedEntitlementId,
        challengeId: normalizedEntitlementId,
        status: 'failed.invalid_agent',
        amountUsd: 0,
        metadata: {
          route: request.url,
          abuseCount,
          entitlementAgentId: entitlement.agentId
        }
      })
      if (abuseCount >= ABUSE_BAN_THRESHOLD) {
        reply.code(429).send({ error: 'TEMPORARY_BAN', message: `agent identity mismatch (abuse ${abuseCount})` })
        return
      }

      reply.code(403).send({ error: 'INVALID_AGENT', message: `agent mismatch (${abuseCount})` })
      return
    }

    const proofPayload = getProofFromRequest(request)
    const parsedProof = PaymentProofSchema.safeParse(proofPayload)
    const amountUsd = parsedProof.success ? normalizeAmountUsd(parsedProof.data.paidAmountUsd) : 0
    const proofAgentId = parsedProof.success ? parsedProof.data.agentId : (token || 'agent')
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
        reply.code(429).send({ error: 'TEMPORARY_BAN', message: `payment proof abuse (${abuseCount})` })
        return
      }

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
      status: 'verified',
      amountUsd,
      proof: proofPayload,
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

app.get('/v1/agent/stream/snapshot', { ...routeRateLimit(180, 60_000), preHandler: [x402Protected('stream.read.public')] }, async (request, reply) => {
  const token = request.headers['x-agent-token']
  const snapshot = store.getPublicSnapshot()
  reply.send({ ...snapshot, source: token ? 'agent' : 'public' })
})

app.get('/v1/agent/entitlement', { ...routeRateLimit(180, 60_000), preHandler: [x402Protected()] }, async (request, reply) => {
  reply.send((request as EntitlementRequest).entitlement)
})

app.post('/v1/agent/command', { ...routeRateLimit(60, 60_000), preHandler: [x402Protected('command.status')] }, async (request, reply) => {
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
  reply.send(result)
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
  reply.send({ challenge, entitlement })
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
  const address = await app.listen({ port: env.PORT })
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
