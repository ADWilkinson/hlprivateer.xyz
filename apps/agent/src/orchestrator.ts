import { ulid } from 'ulid'
import type {
  OutcomeFill,
  OutcomeMarket,
  OutcomeProposal,
  RiskConfig,
  RiskDecision,
  SentimentItem,
  StrategyConfig
} from './contracts'
import { OutcomeProposalSchema } from './contracts'
import { clipSize, edgeBps as edgeBpsOf } from './math'
import { evaluate as evaluateRisk } from './risk'
import type { StrategyAgent } from './strategy'
import type { Accountant } from './accountant'
import type { Tape } from './tape'
import { createTape } from './tape'
import { InMemoryAuditLog, type AuditLog } from './audit'

export interface OutcomeMarketProvider {
  list(): Promise<OutcomeMarket[]>
  get(id: string): Promise<OutcomeMarket | undefined>
}

export interface OrderRouter {
  place(proposal: OutcomeProposal): Promise<OutcomeFill>
}

export interface OrchestratorConfig {
  agent: StrategyAgent
  markets: OutcomeMarketProvider
  router: OrderRouter
  accountant: Accountant
  riskConfig: RiskConfig
  marketFilter?: StrategyConfig['marketFilter']
  audit?: AuditLog | InMemoryAuditLog
  tape?: Tape
  signalBufferSize?: number
  log?: (msg: string, meta?: unknown) => void
}

export interface OrchestratorMetrics {
  proposalsProposed: number
  proposalsSkipped: number
  decisionsAllow: number
  decisionsDeny: number
  fillsConfirmed: number
  signalsIngested: number
}

export interface EvaluateResult {
  proposal?: OutcomeProposal
  decision?: RiskDecision
  fill?: OutcomeFill
}

export interface Orchestrator {
  ingest(item: SentimentItem): Promise<EvaluateResult>
  evaluateMarket(marketId: string): Promise<EvaluateResult>
  mode(): 'INIT' | 'READY' | 'HALT'
  setMode(m: 'INIT' | 'READY' | 'HALT'): void
  tape(): Tape
  metrics(): OrchestratorMetrics
  pHat(marketId: string): { pHat: number; edge: number } | undefined
  start(): Promise<() => Promise<void>>
}

