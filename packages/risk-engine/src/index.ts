import type {
  ActorType,
  RiskDecision,
  RiskDecisionResult,
  StrategyProposal,
  TradeState
} from '@hl/privateer-contracts'
import { z } from 'zod'

type RiskReason = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface PositionSnapshot {
  symbol: string
  side: 'LONG' | 'SHORT'
  qty: number
  notionalUsd: number
}

export interface TickSnapshot {
  symbol: string
  px: number
  bid: number
  ask: number
  bidSize?: number
  askSize?: number
  updatedAt: string
}

export interface RiskConfig {
  maxLeverage: number
  maxDrawdownPct: number
  maxExposureUsd: number
  maxSlippageBps: number
  staleDataMs: number
  liquidityBufferPct: number
  notionalParityTolerance: number
  failClosedOnDependencyError: boolean
}

export interface RiskContext {
  state: TradeState
  accountValueUsd: number
  openPositions: PositionSnapshot[]
  proposal: StrategyProposal
  ticks: Record<string, TickSnapshot>
  dependenciesHealthy: boolean
  actorType: ActorType
}

type CheckResult = {
  ok: boolean
  reason?: string
}

const ActionWithLegsSchema = z.object({
  notionalUsd: z.number().positive(),
  legs: z.array(
    z.object({
      symbol: z.string().min(1),
      side: z.enum(['BUY', 'SELL']),
      notionalUsd: z.number().positive()
    })
  )
})

function staleMs(tick: TickSnapshot): number {
  return Date.now() - Date.parse(tick.updatedAt)
}

function computeProjectedLongShort(positions: PositionSnapshot[], proposal: StrategyProposal): { longUsd: number; shortUsd: number; grossUsd: number } {
  const bySymbol = new Map<string, number>()

  for (const position of positions) {
    const sign = position.side === 'LONG' ? 1 : -1
    bySymbol.set(position.symbol, (bySymbol.get(position.symbol) ?? 0) + sign * Math.abs(position.notionalUsd))
  }

  for (const action of proposal.actions) {
    for (const leg of action.legs) {
      const sign = leg.side === 'BUY' ? 1 : -1
      bySymbol.set(leg.symbol, (bySymbol.get(leg.symbol) ?? 0) + sign * leg.notionalUsd)
    }
  }

  const values = [...bySymbol.values()]
  const longUsd = values.filter((v) => v > 0).reduce((sum, v) => sum + v, 0)
  const shortUsd = values.filter((v) => v < 0).reduce((sum, v) => sum + Math.abs(v), 0)
  return { longUsd, shortUsd, grossUsd: longUsd + shortUsd }
}

function checkNotionalParity(positions: PositionSnapshot[], proposal: StrategyProposal, tolerance: number): CheckResult {
  const projected = computeProjectedLongShort(positions, proposal)
  if (projected.grossUsd === 0) {
    // Flat is acceptable (e.g. explicit exit/flatten proposals).
    return { ok: true }
  }

  if (projected.longUsd === 0 || projected.shortUsd === 0) {
    return { ok: false, reason: 'proposal leaves unhedged exposure (missing long or short leg)' }
  }

  const denominator = projected.grossUsd / 2
  const drift = Math.abs(projected.longUsd - projected.shortUsd) / denominator
  if (drift > tolerance) {
    return {
      ok: false,
      reason: `projected notional imbalance ${(drift * 100).toFixed(2)}% exceeds ${(tolerance * 100).toFixed(2)}%`
    }
  }

  return { ok: true }
}

function checkInvariant(proposal: StrategyProposal): CheckResult {
  const legs = proposal.actions.flatMap((action) => action.legs)
  // Strategy invariant: proposals must remain "HYPE vs basket" oriented, but we must
  // allow risk-reducing proposals (e.g. exits/flatten) where HYPE may be sold.
  const hasHypeLeg = legs.some((leg) => leg.symbol.toUpperCase() === 'HYPE')
  const hasNonHypeLeg = legs.some((leg) => leg.symbol.toUpperCase() !== 'HYPE')

  if (!hasHypeLeg || !hasNonHypeLeg) {
    return { ok: false, reason: 'strategy invariant must include HYPE + at least one non-HYPE leg' }
  }

  return { ok: true }
}

