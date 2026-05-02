import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { FloorSnapshot, PublicMarket } from '@hl/privateer-contracts'
import type { OrchestratorHandle } from './orchestrator'
import type { OutcomeMarketProvider } from './markets'

/**
 * Tiny built-in HTTP server. v1 used Fastify; v2's surface is small enough
 * (4 routes) that the std-lib server is fine and one less dependency.
 */
export interface HttpServerConfig {
  port: number
  orchestrator: OrchestratorHandle
  markets: OutcomeMarketProvider
  /** Map marketId → most recent estimate (pHat, edge). */
  estimates: Map<string, { pHat: number; edge: number }>
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
  const url = req.url ?? '/'

  if (url === '/healthz') return send(res, 200, { ok: true, mode: cfg.orchestrator.mode() })

  if (url === '/v1/public/markets') {
    const ms = await cfg.markets.list()
    const out: PublicMarket[] = ms.map((m) => {
      const est = cfg.estimates.get(m.id)
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
    })
    return send(res, 200, { markets: out })
  }

  if (url === '/v1/public/floor') {
    const ms = await cfg.markets.list()
    const snap: FloorSnapshot = {
      mode: cfg.orchestrator.mode(),
      pnlPct: null,
      marketsTracked: ms.length,
      markets: ms.slice(0, 12).map((m) => {
        const est = cfg.estimates.get(m.id)
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
      }),
      tape: [...cfg.orchestrator.tape()].slice(-50)
    }
    return send(res, 200, snap)
  }

  if (url === '/v1/public/floor-tape') {
    return send(res, 200, { tape: [...cfg.orchestrator.tape()].slice(-50) })
  }

  send(res, 404, { error: 'not found' })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  })
  res.end(JSON.stringify(body))
}
