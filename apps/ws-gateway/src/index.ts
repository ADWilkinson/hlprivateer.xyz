import http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { ulid } from 'ulid'
import promClient from 'prom-client'
import {
  ActorType,
  Channel,
  OPERATOR_ADMIN_ROLE,
  OPERATOR_VIEW_ROLE,
  type Role,
  CommandResultSchema,
  DEFAULT_TIER_CAPABILITIES,
  parseCommand,
  commandPolicy,
  WsClientMessage,
  WsMessageSchema,
  WsServerMessage,
  WsServerMessageSchema
} from '@hl/privateer-contracts'
import { InMemoryEventBus, RedisEventBus } from '@hl/privateer-event-bus'
import { initializeTelemetry, stopTelemetry } from './telemetry'

const PORT = Number(process.env.WS_PORT ?? 4100)
const NODE_ENV = process.env.NODE_ENV ?? 'development'
const REDIS_URL = process.env.REDIS_URL
const REDIS_STREAM_PREFIX = process.env.REDIS_STREAM_PREFIX ?? 'hlp'
const METRICS_PATH = '/metrics'
const JWT_SECRET = process.env.JWT_SECRET
const WS_ALLOW_INSECURE_TOKENS = parseBooleanEnv(process.env.WS_ALLOW_INSECURE_TOKENS, false)
const OPERATOR_MFA_REQUIRED = parseBooleanEnv(process.env.OPERATOR_MFA_REQUIRED, true)

type WsActorType = 'public' | 'operator' | 'agent'

interface ClientInfo {
  socketId: string
  ws: any
  channels: Set<Channel>
  token?: string
  actorId: string
  actorType: WsActorType
  actorRole?: Role
  roles: Role[]
  mfa?: boolean
  capabilities: string[]
}

interface SlidingWindow {
  windowStart: number
  count: number
}

const bus = REDIS_URL ? new RedisEventBus(REDIS_URL, REDIS_STREAM_PREFIX) : new InMemoryEventBus()
const clients = new Map<string, ClientInfo>()
const commandWindows = new Map<string, SlidingWindow>()
const abuseWindows = new Map<string, SlidingWindow>()
const bannedActors = new Map<string, number>()

const COMMAND_WINDOW_MS = 10_000
const COMMAND_RATE_LIMIT = 20
const ABUSE_BAN_THRESHOLD = 8
const ABUSE_BAN_WINDOW_MS = 60_000
const MAX_WS_BUFFER_BYTES = 1_000_000
const MAX_WS_MESSAGE_BYTES = 4_096
const MAX_TOKEN_LENGTH = 4096
const TOKEN_PATTERN = /^[a-zA-Z0-9._:-]{1,120}$/
const MAX_CHANNEL_LENGTH = 32

void initializeTelemetry('hlprivateer-ws-gateway')

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string') {
    return defaultValue
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
    return false
  }

  return defaultValue
}

const wsCommandCounter = new promClient.Counter({
  name: 'hlp_ws_command_total',
  help: 'Total websocket command attempts',
  labelNames: ['actorType', 'command', 'result']
})
const wsEventCounter = new promClient.Counter({
  name: 'hlp_ws_event_total',
  help: 'Total websocket events sent to clients',
  labelNames: ['channel']
})
const wsBanCounter = new promClient.Counter({
  name: 'hlp_ws_ban_total',
  help: 'Total websocket temporary bans'
})
const wsAbuseCounter = new promClient.Counter({
  name: 'hlp_ws_abuse_total',
  help: 'Total websocket abuse actions observed'
})
const wsConnections = new promClient.Gauge({
  name: 'hlp_ws_connections',
  help: 'Active websocket connections'
})
const wsSecurityCounter = new promClient.Counter({
  name: 'hlp_ws_security_events_total',
  help: 'Total websocket security events',
  labelNames: ['reason']
})

void promClient.collectDefaultMetrics()