function checkLiquidity(proposal: StrategyProposal, ticks: Record<string, TickSnapshot>, buffer: number): CheckResult {
  for (const action of proposal.actions) {
    for (const leg of action.legs) {
      const tick = ticks[leg.symbol]
      if (!tick) {
        return { ok: false, reason: `missing tick for ${leg.symbol}` }
      }

      const side = leg.side === 'BUY' ? tick.ask : tick.bid
      const size = leg.side === 'BUY' ? tick.askSize ?? 0 : tick.bidSize ?? 0
      const depthUsd = side * Math.max(size, 0)
      const required = leg.notionalUsd * buffer
      if (!Number.isFinite(required) || Number.isNaN(required) || depthUsd < required) {
        return {
          ok: false,
          reason: `insufficient liquidity on ${leg.symbol}: ${depthUsd.toFixed(2)} < required ${(required ?? 0).toFixed(2)}`
        }
      }
    }
  }

  return { ok: true }
}

function checkFreshTicks(ticks: Record<string, TickSnapshot>, staleDataMs: number, proposal: StrategyProposal): CheckResult {
  const symbols = new Set(proposal.actions.flatMap((action) => action.legs.map((leg) => leg.symbol)))

  for (const symbol of symbols) {
    const tick = ticks[symbol]
    if (!tick) {
      return { ok: false, reason: `missing tick for symbol ${symbol}` }
    }

    if (Number.isNaN(staleMs(tick)) || staleMs(tick) > staleDataMs) {
      return { ok: false, reason: `stale market data for ${symbol}` }
    }
  }

  return { ok: true }
}

function checkLeverage(proposal: StrategyProposal, accountValueUsd: number, maxLeverage: number): CheckResult {
  const parsed = z.array(ActionWithLegsSchema).safeParse(proposal.actions)
  if (!parsed.success || accountValueUsd <= 0) {
    return { ok: false, reason: 'invalid proposal or account value' }
  }

  const gross = parsed.data.reduce((sum, action) => sum + action.notionalUsd, 0)
  const projected = gross / accountValueUsd
  if (projected > maxLeverage) {
    return { ok: false, reason: `projected leverage ${projected.toFixed(2)} exceeds max ${maxLeverage}` }
  }

  return { ok: true }
}

function checkExposure(positions: PositionSnapshot[], proposal: StrategyProposal, maxExposureUsd: number): CheckResult {
  const notionalBySymbol = new Map<string, number>()

  for (const position of positions) {
    const sign = position.side === 'LONG' ? 1 : -1
    notionalBySymbol.set(position.symbol, (notionalBySymbol.get(position.symbol) ?? 0) + sign * Math.abs(position.notionalUsd))
  }

  for (const action of proposal.actions) {
    for (const leg of action.legs) {
      const sign = leg.side === 'BUY' ? 1 : -1
      const value = (notionalBySymbol.get(leg.symbol) ?? 0) + sign * leg.notionalUsd
      notionalBySymbol.set(leg.symbol, value)
    }
  }

  const longGross = [...notionalBySymbol.values()].filter((v) => v > 0).reduce((sum, v) => sum + v, 0)
  const shortGross = [...notionalBySymbol.values()].filter((v) => v < 0).reduce((sum, v) => sum + Math.abs(v), 0)
  const grossExposure = longGross + shortGross

  if (grossExposure > maxExposureUsd) {
    return {
      ok: false,
      reason: `projected gross exposure ${grossExposure.toFixed(2)} exceeds max ${maxExposureUsd}`
    }
  }

  return { ok: true }
}

function projectedGrossNotional(positions: PositionSnapshot[], proposal: StrategyProposal): number {
  const bySymbol = new Map<string, number>()

  for (const position of positions) {
    const sign = position.side === 'LONG' ? 1 : -1
    bySymbol.set(position.symbol, (bySymbol.get(position.symbol) ?? 0) + sign * Math.abs(position.notionalUsd))
  }

  for (const action of proposal.actions) {
    for (const leg of action.legs) {
      const sign = leg.side === 'BUY' ? 1 : -1
      bySymbol.set(leg.symbol, (bySymbol.get(leg.symbol) ?? 0) + sign * leg.notionalUsd)
    }
  }

  return [...bySymbol.values()].reduce((sum, notional) => sum + Math.abs(notional), 0)
}

