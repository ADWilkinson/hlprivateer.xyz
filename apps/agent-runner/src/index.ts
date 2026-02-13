import { ulid } from 'ulid'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import type { EventEnvelope, AuditEvent, OperatorPosition, StrategyProposal } from '@hl/privateer-contracts'
import { parseStrategyProposal } from '@hl/privateer-contracts'
import type { PluginSignal } from '@hl/privateer-plugin-sdk'
import { env } from './config'
import { runClaudeStructured, runCodexStructured } from './llm'

type Tick = {
  symbol: string
  px: number
  bid: number
  ask: number
  bidSize?: number
  askSize?: number
  updatedAt: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function computeTargetNotional(baseTargetNotional: number, signals: PluginSignal[]): number {
  const latestVolatility = [...signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestFunding = [...signals].reverse().find((signal) => signal.signalType === 'funding')

  let scale = 1
  if (latestVolatility) {
    const volatilityScale = 1 - Math.min(0.4, Math.abs(latestVolatility.value) / 25)
    scale *= Math.max(0.6, volatilityScale)
  }

  if (latestFunding) {
    scale *= latestFunding.value > 0 ? 0.95 : 1.05
  }

  return Number(Math.max(100, baseTargetNotional * scale).toFixed(2))
}

function buildDeltaProposal(params: {
  agentId: string
  basketSymbolsCsv: string
  targetNotionalUsd: number
  positions: OperatorPosition[]
  signals: PluginSignal[]
}): StrategyProposal | null {
  const basketSymbols = params.basketSymbolsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (basketSymbols.length === 0) {
    return null
  }

  const desiredBySymbol = new Map<string, number>()
  desiredBySymbol.set('HYPE', params.targetNotionalUsd)
  const perBasket = params.targetNotionalUsd / basketSymbols.length
  for (const symbol of basketSymbols) {
    desiredBySymbol.set(symbol, -perBasket)
  }

  const currentBySymbol = new Map<string, number>()
  for (const position of params.positions) {
    const signed = position.side === 'LONG' ? Math.abs(position.notionalUsd) : -Math.abs(position.notionalUsd)
    currentBySymbol.set(position.symbol, (currentBySymbol.get(position.symbol) ?? 0) + signed)
  }

  const minLegUsd = Math.max(25, params.targetNotionalUsd * 0.01)
  const legs = [...desiredBySymbol.entries()]
    .map(([symbol, desiredNotional]) => {
      const current = currentBySymbol.get(symbol) ?? 0
      const delta = desiredNotional - current
      if (!Number.isFinite(delta) || Math.abs(delta) < minLegUsd) {
        return null
      }

      return {
        symbol,
        side: delta > 0 ? ('BUY' as const) : ('SELL' as const),
        notionalUsd: Number(Math.abs(delta).toFixed(2))
      }
    })
    .filter((leg): leg is { symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number } => Boolean(leg))

  if (legs.length === 0) {
    return null
  }

  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestCorrelation = [...params.signals].reverse().find((signal) => signal.signalType === 'correlation')
  const latestFunding = [...params.signals].reverse().find((signal) => signal.signalType === 'funding')
  const signalSummary = [
    latestVolatility ? `vol=${latestVolatility.value.toFixed(3)}` : 'vol=na',
    latestCorrelation ? `corr=${latestCorrelation.value.toFixed(3)}` : 'corr=na',
    latestFunding ? `funding=${latestFunding.value.toFixed(6)}` : 'funding=na'
  ].join(' ')

  const actionNotionalUsd = legs.reduce((sum, leg) => sum + leg.notionalUsd, 0)
  const proposalId = ulid()
  return {
    proposalId,
    cycleId: ulid(),
    summary: `agent delta-to-target (${signalSummary})`,
    confidence: 0.65,
    requestedMode: 'SIM',
    createdBy: params.agentId,
    actions: [
      {
        type: params.positions.length > 0 ? 'REBALANCE' : 'ENTER',
        rationale: 'agent-driven rebalance to target exposure (HYPE vs basket)',
        notionalUsd: Number(actionNotionalUsd.toFixed(2)),
        expectedSlippageBps: 3,
        legs
      }
    ]
  }
}

async function generateAnalysis(params: {
  llm: 'claude' | 'codex' | 'none'
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; thesis: string; risks: string[]; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      thesis: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      confidence: { type: 'number' }
    },
    required: ['headline', 'thesis', 'risks', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Delta-to-target rebalance',
      thesis: 'Maintain market-neutral HYPE vs basket exposure by rebalancing notionals to the target.',
      risks: ['Funding regime shift', 'Liquidity slippage during volatility', 'Model-free signal blindness'],
      confidence: 0.4
    }
  }

  const prompt = [
    'You are HL Privateer, a concise trading-floor analyst for a HYPE-vs-basket market-neutral strategy.',
    'Given the JSON context below, write a short analysis for the next rebalance.',
    'Return only JSON that matches the provided schema.',
    '',
    `CONTEXT_JSON=${JSON.stringify(params.input)}`
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })

  const confidence = clamp(Number(raw.confidence), 0, 1)
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'HL Privateer Analysis',
    thesis: String(raw.thesis ?? '').slice(0, 1200),
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence
  }
}

const bus = env.REDIS_URL
  ? new RedisEventBus(env.REDIS_URL, env.REDIS_STREAM_PREFIX, 'agent-runner')
  : new InMemoryEventBus()