function getCapabilitiesForToken(tier: string | undefined): string[] {
  const normalizedTier = tier === 'tier0' || tier === 'tier1' || tier === 'tier2' || tier === 'tier3' ? tier : 'tier0'
  return (DEFAULT_TIER_CAPABILITIES as Record<'tier0' | 'tier1' | 'tier2' | 'tier3', string[]>)[normalizedTier]
}

interface OperatorJwtClaims {
  sub?: string
  roles?: unknown
  mfa?: unknown
  iss?: unknown
  aud?: unknown
  exp?: unknown
}

interface ResolvedIdentity {
  actorType: WsActorType
  actorId: string
  actorRole?: Role
  roles: Role[]
  mfa?: boolean
  capabilities: string[]
}

type IdentityResult =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: string }

function safeJsonParse(input: string): any | undefined {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function base64UrlDecodeUtf8(value: string): string | undefined {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return undefined
  }
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8')
  const rightBuf = Buffer.from(right, 'utf8')
  if (leftBuf.length !== rightBuf.length) {
    return false
  }
  return timingSafeEqual(leftBuf, rightBuf)
}

function verifyHs256Jwt(token: string, secret: string): { ok: true; payload: OperatorJwtClaims } | { ok: false; reason: string } {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, reason: 'invalid token' }
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const headerText = base64UrlDecodeUtf8(encodedHeader)
  const payloadText = base64UrlDecodeUtf8(encodedPayload)
  if (!headerText || !payloadText) {
    return { ok: false, reason: 'invalid token' }
  }

  const header = safeJsonParse(headerText)
  if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
    return { ok: false, reason: 'invalid token' }
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')
  if (!timingSafeEqualString(expectedSignature, encodedSignature)) {
    return { ok: false, reason: 'invalid token' }
  }

  const payload = safeJsonParse(payloadText) as OperatorJwtClaims | undefined
  if (!payload) {
    return { ok: false, reason: 'invalid token' }
  }

  const expSeconds = typeof payload.exp === 'number' ? payload.exp : Number(payload.exp)
  if (Number.isFinite(expSeconds) && Date.now() / 1000 >= expSeconds) {
    return { ok: false, reason: 'token expired' }
  }

  if (payload.iss !== 'hlprivateer-api') {
    return { ok: false, reason: 'invalid token' }
  }

  const aud = payload.aud
  const audOk = aud === 'hlprivateer-operator' || (Array.isArray(aud) && aud.includes('hlprivateer-operator'))
  if (!audOk) {
    return { ok: false, reason: 'invalid token' }
  }

  return { ok: true, payload }
}

function resolveIdentity(token?: string): IdentityResult {
  if (!token) {
    return {
      ok: true,
      identity: { actorType: 'public', actorId: 'anonymous', roles: [], capabilities: [] }
    }
  }

  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'invalid token' }
  }

  if (token.startsWith('operator:') || token.startsWith('agent:')) {
    if (NODE_ENV === 'production' || !WS_ALLOW_INSECURE_TOKENS) {
      return { ok: false, reason: 'invalid token' }
    }

    if (!TOKEN_PATTERN.test(token)) {
      return { ok: false, reason: 'invalid token' }
    }

    if (token.startsWith('operator:')) {
      const actorId = token.replace('operator:', '') || 'operator'
      return {
        ok: true,
        identity: {
          actorType: 'operator',
          actorId,
          actorRole: OPERATOR_ADMIN_ROLE,
          roles: [OPERATOR_ADMIN_ROLE],
          mfa: true,
          capabilities: getCapabilitiesForToken('tier3')
        }
      }
    }

    const parts = token.split(':')
    const actorId = parts[1] || 'agent'
    const tier = parts[2]
    return { ok: true, identity: { actorType: 'agent', actorId, roles: [], capabilities: getCapabilitiesForToken(tier) } }
  }

  if (!JWT_SECRET || JWT_SECRET === 'replace-me') {
    return { ok: false, reason: 'invalid token' }
  }

  const jwtResult = verifyHs256Jwt(token, JWT_SECRET)
  if (!jwtResult.ok) {
    return { ok: false, reason: jwtResult.reason }
  }

  const claims = jwtResult.payload
  const roles: Role[] = Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is Role => role === OPERATOR_ADMIN_ROLE || role === OPERATOR_VIEW_ROLE)
    : []

  const actorRole = roles.includes(OPERATOR_ADMIN_ROLE)
    ? OPERATOR_ADMIN_ROLE
    : roles.includes(OPERATOR_VIEW_ROLE)
      ? OPERATOR_VIEW_ROLE
      : undefined

  if (!actorRole) {
    return { ok: false, reason: 'invalid token' }
  }

  const actorId = typeof claims.sub === 'string' && claims.sub.trim().length > 0 ? claims.sub.trim() : 'operator'
  const mfa = Boolean(claims.mfa)
  const capabilities = actorRole === OPERATOR_ADMIN_ROLE
    ? getCapabilitiesForToken('tier3')
    : ['stream.read.public', 'command.status', 'command.positions', 'command.explain.redacted', 'command.audit']

  return {
    ok: true,
    identity: {
      actorType: 'operator',
      actorId,
      actorRole,
      roles,
      mfa,
      capabilities
    }
  }
}