function currentGrossNotional(positions: PositionSnapshot[]): number {
  return positions.reduce((sum, position) => sum + Math.abs(position.notionalUsd), 0)
}

function checkSafeModePosture(state: TradeState, positions: PositionSnapshot[], proposal: StrategyProposal): CheckResult {
  if (state !== 'SAFE_MODE') {
    return { ok: true }
  }

  const current = currentGrossNotional(positions)
  const projected = projectedGrossNotional(positions, proposal)

  if (current === 0) {
    return {
      ok: false,
      reason: 'SAFE_MODE requires risk-reducing actions only; no new entries allowed when no exposure exists'
    }
  }

  if (projected > current) {
    return {
      ok: false,
      reason: 'SAFE_MODE disallows exposure growth; proposal must reduce gross notional'
    }
  }

  return { ok: true }
}

function checkDrawdown(positions: PositionSnapshot[], proposal: StrategyProposal, maxDrawdownPct: number): CheckResult {
  const projected = computeExposure(positions, proposal)
  const grossExposureUsd = Math.abs(projected.grossExposureUsd)
  const netExposureUsd = projected.netExposureUsd
  const projectedDrawdownPct = (grossExposureUsd === 0 ? 0 : Math.abs(netExposureUsd) / grossExposureUsd) * 100

  if (projectedDrawdownPct > maxDrawdownPct) {
    return { ok: false, reason: `projected drawdown ${projectedDrawdownPct.toFixed(2)}% exceeds max ${maxDrawdownPct}%` }
  }

  return { ok: true }
}

function computeImbalance(positions: PositionSnapshot[], proposal: StrategyProposal): number {
  const projected = computeProjectedLongShort(positions, proposal)
  if (projected.grossUsd === 0) {
    return 0
  }

  if (projected.longUsd === 0 || projected.shortUsd === 0) {
    return Number.POSITIVE_INFINITY
  }

  return Math.abs(projected.longUsd - projected.shortUsd) / (projected.grossUsd / 2)
}

function computeExposure(positions: PositionSnapshot[], proposal: StrategyProposal): { grossExposureUsd: number; netExposureUsd: number } {
  const bySymbol = new Map<string, number>()

  for (const position of positions) {
    const sign = position.side === 'LONG' ? 1 : -1
    bySymbol.set(position.symbol, (bySymbol.get(position.symbol) ?? 0) + sign * Math.abs(position.notionalUsd))
  }

  for (const action of proposal.actions) {
    for (const leg of action.legs) {
      const sign = leg.side === 'BUY' ? 1 : -1
      bySymbol.set(leg.symbol, (bySymbol.get(leg.symbol) ?? 0) + sign * leg.notionalUsd)
    }
  }

  const netExposureUsd = [...bySymbol.values()].reduce((sum, value) => sum + value, 0)
  const grossExposureUsd = [...bySymbol.values()].reduce((sum, value) => sum + Math.abs(value), 0)
  return { grossExposureUsd, netExposureUsd }
}