const latestTicks = new Map<string, Tick>()
const latestSignals = new Map<string, PluginSignal>()
let lastPositions: OperatorPosition[] = []
let lastMode: string = 'INIT'
let lastProposalAt = 0
let lastAnalysisAt = 0

async function publishAudit(event: AuditEvent): Promise<void> {
  await bus.publish('hlp.audit.events', {
    type: 'AGENT_ANALYSIS',
    stream: 'hlp.audit.events',
    source: 'agent-runner',
    correlationId: event.correlationId,
    actorType: event.actorType,
    actorId: event.actorId,
    payload: event
  })
}

async function publishProposal(proposal: StrategyProposal): Promise<void> {
  await bus.publish('hlp.strategy.proposals', {
    type: 'STRATEGY_PROPOSAL',
    stream: 'hlp.strategy.proposals',
    source: 'agent-runner',
    correlationId: proposal.proposalId,
    actorType: 'internal_agent',
    actorId: env.AGENT_ID,
    payload: proposal
  })
}

async function runOnce(): Promise<void> {
  const now = Date.now()
  if (now - lastProposalAt < env.AGENT_PROPOSAL_INTERVAL_MS) {
    return
  }
  lastProposalAt = now

  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const targetNotionalUsd = computeTargetNotional(env.BASKET_TARGET_NOTIONAL_USD, signals)

  const proposal = buildDeltaProposal({
    agentId: env.AGENT_ID,
    basketSymbolsCsv: env.BASKET_SYMBOLS,
    targetNotionalUsd,
    positions: lastPositions,
    signals
  })
  if (!proposal) {
    return
  }

  const parsed = parseStrategyProposal(proposal)
  if (!parsed.ok) {
    const audit: AuditEvent = {
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: env.AGENT_ID,
      action: 'agent.proposal.invalid',
      resource: 'agent.proposal',
      correlationId: ulid(),
      details: { errors: parsed.errors }
    }
    await publishAudit(audit)
    return
  }

  await publishProposal(parsed.proposal)

  if (now - lastAnalysisAt < env.AGENT_ANALYSIS_INTERVAL_MS) {
    return
  }
  lastAnalysisAt = now

  const universe = new Set<string>(['HYPE', ...env.BASKET_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean)])
  const tickSnapshot = [...universe].map((symbol) => latestTicks.get(symbol)).filter(Boolean)
  const analysisInput = {
    ts: new Date().toISOString(),
    mode: lastMode,
    targetNotionalUsd,
    basketSymbols: env.BASKET_SYMBOLS,
    signals,
    ticks: tickSnapshot,
    positions: lastPositions,
    proposal: parsed.proposal
  }

  const llm = env.AGENT_LLM
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL
  const analysis = await generateAnalysis({
    llm,
    model,
    input: analysisInput
  })

  const audit: AuditEvent = {
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: env.AGENT_ID,
    action: 'analysis.report',
    resource: 'agent.analysis',
    correlationId: parsed.proposal.proposalId,
    details: {
      ...analysis,
      input: analysisInput
    }
  }
  await publishAudit(audit)
}

const start = async (): Promise<void> => {
  await bus.consume('hlp.market.normalized', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type !== 'MARKET_TICK') {
      return
    }
    const payload = envelope.payload as any
    if (!payload?.symbol) return
    const symbol = String(payload.symbol)
    const px = Number(payload.px)
    const bid = Number(payload.bid)
    const ask = Number(payload.ask)
    if (!Number.isFinite(px) || !Number.isFinite(bid) || !Number.isFinite(ask)) return

    latestTicks.set(symbol, {
      symbol,
      px,
      bid,
      ask,
      bidSize: typeof payload.bidSize === 'number' ? payload.bidSize : undefined,
      askSize: typeof payload.askSize === 'number' ? payload.askSize : undefined,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString()
    })
  })

  await bus.consume('hlp.plugin.signals', '$', (envelope: EventEnvelope<any>) => {
    const payload = envelope.payload as any
    if (!payload?.signalType || !payload?.pluginId) {
      return
    }
    const signal = payload as PluginSignal
    latestSignals.set(`${signal.signalType}:${signal.pluginId}`, signal)
  })

  await bus.consume('hlp.ui.events', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type === 'STATE_UPDATE') {
      const payload = envelope.payload as any
      if (payload?.mode) {
        lastMode = String(payload.mode)
      }
    }
    if (envelope.type === 'POSITION_UPDATE') {
      const payload = envelope.payload as any
      if (Array.isArray(payload)) {
        lastPositions = payload as OperatorPosition[]
      }
    }
  })

  let tickRunning = false
  setInterval(() => {
    if (tickRunning) {
      return
    }

    tickRunning = true
    void runOnce()
      .catch((error) => {
        // Keep the runner alive; report via audit stream.
        void publishAudit({
          id: ulid(),
          ts: new Date().toISOString(),
          actorType: 'internal_agent',
          actorId: env.AGENT_ID,
          action: 'agent.error',
          resource: 'agent.runner',
          correlationId: ulid(),
          details: { message: String(error) }
        })
      })
      .finally(() => {
        tickRunning = false
      })
  }, 1000)

  console.log(`agent-runner started agentId=${env.AGENT_ID} llm=${env.AGENT_LLM}`)
}

void start().catch((error) => {
  console.error(error)
  process.exit(1)
})