function actorKey(actorType: WsActorType, actorId: string): string {
  return `${actorType}:${actorId}`
}

function isBanned(actorType: WsActorType, actorId: string): boolean {
  const key = actorKey(actorType, actorId)
  const expiresAt = bannedActors.get(key)
  if (!expiresAt) {
    return false
  }

  if (Date.now() > expiresAt) {
    bannedActors.delete(key)
    return false
  }

  return true
}

function applyBan(actorType: WsActorType, actorId: string): void {
  const key = actorKey(actorType, actorId)
  bannedActors.set(key, Date.now() + ABUSE_BAN_WINDOW_MS)
  wsBanCounter.inc()
}

function recordAbuse(actorType: WsActorType, actorId: string): number {
  const key = actorKey(actorType, actorId)
  const now = Date.now()
  const window = abuseWindows.get(key)

  if (!window || now - window.windowStart >= ABUSE_BAN_WINDOW_MS) {
    abuseWindows.set(key, { windowStart: now, count: 1 })
    return 1
  }

  window.count += 1
  if (window.count >= ABUSE_BAN_THRESHOLD) {
    applyBan(actorType, actorId)
  }

  wsAbuseCounter.inc()
  return window.count
}

function canSubscribe(role: WsActorType, channel: Channel): boolean {
  if (!channel || channel.length > MAX_CHANNEL_LENGTH) {
    return false
  }

  if (channel === 'public') {
    return true
  }

  if (channel === 'operator') {
    return role === 'operator'
  }

  if (channel === 'agent') {
    return role === 'agent' || role === 'operator'
  }

  if (channel === 'audit') {
    return role === 'operator'
  }

  return role === 'operator'
}

function toPolicyActorType(actorType: WsActorType): ActorType {
  if (actorType === 'operator') {
    return 'human'
  }

  if (actorType === 'agent') {
    return 'external_agent'
  }

  return 'system'
}

function trackCommand(socketId: string): boolean {
  const now = Date.now()
  const window = commandWindows.get(socketId)
  if (!window || now - window.windowStart >= COMMAND_WINDOW_MS) {
    commandWindows.set(socketId, { windowStart: now, count: 1 })
    return true
  }

  if (window.count >= COMMAND_RATE_LIMIT) {
    return false
  }

  window.count += 1
  return true
}

function sendSafe(ws: any, message: WsServerMessage) {
  if (!ws || ws.readyState !== 1) {
    return
  }

  if (ws.bufferedAmount > MAX_WS_BUFFER_BYTES) {
    return
  }

  send(ws, message)
}

function sanitizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  return undefined
}

