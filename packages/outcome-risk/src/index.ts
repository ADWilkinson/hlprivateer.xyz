import type {
  OutcomeMarket,
  OutcomeProposal,
  ProbabilityEstimate,
  RiskConfig,
  RiskDecision,
  RiskGateCode,
  RiskGateFailure,
  SentimentSignal
} from '@hl/privateer-contracts'

export interface RiskContext {
  proposal: OutcomeProposal
  estimate: ProbabilityEstimate
  market: OutcomeMarket
  config: RiskConfig
  /** Most recent contributing sentiment signals; freshest first. */
  recentSignals: readonly SentimentSignal[]
  /** Currently-open exposure across all markets, USD. */
  openExposureUsd: number
  /** Number of markets we currently have an open position in. */
  openMarketCount: number
  /** Sum of open exposure within the same topic-tag cluster as `market`, USD. */
  clusterExposureUsd: number
  /** Caller-provided wall clock (ms). Default Date.now(). */
  nowMs?: number
}

export type Gate = (ctx: RiskContext) => RiskGateFailure | null

const GATES: Array<[RiskGateCode, Gate]> = [
  ['OPERATOR_HALT', gateOperatorHalt],
  ['INVALID_PROPOSAL', gateInvalidProposal],
  ['STALE_SENTIMENT', gateStaleSentiment],
  ['MARKET_NOT_TRADING', gateMarketNotTrading],
  ['RESOLUTION_TOO_SOON', gateResolutionTooSoon],
  ['RESOLUTION_TOO_FAR', gateResolutionTooFar],
  ['CHALLENGE_WINDOW_OPEN', gateChallengeWindowOpen],
  ['EDGE_TOO_THIN', gateEdgeTooThin],
  ['STAKE_PER_MARKET', gateStakePerMarket],
  ['CONCURRENT_MARKETS', gateConcurrentMarkets],
  ['CORRELATED_EXPOSURE', gateCorrelatedExposure],
  ['BANKROLL_DEPLETED', gateBankrollDepleted],
  ['LOW_LIQUIDITY', gateLowLiquidity]
]

export function evaluate(ctx: RiskContext): RiskDecision {
  const failures: RiskGateFailure[] = []
  for (const [, gate] of GATES) {
    const f = gate(ctx)
    if (f) {
      failures.push(f)
      break // fail-closed, short-circuit
    }
  }
  return {
    proposalId: ctx.proposal.id,
    decision: failures.length === 0 ? 'ALLOW' : 'DENY',
    failures,
    evaluatedAt: new Date(ctx.nowMs ?? Date.now()).toISOString()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Gates
// ────────────────────────────────────────────────────────────────────────────

function gateOperatorHalt(ctx: RiskContext): RiskGateFailure | null {
  return ctx.config.haltAll
    ? { code: 'OPERATOR_HALT', reason: 'Operator halt is active', observed: true, threshold: false }
    : null
}

function gateInvalidProposal(ctx: RiskContext): RiskGateFailure | null {
  const p = ctx.proposal
  if (p.sizeUsd <= 0) {
    return { code: 'INVALID_PROPOSAL', reason: 'sizeUsd must be > 0', observed: p.sizeUsd, threshold: 0 }
  }
  if (p.limitPrice <= 0 || p.limitPrice >= 1) {
    return {
      code: 'INVALID_PROPOSAL',
      reason: 'limitPrice must be in (0,1)',
      observed: p.limitPrice,
      threshold: '(0,1)'
    }
  }
  if (p.marketId !== ctx.market.id || p.marketId !== ctx.estimate.marketId) {
    return { code: 'INVALID_PROPOSAL', reason: 'proposal/market/estimate id mismatch' }
  }
  return null
}

function gateStaleSentiment(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.recentSignals.length === 0) {
    return {
      code: 'STALE_SENTIMENT',
      reason: 'no contributing sentiment signals',
      observed: 0,
      threshold: 1
    }
  }
  const minAge = Math.min(...ctx.recentSignals.map((s) => s.freshnessSec))
  if (minAge > ctx.config.maxSentimentAgeSec) {
    return {
      code: 'STALE_SENTIMENT',
      reason: `freshest sentiment ${minAge}s > maxAge ${ctx.config.maxSentimentAgeSec}s`,
      observed: minAge,
      threshold: ctx.config.maxSentimentAgeSec
    }
  }
  return null
}

function gateMarketNotTrading(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.market.status !== 'trading') {
    return {
      code: 'MARKET_NOT_TRADING',
      reason: `market status=${ctx.market.status}`,
      observed: ctx.market.status,
      threshold: 'trading'
    }
  }
  return null
}

function gateResolutionTooSoon(ctx: RiskContext): RiskGateFailure | null {
  const sec = secondsTo(ctx.market.resolutionAt, ctx.nowMs)
  if (sec < ctx.config.minSecondsToResolution) {
    return {
      code: 'RESOLUTION_TOO_SOON',
      reason: `${sec}s to resolution < min ${ctx.config.minSecondsToResolution}s`,
      observed: sec,
      threshold: ctx.config.minSecondsToResolution
    }
  }
  return null
}

