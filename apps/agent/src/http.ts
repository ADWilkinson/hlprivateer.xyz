import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { FloorSnapshot, PublicMarket } from './contracts'
import type { Accountant } from './accountant'
import type { Orchestrator, OutcomeMarketProvider } from './orchestrator'

export interface HttpServerConfig {
  port: number
  orchestrator: Orchestrator
  markets: OutcomeMarketProvider
  accountant: Accountant
  // Baseline equity for PnL%; if unset, /v1/public/floor returns null pnlPct.
  pnlBaselineUsd?: number
  // Bearer token required for /v1/operator/* routes. When unset, those
  // routes return 401 (fail-closed; never default-open).
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
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type'
    })
    res.end()
    return
  }

  if (pathname === '/healthz' && method === 'GET') {
    return send(res, 200, {
      ok: true,
      mode: cfg.orchestrator.mode(),
      metrics: cfg.orchestrator.metrics(),
      equityUsd: await cfg.accountant.equityUsd(),
      openMarkets: await cfg.accountant.openMarketCount()
    })
  }

  if (pathname === '/metrics' && method === 'GET') {
    return sendText(res, 200, renderPrometheus(cfg.orchestrator, await cfg.accountant.equityUsd()))
  }

  if (pathname === '/v1/public/markets' && method === 'GET') {
    const ms = await cfg.markets.list()
    return send(res, 200, { markets: ms.map((m) => publicView(m, cfg.orchestrator.pHat(m.id))) })
  }

  if (pathname === '/v1/public/floor' && method === 'GET') {
    const ms = await cfg.markets.list()
    const equity = await cfg.accountant.equityUsd()
    const snap: FloorSnapshot = {
      mode: cfg.orchestrator.mode(),
      pnlPct:
        cfg.pnlBaselineUsd && cfg.pnlBaselineUsd > 0
          ? (equity - cfg.pnlBaselineUsd) / cfg.pnlBaselineUsd
          : null,
      marketsTracked: ms.length,
      markets: ms.slice(0, 12).map((m) => publicView(m, cfg.orchestrator.pHat(m.id))),
      tape: [...cfg.orchestrator.tape().recent(50)]
    }
    return send(res, 200, snap)
  }

  if (pathname === '/v1/public/floor-tape' && method === 'GET') {
    return send(res, 200, { tape: [...cfg.orchestrator.tape().recent(50)] })
  }

  if (pathname === '/v1/operator/halt' && method === 'POST') {
    if (!authorizeOperator(req, cfg)) return send(res, 401, { error: 'unauthorized' })
    cfg.orchestrator.setMode('HALT')
    return send(res, 200, { ok: true, mode: cfg.orchestrator.mode() })
  }

  if (pathname === '/v1/operator/resume' && method === 'POST') {
    if (!authorizeOperator(req, cfg)) return send(res, 401, { error: 'unauthorized' })
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
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function renderPrometheus(orch: Orchestrator, equityUsd: number): string {
  const m = orch.metrics()
  return [
    '# HELP hlp_v3_runtime_mode 1 if agent is in READY mode.',
    '# TYPE hlp_v3_runtime_mode gauge',
    `hlp_v3_runtime_mode ${orch.mode() === 'READY' ? 1 : 0}`,
    '# HELP hlp_v3_equity_usd Account equity in USD from clearinghouseState.',
    '# TYPE hlp_v3_equity_usd gauge',
    `hlp_v3_equity_usd ${equityUsd}`,
    '# HELP hlp_v3_signals_ingested_total Sentiment items ingested.',
    '# TYPE hlp_v3_signals_ingested_total counter',
    `hlp_v3_signals_ingested_total ${m.signalsIngested}`,
    '# HELP hlp_v3_proposals_total Agent proposals proposed vs skipped.',
    '# TYPE hlp_v3_proposals_total counter',
    `hlp_v3_proposals_total{outcome="proposed"} ${m.proposalsProposed}`,
    `hlp_v3_proposals_total{outcome="skipped"} ${m.proposalsSkipped}`,
    '# HELP hlp_v3_decisions_total Risk decisions by outcome.',
    '# TYPE hlp_v3_decisions_total counter',
    `hlp_v3_decisions_total{decision="ALLOW"} ${m.decisionsAllow}`,
    `hlp_v3_decisions_total{decision="DENY"} ${m.decisionsDeny}`,
    '# HELP hlp_v3_fills_confirmed_total Confirmed fills.',
    '# TYPE hlp_v3_fills_confirmed_total counter',
    `hlp_v3_fills_confirmed_total ${m.fillsConfirmed}`,
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