function sanitizePositionRows(raw: unknown, maxRows = 200): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const position = entry as Record<string, unknown>
      const symbol = typeof position.symbol === 'string' ? sanitizeText(position.symbol, 24) : undefined
      if (!symbol) return null

      const side = typeof position.side === 'string' ? sanitizeText(position.side, 12) : undefined
      const size = sanitizeFiniteNumber(position.size ?? position.qty ?? position.amount ?? position.quantity)
      const entryPrice = sanitizeFiniteNumber(position.entryPrice ?? position.entry_price ?? position.entry ?? position.avgEntryPx ?? position.avg_entry_px)
      const markPrice = sanitizeFiniteNumber(position.markPrice ?? position.mark_price ?? position.mark ?? position.avgMarkPx ?? position.avg_mark_px)
      const pnlUsd = sanitizeFiniteNumber(position.pnlUsd ?? position.pnl ?? position.pnl_usd ?? position.unrealizedPnl ?? position.unrealized)
      const pnlPct = sanitizeFiniteNumber(position.pnlPct ?? position.pnl_pct ?? position.pnlPercent ?? position.pnl_percent)
      const notionalUsd = sanitizeFiniteNumber(position.notionalUsd ?? position.notional_usd ?? position.notional)
      const id = typeof position.id === 'string' ? sanitizeText(position.id, 32) : undefined

      return {
        symbol,
        ...(side ? { side } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(entryPrice !== undefined ? { entryPrice } : {}),
        ...(markPrice !== undefined ? { markPrice } : {}),
        ...(pnlUsd !== undefined ? { pnlUsd } : {}),
        ...(pnlPct !== undefined ? { pnlPct } : {}),
        ...(notionalUsd !== undefined ? { notionalUsd } : {}),
        ...(id ? { id } : {}),
      }
    })
    .filter((entry): entry is { symbol: string } & Record<string, unknown> => {
      return Boolean(entry)
    })
    .slice(0, maxRows)
}

function sanitizeForPublic(type: string, rawPayload: unknown): Record<string, unknown> {
  if (type === 'STATE_UPDATE') {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return { type: 'STATE_UPDATE', ts: new Date().toISOString() }
    }

    const payload = rawPayload as Record<string, unknown>
    const message = typeof payload.message === 'string' ? payload.message : undefined
    const openPositions = sanitizePositionRows(payload.openPositions ?? payload.positions)
    const openPositionCount = sanitizeFiniteNumber(payload.openPositionCount ?? payload.open_position_count ?? payload.positionCount ?? payload.positionsCount)
    const openPositionNotionalUsd = sanitizeFiniteNumber(
      payload.openPositionNotionalUsd ?? payload.openPositionNotional ?? payload.open_position_notional,
    )
    const computedOpenPositionNotionalUsd = Number.isFinite(openPositionNotionalUsd ?? Number.NaN)
      ? openPositionNotionalUsd
      : openPositions.length > 0
        ? openPositions.reduce((seed, entry) => seed + Math.abs(sanitizeFiniteNumber(entry.notionalUsd) ?? 0), 0)
        : undefined
    return {
      // Keep public payload shape compatible with the web UI client which expects `type`.
      type: 'STATE_UPDATE',
      mode: payload.mode,
      driftState: payload.driftState,
      healthCode: payload.healthCode,
      pnlPct: payload.pnlPct,
      lastUpdateAt: payload.lastUpdateAt,
      ...(openPositions.length > 0 ? { openPositions } : {}),
      ...(openPositionCount !== undefined ? { openPositionCount } : {}),
      ...(computedOpenPositionNotionalUsd !== undefined ? { openPositionNotionalUsd: computedOpenPositionNotionalUsd } : {}),
      ...(message ? { message: sanitizeText(message, 180) } : {}),
      ts: new Date().toISOString()
    }
  }

  if (type === 'FLOOR_TAPE') {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return { type: 'FLOOR_TAPE', ts: new Date().toISOString(), line: '' }
    }

    const payload = rawPayload as Record<string, unknown>
    const lineRaw = typeof payload.line === 'string' ? payload.line : typeof payload.message === 'string' ? payload.message : ''
    const roleRaw = typeof payload.role === 'string' ? payload.role : undefined
    const levelRaw = typeof payload.level === 'string' ? payload.level : undefined
    const ts = typeof payload.ts === 'string' ? payload.ts : new Date().toISOString()

    return {
      type: 'FLOOR_TAPE',
      ts,
      line: sanitizeText(lineRaw, 240),
      ...(roleRaw ? { role: sanitizeText(roleRaw, 32) } : {}),
      ...(levelRaw ? { level: sanitizeText(levelRaw, 16) } : {})
    }
  }

  return { type: 'event', ts: new Date().toISOString() }
}

