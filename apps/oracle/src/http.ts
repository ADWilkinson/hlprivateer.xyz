import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ulid } from 'ulid'
import type { EventBus } from '@hl/privateer-event-bus'
import type { FloorSnapshot, PublicMarket } from '@hl/privateer-contracts'
import type { OrchestratorHandle } from './orchestrator'
import type { OutcomeMarketProvider } from './markets'

export interface HttpServerConfig {
  port: number
  orchestrator: OrchestratorHandle
  markets: OutcomeMarketProvider
  bus: EventBus
  estimates: Map<string, { pHat: number; edge: number }>
  // Bearer token required for /v1/operator/* routes. When unset, those routes
  // return 401 (fail-closed; never default-open).
  operatorToken?: string
}

export function startHttpServer(cfg: HttpServerConfig): Server {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, cfg)
    } catch (err) {
      send(res, 500, { error: String(err) })
    }
  })
  server.listen(cfg.port)
  return server
}

async function route(req: IncomingMessage, res: ServerResponse, cfg: HttpServerConfig): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const url = req.url ?? '/'

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type'
    })
    res.end()
    return
  }

  if (url === '/healthz') {
    return send(res, 200, {
      ok: true,
      mode: cfg.orchestrator.mode(),
      metrics: cfg.orchestrator.metrics()
    })
  }

  if (url === '/metrics') {
    return sendText(res, 200, renderPrometheus(cfg.orchestrator))
  }

  if (url === '/v1/public/markets' && method === 'GET') {
    const ms = await cfg.markets.list()
    return send(res, 200, { markets: ms.map((m) => publicView(m, cfg.estimates.get(m.id))) })
  }

  if (url === '/v1/public/floor' && method === 'GET') {
    const ms = await cfg.markets.list()
    const snap: FloorSnapshot = {
      mode: cfg.orchestrator.mode(),
      pnlPct: null,
      marketsTracked: ms.length,
      markets: ms.slice(0, 12).map((m) => publicView(m, cfg.estimates.get(m.id))),
      tape: [...cfg.orchestrator.tape()].slice(-50)
    }
    return send(res, 200, snap)
  }

  if (url === '/v1/public/floor-tape' && method === 'GET') {
    return send(res, 200, { tape: [...cfg.orchestrator.tape()].slice(-50) })
  }

  if (url === '/v1/operator/halt' && method === 'POST') {
    if (!authorizeOperator(req, cfg)) return send(res, 401, { error: 'unauthorized' })
    await emitCommand(cfg.bus, 'halt')
    cfg.orchestrator.setMode('HALT')
    return send(res, 200, { ok: true, mode: cfg.orchestrator.mode() })
  }

  if (url === '/v1/operator/resume' && method === 'POST') {
    if (!authorizeOperator(req, cfg)) return send(res, 401, { error: 'unauthorized' })
    await emitCommand(cfg.bus, 'resume')
    cfg.orchestrator.setMode('READY')
    return send(res, 200, { ok: true, mode: cfg.orchestrator.mode() })
  }

  send(res, 404, { error: 'not found' })
}

function publicView(
  m: { id: string; question: string; status: PublicMarket['status']; yesPrice: number; resolutionAt: string; topicTags: string[] },
  est: { pHat: number; edge: number } | undefined
): PublicMarket {
  return {
    id: m.id,
    question: m.question,
    status: m.status,
    yesPrice: m.yesPrice,
    pHat: est?.pHat,
    edge: est?.edge,
    resolutionAt: m.resolutionAt,
    topicTags: m.topicTags
  }
}

function authorizeOperator(req: IncomingMessage, cfg: HttpServerConfig): boolean {
  if (!cfg.operatorToken) return false
  const header = req.headers['authorization']
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  return constantTimeEq(header.slice('Bearer '.length).trim(), cfg.operatorToken)
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function emitCommand(bus: EventBus, command: 'halt' | 'resume'): Promise<void> {
  await bus.publish('hlpv2.commands', {
    type: `command.${command}`,
    stream: 'hlpv2.commands',
    source: 'oracle.http',
    correlationId: ulid(),
    actorType: 'human',
    actorId: 'operator',
    payload: { command }
  })
}

function renderPrometheus(orch: OrchestratorHandle): string {
  const m = orch.metrics()
  return [
    '# HELP hlpv2_runtime_mode 1 if oracle is in READY mode.',
    '# TYPE hlpv2_runtime_mode gauge',
    `hlpv2_runtime_mode ${orch.mode() === 'READY' ? 1 : 0}`,
    '# HELP hlpv2_signals_ingested_total Sentiment signals ingested.',
    '# TYPE hlpv2_signals_ingested_total counter',
    `hlpv2_signals_ingested_total ${m.signalsIngested}`,
    '# HELP hlpv2_estimates_emitted_total Probability estimates emitted by SNT.',
    '# TYPE hlpv2_estimates_emitted_total counter',
    `hlpv2_estimates_emitted_total ${m.estimatesEmitted}`,
    '# HELP hlpv2_proposals_emitted_total Outcome proposals emitted by EXE.',
    '# TYPE hlpv2_proposals_emitted_total counter',
    `hlpv2_proposals_emitted_total ${m.proposalsEmitted}`,
    '# HELP hlpv2_decisions_total Risk decisions by outcome.',
    '# TYPE hlpv2_decisions_total counter',
    `hlpv2_decisions_total{decision="ALLOW"} ${m.decisionsAllow}`,
    `hlpv2_decisions_total{decision="DENY"} ${m.decisionsDeny}`,
    '# HELP hlpv2_fills_confirmed_total Confirmed fills.',
    '# TYPE hlpv2_fills_confirmed_total counter',
    `hlpv2_fills_confirmed_total ${m.fillsConfirmed}`,
    ''
  ].join('\n')
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; version=0.0.4',
    'access-control-allow-origin': '*'
  })
  res.end(body)
}
