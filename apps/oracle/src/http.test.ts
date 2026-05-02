import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '@hl/privateer-event-bus'
import type { OutcomeMarket, RiskConfig } from '@hl/privateer-contracts'
import { createOrchestrator } from './orchestrator'
import { InMemoryMarketProvider } from './markets'
import { DryRunRouter } from './order-router'
import { startHttpServer } from './http'

const market: OutcomeMarket = {
  id: 'mkt-1',
  question: 'Will X happen?',
  resolutionAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  challengeWindowSec: 0,
  status: 'trading',
  yesPrice: 0.4,
  bookDepthYesUsd: 5000,
  bookDepthNoUsd: 5000,
  topicTags: ['macro'],
  updatedAt: new Date().toISOString()
}

const riskConfig: RiskConfig = {
  maxSentimentAgeSec: 900,
  minSecondsToResolution: 3600,
  maxSecondsToResolution: 60 * 24 * 3600,
  challengeWindowBufferSec: 0,
  bankrollUsd: 10_000,
  maxStakePerMarketUsd: 500,
  maxConcurrentMarkets: 10,
  maxGrossExposureUsd: 2000,
  maxCorrelatedClusterUsd: 1500,
  minEdgeBps: 200,
  minBookDepthUsd: 500,
  kellyCap: 0.25,
  haltAll: false
}

interface Setup {
  baseUrl: string
  close: () => void
  bus: InMemoryEventBus
  orch: ReturnType<typeof createOrchestrator>
}

async function setup(operatorToken?: string): Promise<Setup> {
  const bus = new InMemoryEventBus()
  const markets = new InMemoryMarketProvider([market])
  const orch = createOrchestrator({
    bus,
    markets,
    router: new DryRunRouter(),
    riskConfig
  })
  await orch.start()
  const server = startHttpServer({
    port: 0,
    orchestrator: orch,
    markets,
    bus,
    estimates: new Map(),
    operatorToken
  })
  // node:http listen(0) picks a free port; address() returns it.
  await new Promise<void>((res) => server.once('listening', () => res()))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('unexpected address')
  return { baseUrl: `http://127.0.0.1:${addr.port}`, close: () => server.close(), bus, orch }
}

let s: Setup

beforeEach(async () => {
  s = await setup()
})
afterEach(() => s.close())

describe('http server', () => {
  it('GET /healthz reports mode + metrics', async () => {
    const res = await fetch(`${s.baseUrl}/healthz`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; mode: string; metrics: { signalsIngested: number } }
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('READY')
    expect(body.metrics.signalsIngested).toBe(0)
  })

  it('GET /metrics returns Prometheus text format', async () => {
    const res = await fetch(`${s.baseUrl}/metrics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    const body = await res.text()
    expect(body).toContain('hlpv2_runtime_mode 1')
    expect(body).toContain('hlpv2_decisions_total{decision="ALLOW"}')
  })

  it('GET /v1/public/markets returns the market list', async () => {
    const res = await fetch(`${s.baseUrl}/v1/public/markets`)
    const body = (await res.json()) as { markets: Array<{ id: string }> }
    expect(body.markets).toHaveLength(1)
    expect(body.markets[0].id).toBe('mkt-1')
  })

  it('GET /v1/public/floor includes mode + tape', async () => {
    const res = await fetch(`${s.baseUrl}/v1/public/floor`)
    const body = (await res.json()) as { mode: string; markets: unknown[]; tape: unknown[] }
    expect(body.mode).toBe('READY')
    expect(Array.isArray(body.markets)).toBe(true)
    expect(Array.isArray(body.tape)).toBe(true)
  })

  it('POST /v1/operator/halt returns 401 when token unset (fail-closed)', async () => {
    const res = await fetch(`${s.baseUrl}/v1/operator/halt`, {
      method: 'POST',
      headers: { authorization: 'Bearer something' }
    })
    expect(res.status).toBe(401)
  })

  it('GET /unknown returns 404', async () => {
    const res = await fetch(`${s.baseUrl}/nope`)
    expect(res.status).toBe(404)
  })
})

describe('http operator (token configured)', () => {
  let s2: Setup

  beforeEach(async () => {
    s2 = await setup('secret-123')
  })
  afterEach(() => s2.close())

  it('POST /v1/operator/halt with bad token → 401', async () => {
    const res = await fetch(`${s2.baseUrl}/v1/operator/halt`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' }
    })
    expect(res.status).toBe(401)
  })

  it('POST /v1/operator/halt with good token flips mode', async () => {
    const res = await fetch(`${s2.baseUrl}/v1/operator/halt`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret-123' }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string }
    expect(body.mode).toBe('HALT')
    expect(s2.orch.mode()).toBe('HALT')
  })

  it('POST /v1/operator/resume flips mode back', async () => {
    s2.orch.setMode('HALT')
    const res = await fetch(`${s2.baseUrl}/v1/operator/resume`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret-123' }
    })
    expect(res.status).toBe(200)
    expect(s2.orch.mode()).toBe('READY')
  })
})