function broadcastChannelForType(type: string): Channel {
  if (type === 'STATE_UPDATE' || type === 'FLOOR_TAPE') {
    return 'public'
  }

  return 'operator'
}

function publishSecurityEvent(actorType: ActorType, actorId: string, reason: string): void {
  void bus.publish('hlp.audit.events', {
    type: 'SECURITY_EVENT',
    stream: 'hlp.audit.events',
    source: 'ws-gateway',
    correlationId: ulid(),
    actorType,
    actorId,
    payload: {
      id: ulid(),
      ts: new Date().toISOString(),
      actorType,
      actorId,
      action: 'ws.security_event',
      resource: 'ws-gateway',
      correlationId: ulid(),
      details: { reason },
      hash: 'pending'
    }
  })
}

const server = http.createServer(async (request, response) => {
  if (request.url === METRICS_PATH && request.method === 'GET') {
    response.setHeader('content-type', promClient.register.contentType)
    response.end(await promClient.register.metrics())
    return
  }

  response.statusCode = 404
  response.end('not found')
})
const wss = new WebSocketServer({ server })

function sanitizeText(value: string, maxLength = 180): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

function send(ws: any, message: WsServerMessage) {
  const parsed = WsServerMessageSchema.parse(message)
  ws.send(JSON.stringify(parsed))
}

