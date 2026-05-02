import { ulid } from 'ulid'
import type { EventBus } from '@hl/privateer-event-bus'
import type {
  EventEnvelope,
  FloorTapeLine,
  OutcomeProposal,
  ProbabilityEstimate,
  RiskConfig,
  RiskDecision,
  RuntimeMode,
  SentimentSignal,
  SentimentSource,
  StrategyConfig
} from '@hl/privateer-contracts'
import { aggregateSentiment, estimateProbability, proposeOrder } from '@hl/privateer-outcome-engine'
import { evaluate as evaluateRisk } from '@hl/privateer-outcome-risk'
import { AuditChain } from './audit'
import { ExposureLedger } from './exposure'
import type { OrderRouter } from './order-router'
import type { OutcomeMarketProvider } from './markets'

export interface EngineOpts {
  halfLifeSec?: number
  evidenceWeight?: number
  sourceTrust?: Partial<Record<SentimentSource, number>>
}

export interface OrchestratorConfig {
  bus: EventBus
  markets: OutcomeMarketProvider
  router: OrderRouter
  riskConfig: RiskConfig
  engine?: EngineOpts
  marketFilter?: StrategyConfig['marketFilter']
  signalBufferSize?: number
  log?: (msg: string, meta?: unknown) => void
}

export interface OrchestratorMetrics {
  estimatesEmitted: number
  proposalsEmitted: number
  decisionsAllow: number
  decisionsDeny: number
  fillsConfirmed: number
  signalsIngested: number
}

export interface OrchestratorHandle {
  evaluateMarket(marketId: string): Promise<{
    estimate?: ProbabilityEstimate
    proposal?: OutcomeProposal
    decision?: RiskDecision
  }>
  start(): Promise<() => Promise<void>>
  mode(): RuntimeMode
  setMode(m: RuntimeMode): void
  tape(): readonly FloorTapeLine[]
  metrics(): OrchestratorMetrics
}