export function evaluateRisk(config: RiskConfig, context: RiskContext): RiskDecisionResult {
  const reasons: RiskReason[] = []
  const isSafeModeExit = context.state === 'SAFE_MODE' &&
    context.proposal.actions.length > 0 &&
    context.proposal.actions.every((action) => action.type === 'EXIT')

  if (!context.dependenciesHealthy && config.failClosedOnDependencyError) {
    reasons.push({
      code: 'DEPENDENCY_FAILURE',
      message: 'external dependencies unavailable'
    })
  }

  if (context.state === 'HALT') {
    reasons.push({
      code: 'SYSTEM_GATED',
      message: 'system is in HALT state'
    })
  }

  if (context.actorType === 'external_agent') {
    reasons.push({
      code: 'ACTOR_NOT_ALLOWED',
      message: 'external agents may only propose and cannot execute directly'
    })
  }

  const actionCount = context.proposal.actions.reduce((acc, action) => acc + action.legs.length, 0)
  if (actionCount === 0) {
    reasons.push({ code: 'INVALID_PROPOSAL', message: 'proposal has no actionable legs' })
  }

  const parityResult = checkNotionalParity(context.openPositions, context.proposal, config.notionalParityTolerance)
  if (!parityResult.ok && !isSafeModeExit) {
    reasons.push({ code: 'NOTIONAL_PARITY', message: parityResult.reason ?? 'invalid notional parity' })
  }

  const slippageLimit = Math.max(
    ...context.proposal.actions.map((action) => action.expectedSlippageBps),
    ...context.proposal.actions.map((action) => action.maxSlippageBps ?? 0)
  )
  if (slippageLimit > config.maxSlippageBps) {
    reasons.push({
      code: 'SLIPPAGE_BREACH',
      message: `slippage ${slippageLimit} bps > limit ${config.maxSlippageBps}`
    })
  }

  const leverage = checkLeverage(context.proposal, context.accountValueUsd, config.maxLeverage)
  if (!leverage.ok) {
    reasons.push({ code: 'LEVERAGE', message: leverage.reason ?? 'leverage exceeded' })
  }

  const drawdown = checkDrawdown(context.openPositions, context.proposal, config.maxDrawdownPct)
  if (!drawdown.ok) {
    reasons.push({ code: 'DRAWDOWN', message: drawdown.reason ?? 'drawdown exceeded' })
  }

  const exposure = checkExposure(context.openPositions, context.proposal, config.maxExposureUsd)
  if (!exposure.ok) {
    reasons.push({ code: 'EXPOSURE', message: exposure.reason ?? 'exposure exceeded' })
  }

  const liquidity = checkLiquidity(context.proposal, context.ticks, config.liquidityBufferPct)
  if (!liquidity.ok) {
    reasons.push({ code: 'LIQUIDITY', message: liquidity.reason ?? 'insufficient liquidity' })
  }

  const safeMode = checkSafeModePosture(context.state, context.openPositions, context.proposal)
  if (!safeMode.ok) {
    reasons.push({ code: 'SAFE_MODE', message: safeMode.reason ?? 'safe mode restricts command set' })
  }

  const freshness = checkFreshTicks(context.ticks, config.staleDataMs, context.proposal)
  if (!freshness.ok) {
    reasons.push({ code: 'STALE_DATA', message: freshness.reason ?? 'stale market data' })
  }

  const computed = {
    ...computeExposure(context.openPositions, context.proposal),
    projectedDrawdownPct: computeProjectedDrawdown(context.openPositions, context.proposal),
    notionalImbalancePct: Number((computeImbalance(context.openPositions, context.proposal) * 100).toFixed(2))
  }

  const hasBlockers = reasons.some((entry) =>
    [
      'DEPENDENCY_FAILURE',
      'SYSTEM_GATED',
      'NOTIONAL_PARITY',
      'DRAWDOWN',
      'EXPOSURE',
      'STALE_DATA',
      'LIQUIDITY',
      'LEVERAGE',
      'SLIPPAGE_BREACH',
      'ACTOR_NOT_ALLOWED'
    ].includes(entry.code)
  )
  const hasSafeModeBlocker = context.state === 'SAFE_MODE' && !safeMode.ok
  const decision: RiskDecision =
    hasBlockers || hasSafeModeBlocker
      ? 'DENY'
      : context.state === 'SAFE_MODE'
        ? 'ALLOW_REDUCE_ONLY'
        : 'ALLOW'

  return {
    decision,
    reasons,
    correlationId: context.proposal.proposalId,
    decisionId: `dec_${context.proposal.proposalId}`,
    computedAt: new Date().toISOString(),
    computed
  }
}

export function failClosedError(reason: string): RiskDecisionResult {
  return {
    decision: 'DENY',
    reasons: [
      {
        code: 'FAIL_CLOSED',
        message: reason
      }
    ],
    correlationId: `risk-${Date.now()}`,
    decisionId: `dec-${Date.now()}`,
    computedAt: new Date().toISOString(),
    computed: {
      grossExposureUsd: 0,
      netExposureUsd: 0,
      projectedDrawdownPct: 100,
      notionalImbalancePct: 100
    }
  }
}

function computeProjectedDrawdown(openPositions: PositionSnapshot[], proposal: StrategyProposal): number {
  const positionExposure = computeExposure(openPositions, proposal)
  const absGross = Math.abs(positionExposure.grossExposureUsd)
  if (absGross === 0) {
    return 0
  }

  return Math.min(100, Math.abs(positionExposure.netExposureUsd) / absGross * 100)
}