wss.on('connection', (ws, request) => {
  const socketId = ulid()
  const token = new URL(request.url ?? '/', `http://localhost:${PORT}`).searchParams.get('token') ?? undefined
  const identityResult = resolveIdentity(token)
  if (!identityResult.ok) {
    wsSecurityCounter.inc({ reason: 'invalid_token' })
    ws.close(4401, identityResult.reason)
    return
  }

  const identity = identityResult.identity
  const auditActorType = toPolicyActorType(identity.actorType)

  if (isBanned(identity.actorType, identity.actorId)) {
    publishSecurityEvent(auditActorType, identity.actorId, 'banned_connect_attempt')
    ws.close(4403, 'temporarily banned')
    return
  }

  const client: ClientInfo = {
    socketId,
    ws,
    channels: new Set(['public']),
    token,
    actorId: identity.actorId,
    actorType: identity.actorType,
    actorRole: identity.actorRole,
    roles: identity.roles,
    mfa: identity.mfa,
    capabilities: identity.capabilities
  }
  clients.set(socketId, client)
  wsConnections.inc()
  send(ws, { type: 'sub.ack', channel: 'public', accepted: true })

  ws.on('message', async (raw: Buffer | ArrayBuffer | string) => {
    const current = clients.get(socketId)
    if (!current) {
      return
    }

    const rawMessage = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : Buffer.from(raw)
    if (rawMessage.length > MAX_WS_MESSAGE_BYTES) {
      const abuseCount = recordAbuse(identity.actorType, identity.actorId)
      wsSecurityCounter.inc({ reason: 'payload_too_large' })
      publishSecurityEvent(auditActorType, identity.actorId, `ws_message_size:${abuseCount}`)
      if (abuseCount >= ABUSE_BAN_THRESHOLD) {
        ws.close(4403, 'abuse threshold exceeded')
        return
      }

      send(current.ws, { type: 'error', requestId: ulid(), code: 'BAD_MESSAGE', message: 'websocket message too large' })
      return
    }

    let parsed: WsClientMessage
    const rawPayload = rawMessage.toString('utf8')
    try {
      parsed = WsMessageSchema.parse(JSON.parse(rawPayload))
    } catch {
      const abuseCount = recordAbuse(identity.actorType, identity.actorId)
      wsSecurityCounter.inc({ reason: 'invalid_message' })
      publishSecurityEvent(auditActorType, identity.actorId, `invalid_ws_message:${abuseCount}`)
      if (abuseCount >= ABUSE_BAN_THRESHOLD) {
        ws.close(4403, 'abuse threshold exceeded')
        return
      }

      send(current.ws, { type: 'error', requestId: ulid(), code: 'BAD_MESSAGE', message: 'invalid websocket message' })
      return
    }

    if (parsed.type === 'sub.add') {
      if (!canSubscribe(current.actorType, parsed.channel)) {
        const abuseCount = recordAbuse(identity.actorType, identity.actorId)
        wsSecurityCounter.inc({ reason: 'invalid_subscription' })
        publishSecurityEvent(auditActorType, identity.actorId, `invalid_subscription:${abuseCount}`)
        send(current.ws, { type: 'sub.ack', channel: parsed.channel, accepted: false })
        return
      }

      current.channels.add(parsed.channel)
      send(current.ws, { type: 'sub.ack', channel: parsed.channel, accepted: true })
      return
    }

    if (parsed.type === 'sub.remove') {
      current.channels.delete(parsed.channel)
      send(current.ws, { type: 'sub.ack', channel: parsed.channel, accepted: true })
      return
    }

    if (parsed.type === 'ping') {
      send(current.ws, { type: 'pong' })
      return
    }

    if (parsed.type === 'cmd.exec') {
      if (!trackCommand(socketId)) {
        publishSecurityEvent(auditActorType, identity.actorId, 'ws_command_rate_limit')
        send(current.ws, {
          type: 'error',
          requestId: ulid(),
          code: 'RATE_LIMITED',
          message: 'command rate limit exceeded'
        })
        wsCommandCounter.inc({ actorType: identity.actorType, command: 'unknown', result: 'rate_limited' })
        return
      }

      const commandRequest = parseCommand({
        command: sanitizeText(parsed.command, 32),
        args: parsed.args.map((argument) => sanitizeText(argument, 64)),
        reason: 'websocket command'
      })

      if (!commandRequest.ok) {
        const abuseCount = recordAbuse(identity.actorType, identity.actorId)
        wsSecurityCounter.inc({ reason: 'invalid_command' })
        publishSecurityEvent(auditActorType, identity.actorId, `invalid_command:${abuseCount}`)
        if (abuseCount >= ABUSE_BAN_THRESHOLD) {
          ws.close(4403, 'abuse threshold exceeded')
          return
        }

        send(current.ws, {
          type: 'error',
          requestId: ulid(),
          code: 'INVALID_COMMAND',
          message: commandRequest.errors.map((error) => error.message).join('; ')
        })
        wsCommandCounter.inc({ actorType: identity.actorType, command: 'unknown', result: 'invalid' })
        return
      }

      const command = commandRequest.command
      const policy = commandPolicy(command.command)
      const actorType = toPolicyActorType(current.actorType)

      if (!policy.allowedActorTypes.includes(actorType)) {
        const abuseCount = recordAbuse(identity.actorType, identity.actorId)
        wsSecurityCounter.inc({ reason: 'forbidden_actor' })
        publishSecurityEvent(actorType, identity.actorId, `forbidden_actor:${abuseCount}`)
        if (abuseCount >= ABUSE_BAN_THRESHOLD) {
          ws.close(4403, 'abuse threshold exceeded')
          return
        }

        send(current.ws, {
          type: 'error',
          requestId: ulid(),
          code: 'FORBIDDEN',
          message: 'command not allowed for this actor type'
        })
        wsCommandCounter.inc({ actorType: identity.actorType, command: command.command, result: 'forbidden' })
        return
      }

      if (!policy.requiredCapabilities.every((requiredCapability) => current.capabilities.includes(requiredCapability))) {
        const abuseCount = recordAbuse(identity.actorType, identity.actorId)
        wsSecurityCounter.inc({ reason: 'forbidden_capability' })
        publishSecurityEvent(actorType, identity.actorId, `forbidden_capability:${abuseCount}`)
        if (abuseCount >= ABUSE_BAN_THRESHOLD) {
          ws.close(4403, 'abuse threshold exceeded')
          return
        }

        send(current.ws, {
          type: 'error',
          requestId: ulid(),
          code: 'FORBIDDEN',
          message: 'missing command capability'
        })
        wsCommandCounter.inc({ actorType: identity.actorType, command: command.command, result: 'forbidden' })
        return
      }

      if (policy.requiredRoles.length > 0) {
        const hasRequiredRole = policy.requiredRoles.some((requiredRole) => current.roles.includes(requiredRole))
        if (!hasRequiredRole) {
          const abuseCount = recordAbuse(identity.actorType, identity.actorId)
          wsSecurityCounter.inc({ reason: 'forbidden_role' })
          publishSecurityEvent(actorType, identity.actorId, `forbidden_role:${abuseCount}`)
          if (abuseCount >= ABUSE_BAN_THRESHOLD) {
            ws.close(4403, 'abuse threshold exceeded')
            return
          }

          send(current.ws, {
            type: 'error',
            requestId: ulid(),
            code: 'FORBIDDEN',
            message: 'missing required role'
          })
          wsCommandCounter.inc({ actorType: identity.actorType, command: command.command, result: 'forbidden' })
          return
        }

        if (policy.requiredRoles.includes(OPERATOR_ADMIN_ROLE) && OPERATOR_MFA_REQUIRED && !current.mfa) {
          send(current.ws, {
            type: 'error',
            requestId: ulid(),
            code: 'MFA_REQUIRED',
            message: 'mfa required for this command'
          })
          wsCommandCounter.inc({ actorType: identity.actorType, command: command.command, result: 'forbidden' })
          return
        }
      }

      const requestId = ulid()
      await bus.publish('hlp.commands', {
        type: 'operator.command',
        stream: 'hlp.commands',
        source: 'ws-gateway',
        correlationId: requestId,
        actorType,
        actorId: current.actorId,
        payload: {
          command: command.command,
          args: command.args.map((argument) => sanitizeText(argument, 64)),
          reason: command.reason,
          actor: {
            actorType,
            actorId: current.actorId,
            role: current.actorRole,
            requestedAt: new Date().toISOString()
          },
          actorRole: current.actorRole,
          capabilities: current.capabilities
        }
      })

      wsCommandCounter.inc({ actorType: identity.actorType, command: command.command, result: 'accepted' })
      const result = CommandResultSchema.parse({
        ok: true,
        command: command.command,
        message: 'command submitted',
        requestId
      })
      send(current.ws, { type: 'cmd.result', requestId, result })
    }
  })

  ws.on('close', () => {
    clients.delete(socketId)
    commandWindows.delete(socketId)
    wsConnections.dec()
  })
})