export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  const log = config.log ?? (() => undefined)
  const audit = config.audit ?? new InMemoryAuditLog()
  const tape = config.tape ?? createTape()
  const bufferSize = config.signalBufferSize ?? 30
  const signalsByMarket = new Map<string, SentimentItem[]>()
  const lastEstimateByMarket = new Map<string, { pHat: number; edge: number }>()
  const inflight = new Map<string, Promise<EvaluateResult>>()
  let mode: 'INIT' | 'READY' | 'HALT' = 'INIT'

  const metrics: OrchestratorMetrics = {
    proposalsProposed: 0,
    proposalsSkipped: 0,
    decisionsAllow: 0,
    decisionsDeny: 0,
    fillsConfirmed: 0,
    signalsIngested: 0
  }

  function bufferFor(marketId: string): SentimentItem[] {
    return signalsByMarket.get(marketId) ?? []
  }

  function record(item: SentimentItem): void {
    metrics.signalsIngested++
    const arr = bufferFor(item.marketId).slice()
    arr.push(item)
    arr.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
    if (arr.length > bufferSize) arr.length = bufferSize
    signalsByMarket.set(item.marketId, arr)
  }

  async function ingest(item: SentimentItem): Promise<EvaluateResult> {
    record(item)
    return evaluateMarket(item.marketId)
  }

  // Per-market mutex: serialize evaluateMarket so two near-simultaneous
  // signals can't race past the Accountant's exposure view and over-fill.
  async function evaluateMarket(marketId: string): Promise<EvaluateResult> {
    const prev = inflight.get(marketId)
    const next = (prev ? prev.catch(() => undefined) : Promise.resolve()).then(() =>
      doEvaluate(marketId)
    )
    inflight.set(marketId, next)
    try {
      return await next
    } finally {
      if (inflight.get(marketId) === next) inflight.delete(marketId)
    }
  }

  async function doEvaluate(marketId: string): Promise<EvaluateResult> {
    if (mode !== 'READY') return {}
    const market = await config.markets.get(marketId)
    if (!market) return {}
    if (!passesMarketFilter(market.topicTags, config.marketFilter)) return {}
    config.accountant.recordMarket(market)

    const signals = bufferFor(marketId)
    const exposureUsd = await config.accountant.openExposureUsd()
    const openMarketCount = await config.accountant.openMarketCount()
    const clusterExposureUsd = await config.accountant.clusterExposureUsd(market)

    const agentProposal = await config.agent.propose({
      market,
      signals,
      exposureUsd,
      openMarketCount,
      clusterExposureUsd,
      riskConfig: config.riskConfig
    })

    if (!agentProposal) {
      metrics.proposalsSkipped++
      tape.push('AGT', `${marketId}: skip (agent declined)`)
      return {}
    }

    const yesEdgeBps = edgeBpsOf({
      pHat: agentProposal.pHat,
      marketYesPrice: market.yesPrice,
      side: agentProposal.side
    })
    lastEstimateByMarket.set(marketId, {
      pHat: agentProposal.pHat,
      edge: agentProposal.pHat - market.yesPrice
    })
    const remainingExposure = config.riskConfig.maxGrossExposureUsd - exposureUsd
    const { sizeUsd, kellyFraction } = clipSize({
      agentSizeUsd: agentProposal.sizeUsd,
      pHat: agentProposal.pHat,
      marketYesPrice: market.yesPrice,
      side: agentProposal.side,
      bankrollUsd: config.riskConfig.bankrollUsd,
      kellyCap: config.riskConfig.kellyCap,
      maxStakePerMarketUsd: config.riskConfig.maxStakePerMarketUsd,
      remainingExposureUsd: remainingExposure
    })

    if (sizeUsd <= 0) {
      metrics.proposalsSkipped++
      tape.push('AGT', `${marketId}: skip (size clipped to 0)`)
      return {}
    }

    const ts = new Date().toISOString()
    const proposal: OutcomeProposal = OutcomeProposalSchema.parse({
      id: `p-${ulid()}`,
      marketId: market.id,
      side: agentProposal.side,
      limitPrice: agentProposal.limitPrice,
      sizeUsd,
      pHat: agentProposal.pHat,
      edgeBps: yesEdgeBps,
      kellyFraction,
      expiresAt: new Date(Date.now() + config.riskConfig.proposalTtlSec * 1000).toISOString(),
      thesis: agentProposal.thesis,
      signalsConsideredAt: agentProposal.signalsConsideredAt,
      ts
    })
    metrics.proposalsProposed++
    tape.push(
      'AGT',
      `${marketId}: pHat=${pct(proposal.pHat)} (mkt ${pct(market.yesPrice)}) ${proposal.side}@${proposal.limitPrice.toFixed(3)} $${proposal.sizeUsd.toFixed(0)} edge ${pp(proposal.edgeBps / 10_000)}`
    )
    await audit.append({ type: 'proposal.emitted', correlationId: proposal.id, payload: proposal })

    const decision = evaluateRisk({
      proposal,
      market,
      config: config.riskConfig,
      recentSignals: signals,
      openExposureUsd: exposureUsd,
      openMarketCount,
      clusterExposureUsd
    })
    await audit.append({ type: 'risk.decision', correlationId: proposal.id, payload: decision })

    if (decision.decision === 'DENY') {
      metrics.decisionsDeny++
      tape.push('RSK', `${marketId}: DENY ${decision.failures.map((f) => f.code).join(',')}`)
      return { proposal, decision }
    }

    metrics.decisionsAllow++
    tape.push('RSK', `${marketId}: ALLOW $${proposal.sizeUsd.toFixed(0)} ${proposal.side}@${proposal.limitPrice.toFixed(3)}`)

    try {
      const fill = await config.router.place(proposal)
      metrics.fillsConfirmed++
      await audit.append({ type: 'fill.confirmed', correlationId: proposal.id, payload: fill })
      tape.push('EXE', `${marketId}: filled $${fill.fillSizeUsd.toFixed(0)} @${fill.fillPrice.toFixed(3)}`)
      return { proposal, decision, fill }
    } catch (err) {
      tape.push('EXE', `${marketId}: order placement failed: ${String(err)}`)
      log('order placement error', err)
      return { proposal, decision }
    }
  }

  async function start(): Promise<() => Promise<void>> {
    await config.accountant.warmup()
    mode = 'READY'
    tape.push('OPS', 'agent online')
    return async () => {
      mode = 'HALT'
    }
  }

  return {
    ingest,
    evaluateMarket,
    mode: () => mode,
    setMode: (m) => {
      mode = m
      tape.push('OPS', `mode → ${m}`)
    },
    tape: () => tape,
    metrics: () => ({ ...metrics }),
    pHat: (id) => lastEstimateByMarket.get(id),
    start
  }
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const pp = (x: number): string => `${(x * 100).toFixed(2)}pp`

function passesMarketFilter(
  tags: readonly string[],
  filter: StrategyConfig['marketFilter'] | undefined
): boolean {
  if (!filter) return true
  if (filter.blockTags?.some((t) => tags.includes(t))) return false
  if (filter.allowTags && filter.allowTags.length > 0) {
    return filter.allowTags.some((t) => tags.includes(t))
  }
  return true
}