function gateResolutionTooFar(ctx: RiskContext): RiskGateFailure | null {
  const sec = secondsTo(ctx.market.resolutionAt, ctx.nowMs)
  if (sec > ctx.config.maxSecondsToResolution) {
    return {
      code: 'RESOLUTION_TOO_FAR',
      reason: `${sec}s to resolution > max ${ctx.config.maxSecondsToResolution}s`,
      observed: sec,
      threshold: ctx.config.maxSecondsToResolution
    }
  }
  return null
}

function gateChallengeWindowOpen(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.market.status === 'challenged' || ctx.market.status === 'settling') {
    return {
      code: 'CHALLENGE_WINDOW_OPEN',
      reason: `market in ${ctx.market.status}; new entries blocked`,
      observed: ctx.market.status,
      threshold: 'trading'
    }
  }
  // Optional buffer: if very close to resolution and a challenge window exists,
  // refuse to open new positions that could enter during challenge.
  if (ctx.market.challengeWindowSec > 0) {
    const sec = secondsTo(ctx.market.resolutionAt, ctx.nowMs)
    const buffer = ctx.config.challengeWindowBufferSec + ctx.market.challengeWindowSec
    if (sec < buffer) {
      return {
        code: 'CHALLENGE_WINDOW_OPEN',
        reason: `within challenge buffer (${sec}s < ${buffer}s)`,
        observed: sec,
        threshold: buffer
      }
    }
  }
  return null
}

function gateEdgeTooThin(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.proposal.edgeBps < ctx.config.minEdgeBps) {
    return {
      code: 'EDGE_TOO_THIN',
      reason: `edge ${ctx.proposal.edgeBps}bps < min ${ctx.config.minEdgeBps}bps`,
      observed: ctx.proposal.edgeBps,
      threshold: ctx.config.minEdgeBps
    }
  }
  return null
}

function gateStakePerMarket(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.proposal.sizeUsd > ctx.config.maxStakePerMarketUsd) {
    return {
      code: 'STAKE_PER_MARKET',
      reason: `stake $${ctx.proposal.sizeUsd} > cap $${ctx.config.maxStakePerMarketUsd}`,
      observed: ctx.proposal.sizeUsd,
      threshold: ctx.config.maxStakePerMarketUsd
    }
  }
  return null
}

function gateConcurrentMarkets(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.openMarketCount >= ctx.config.maxConcurrentMarkets) {
    return {
      code: 'CONCURRENT_MARKETS',
      reason: `${ctx.openMarketCount} open markets >= cap ${ctx.config.maxConcurrentMarkets}`,
      observed: ctx.openMarketCount,
      threshold: ctx.config.maxConcurrentMarkets
    }
  }
  return null
}

function gateCorrelatedExposure(ctx: RiskContext): RiskGateFailure | null {
  if (ctx.market.topicTags.length === 0) return null
  const projected = ctx.clusterExposureUsd + ctx.proposal.sizeUsd
  if (projected > ctx.config.maxCorrelatedClusterUsd) {
    return {
      code: 'CORRELATED_EXPOSURE',
      reason:
        `cluster exposure $${projected.toFixed(0)} > cap $${ctx.config.maxCorrelatedClusterUsd} ` +
        `(tags=${ctx.market.topicTags.join(',')})`,
      observed: projected,
      threshold: ctx.config.maxCorrelatedClusterUsd
    }
  }
  return null
}

function gateBankrollDepleted(ctx: RiskContext): RiskGateFailure | null {
  const projected = ctx.openExposureUsd + ctx.proposal.sizeUsd
  if (projected > ctx.config.maxGrossExposureUsd) {
    return {
      code: 'BANKROLL_DEPLETED',
      reason: `gross exposure $${projected.toFixed(0)} > cap $${ctx.config.maxGrossExposureUsd}`,
      observed: projected,
      threshold: ctx.config.maxGrossExposureUsd
    }
  }
  return null
}

function gateLowLiquidity(ctx: RiskContext): RiskGateFailure | null {
  const depth =
    ctx.proposal.side === 'YES' ? ctx.market.bookDepthYesUsd : ctx.market.bookDepthNoUsd
  if (depth < ctx.config.minBookDepthUsd) {
    return {
      code: 'LOW_LIQUIDITY',
      reason: `book depth $${depth} < min $${ctx.config.minBookDepthUsd}`,
      observed: depth,
      threshold: ctx.config.minBookDepthUsd
    }
  }
  if (depth < ctx.proposal.sizeUsd) {
    return {
      code: 'LOW_LIQUIDITY',
      reason: `book depth $${depth} < proposal size $${ctx.proposal.sizeUsd}`,
      observed: depth,
      threshold: ctx.proposal.sizeUsd
    }
  }
  return null
}

// ────────────────────────────────────────────────────────────────────────────
// internal
// ────────────────────────────────────────────────────────────────────────────

function secondsTo(iso: string, nowMs?: number): number {
  return Math.floor((Date.parse(iso) - (nowMs ?? Date.now())) / 1000)
}