bus.consume('hlp.ui.events', '0-0', (envelope) => {
  const eventChannel: Channel = broadcastChannelForType(envelope.type)
  const payload = eventChannel === 'public'
    ? sanitizeForPublic(envelope.type, envelope.payload)
    : envelope.payload
  const event: { type: 'event'; channel: Channel; payload: unknown } = {
    type: 'event',
    channel: eventChannel,
    payload
  }

  for (const client of clients.values()) {
    const isPublicSub = client.channels.has('public')
    const shouldReceive = client.channels.has(event.channel) || (isPublicSub && event.channel === 'public')
    if (shouldReceive) {
      sendSafe(client.ws, event)
      wsEventCounter.inc({ channel: event.channel })
    }
  }
})

bus.consume('hlp.audit.events', '0-0', (envelope) => {
  const event: Extract<WsServerMessage, { type: 'event' }> = {
    type: 'event',
    channel: 'audit',
    payload: envelope
  }

  for (const client of clients.values()) {
    if (client.channels.has('audit')) {
      sendSafe(client.ws, event)
      wsEventCounter.inc({ channel: 'audit' })
    }
  }
})

server.listen(PORT, () => {
  console.log(`ws gateway listening on :${PORT}`)
})

setInterval(() => {
  for (const client of clients.values()) {
    sendSafe(client.ws, {
      type: 'event',
      channel: 'public',
      payload: {
        type: 'heartbeat',
        ts: new Date().toISOString()
      }
    })
  }
}, 10_000)

const shutdown = async () => {
  wsConnections.set(0)
  await stopTelemetry()
  server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
