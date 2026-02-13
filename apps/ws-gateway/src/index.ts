import http from 'node:http'
import { WebSocketServer } from 'ws'
import { ulid } from 'ulid'
import promClient from 'prom-client'
import {
  ActorType,
  Channel,
  OPERATOR_ADMIN_ROLE,
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
const REDIS_URL = process.env.REDIS_URL
const REDIS_STREAM_PREFIX = process.env.REDIS_STREAM_PREFIX ?? 'hlp'
const METRICS_PATH = '/metrics'

type WsActorType = 'public' | 'operator' | 'agent'

interface ClientInfo {
  socketId: string
  ws: any
  channels: Set<Channel>
  token?: string
  actorId: string
  actorType: WsActorType
  actorRole?: Role
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
const TOKEN_PATTERN = /^[a-zA-Z0-9._:-]{1,120}$/
const MAX_CHANNEL_LENGTH = 32

void initializeTelemetry('hlprivateer-ws-gateway')

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

const roleFromToken = (token?: string): { actorType: WsActorType; actorId: string; capabilities: string[]; actorRole?: Role } => {
  if (!token) {
    return { actorType: 'public', actorId: 'anonymous', capabilities: [] }
  }

  if (token.startsWith('operator:')) {
    const actorId = token.replace('operator:', '') || 'operator'
    return {
      actorType: 'operator',
      actorId,
      actorRole: OPERATOR_ADMIN_ROLE,
      capabilities: getCapabilitiesForToken('tier3')
    }
  }

  if (token.startsWith('agent:')) {
    const parts = token.split(':')
    const actorId = parts[1] || 'agent'
    const tier = parts[2]
    return { actorType: 'agent', actorId, capabilities: getCapabilitiesForToken(tier) }
  }

  return { actorType: 'public', actorId: 'anonymous', capabilities: [] }
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

function sanitizeForPublic(statePayload: unknown): Record<string, unknown> {
  if (!statePayload || typeof statePayload !== 'object') {
    return { eventType: 'state', ts: new Date().toISOString() }
  }

  const payload = statePayload as Record<string, unknown>
  return {
    eventType: 'STATE_UPDATE',
    mode: payload.mode,
    driftState: payload.driftState,
    healthCode: payload.healthCode,
    pnlPct: payload.pnlPct,
    lastUpdateAt: payload.lastUpdateAt,
    ts: new Date().toISOString()
  }
}

function broadcastChannelForType(type: string): Channel {
  if (type === 'STATE_UPDATE') {
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
  if (token && !isValidToken(token)) {
    wsSecurityCounter.inc({ reason: 'invalid_token' })
    ws.close(4401, 'invalid token')
    return
  }

  const identity = roleFromToken(token)
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
    ? sanitizeForPublic(envelope.payload)
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