export function createOrchestrator(config: OrchestratorConfig): OrchestratorHandle {
  const log = config.log ?? (() => undefined)
  const audit = new AuditChain(config.bus, 'oracle')
  const ledger = new ExposureLedger()
  const signalsByMarket = new Map<string, SentimentSignal[]>()
  const tape: FloorTapeLine[] = []
  const bufferSize = config.signalBufferSize ?? 20
  let mode: RuntimeMode = 'INIT'

  // Per-market mutex: serialize evaluateMarket so two near-simultaneous signals
  // for the same market can't race past the ExposureLedger and over-fill.
  const inflight = new Map<string, Promise<unknown>>()

  const metrics: OrchestratorMetrics = {
    estimatesEmitted: 0,
    proposalsEmitted: 0,
    decisionsAllow: 0,
    decisionsDeny: 0,
    fillsConfirmed: 0,
    signalsIngested: 0
  }

  function pushTape(role: FloorTapeLine['role'], message: string): void {
    const line: FloorTapeLine = { ts: new Date().toISOString(), role, message }
    tape.push(line)
    if (tape.length > 200) tape.shift()
    void config.bus.publish<FloorTapeLine>('hlpv2.ui', {
      type: 'ui.tape',
      stream: 'hlpv2.ui',
      source: 'oracle',
      correlationId: ulid(),
      actorType: 'internal_agent',
      actorId: role,
      payload: line
    })
  }

  function ingestSignal(env: EventEnvelope<SentimentSignal>): void {
    const sig = env.payload
    metrics.signalsIngested++
    const arr = signalsByMarket.get(sig.marketId) ?? []
    arr.push(sig)
    arr.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    if (arr.length > bufferSize) arr.length = bufferSize
    signalsByMarket.set(sig.marketId, arr)
  }

  async function evaluateMarket(marketId: string): ReturnType<OrchestratorHandle['evaluateMarket']> {
    const prev = inflight.get(marketId)
    const next = (prev ? prev.catch(() => undefined) : Promise.resolve()).then(() =>
      doEvaluateMarket(marketId)
    )
    inflight.set(marketId, next)
    try {
      return await next
    } finally {
      if (inflight.get(marketId) === next) inflight.delete(marketId)
    }
  }

  async function doEvaluateMarket(marketId: string): ReturnType<OrchestratorHandle['evaluateMarket']> {
    if (mode !== 'READY') return {}
    const market = await config.markets.get(marketId)
    if (!market) return {}
    if (!passesMarketFilter(market.topicTags, config.marketFilter)) return {}
    ledger.recordMarket(market)
    const signals = signalsByMarket.get(marketId) ?? []
    if (signals.length === 0) return {}

    const agg = aggregateSentiment(signals, {
      halfLifeSec: config.engine?.halfLifeSec,
      sourceTrust: config.engine?.sourceTrust
    })
    const est = estimateProbability({
      marketYesPrice: market.yesPrice,
      sentiment: agg,
      evidenceWeight: config.engine?.evidenceWeight
    })
    const estimate: ProbabilityEstimate = {
      id: `e-${ulid()}`,
      marketId,
      pHat: est.pHat,
      marketYesPrice: market.yesPrice,
      edge: est.edge,
      confidence: est.confidence,
      basisSignalIds: est.basisSignalIds,
      rationale: est.rationale,
      ts: new Date().toISOString()
    }
    pushTape('SNT', `${marketId}: pHat=${pct(est.pHat)} (mkt ${pct(market.yesPrice)}) edge ${pp(est.edge)}`)
    metrics.estimatesEmitted++
    await config.bus.publish<ProbabilityEstimate>('hlpv2.estimates', {
      type: 'estimate.emitted',
      stream: 'hlpv2.estimates',
      source: 'oracle',
      correlationId: estimate.id,
      actorType: 'internal_agent',
      actorId: 'SNT',
      payload: estimate
    })
    await audit.append({ type: 'estimate.emitted', correlationId: estimate.id, payload: estimate })

    const proposal = proposeOrder({
      market,
      estimate,
      riskConfig: config.riskConfig,
      openExposureUsd: ledger.openExposureUsd()
    })
    if (!proposal) {
      pushTape('EXE', `${marketId}: no proposal (edge or sizing below threshold)`)
      return { estimate }
    }
    metrics.proposalsEmitted++
    await config.bus.publish<OutcomeProposal>('hlpv2.proposals', {
      type: 'proposal.emitted',
      stream: 'hlpv2.proposals',
      source: 'oracle',
      correlationId: proposal.id,
      actorType: 'internal_agent',
      actorId: 'EXE',
      payload: proposal
    })
    await audit.append({ type: 'proposal.emitted', correlationId: proposal.id, payload: proposal })

    const decision = evaluateRisk({
      proposal,
      estimate,
      market,
      config: config.riskConfig,
      recentSignals: signals,
      openExposureUsd: ledger.openExposureUsd(),
      openMarketCount: ledger.openMarketCount(),
      clusterExposureUsd: ledger.clusterExposureUsd(market)
    })
    await config.bus.publish<RiskDecision>('hlpv2.decisions', {
      type: decision.decision === 'ALLOW' ? 'risk.allow' : 'risk.deny',
      stream: 'hlpv2.decisions',
      source: 'oracle',
      correlationId: proposal.id,
      actorType: 'internal_agent',
      actorId: 'RSK',
      payload: decision
    })
    await audit.append({ type: 'risk.decision', correlationId: proposal.id, payload: decision })

    if (decision.decision === 'DENY') {
      metrics.decisionsDeny++
      pushTape('RSK', `${marketId}: DENY ${decision.failures.map((f) => f.code).join(',')}`)
      return { estimate, proposal, decision }
    }

    metrics.decisionsAllow++
    pushTape('RSK', `${marketId}: ALLOW $${proposal.sizeUsd.toFixed(0)} ${proposal.side}@${proposal.limitPrice.toFixed(3)}`)
    try {
      const fill = await config.router.place(proposal)
      ledger.applyFill(fill)
      metrics.fillsConfirmed++
      await config.bus.publish('hlpv2.fills', {
        type: 'fill.confirmed',
        stream: 'hlpv2.fills',
        source: 'oracle',
        correlationId: proposal.id,
        actorType: 'internal_agent',
        actorId: 'EXE',
        payload: fill
      })
      await audit.append({ type: 'fill.confirmed', correlationId: proposal.id, payload: fill })
      pushTape('EXE', `${marketId}: filled $${fill.fillSizeUsd.toFixed(0)} @${fill.fillPrice.toFixed(3)}`)
    } catch (err) {
      pushTape('EXE', `${marketId}: order placement failed: ${String(err)}`)
      log('order placement error', err)
    }
    return { estimate, proposal, decision }
  }

  async function start(): Promise<() => Promise<void>> {
    mode = 'READY'
    pushTape('OPS', 'oracle online')

    const stopSentiment = await config.bus.consume('hlpv2.sentiment', '$', async (env) => {
      ingestSignal(env as EventEnvelope<SentimentSignal>)
      await evaluateMarket((env.payload as SentimentSignal).marketId)
    })
    const stopCommands = await config.bus.consume('hlpv2.commands', '$', async (env) => {
      const cmd = (env.payload as { command?: string }).command
      if (cmd === 'halt') mode = 'HALT'
      if (cmd === 'resume') mode = 'READY'
      pushTape('OPS', `command: ${cmd ?? 'unknown'} → mode=${mode}`)
    })

    return async () => {
      mode = 'HALT'
      await stopSentiment()
      await stopCommands()
    }
  }

  return {
    evaluateMarket,
    start,
    mode: () => mode,
    setMode: (m) => { mode = m },
    tape: () => tape,
    metrics: () => ({ ...metrics })
  }
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const pp = (x: number): string => `${(x * 100).toFixed(2)}pp`

function passesMarketFilter(
  tags: readonly string[],
  filter: StrategyConfig['marketFilter'] | undefined
): boolean {
  if (!filter) return true
  if (filter.topicTagBlocklist?.some((t) => tags.includes(t))) return false
  if (filter.topicTagAllowlist && filter.topicTagAllowlist.length > 0) {
    return filter.topicTagAllowlist.some((t) => tags.includes(t))
  }
  return true
}
