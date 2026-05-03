import { z } from 'zod'

export const Probability = z.number().min(0).max(1)

export const RuntimeModeSchema = z.enum(['INIT', 'READY', 'HALT'])
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>

export const MarketStatusSchema = z.enum([
  'auction',
  'trading',
  'settling',
  'challenged',
  'resolved',
  'voided'
])
export type MarketStatus = z.infer<typeof MarketStatusSchema>

export const OutcomeSideSchema = z.enum(['YES', 'NO'])
export type OutcomeSide = z.infer<typeof OutcomeSideSchema>

export const SentimentSourceSchema = z.enum([
  'news',
  'x',
  'farcaster',
  'reddit',
  'polymarket',
  'kalshi',
  'manual'
])
export type SentimentSource = z.infer<typeof SentimentSourceSchema>

export const OutcomeMarketSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(3),
  description: z.string().optional(),
  resolutionAt: z.string().datetime(),
  challengeWindowSec: z.number().int().nonnegative().default(0),
  status: MarketStatusSchema,
  yesPrice: Probability,
  bookDepthYesUsd: z.number().nonnegative().default(0),
  bookDepthNoUsd: z.number().nonnegative().default(0),
  topicTags: z.array(z.string()).default([]),
  updatedAt: z.string().datetime()
})
export type OutcomeMarket = z.infer<typeof OutcomeMarketSchema>

// Raw sentiment item carried straight to the strategy agent. We no longer
// pre-score polarity/confidence - the agent ingests the bag of items and
// reasons about them in one shot.
export const SentimentItemSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  source: SentimentSourceSchema,
  summary: z.string().max(1000),
  url: z.string().url().optional(),
  observedAt: z.string().datetime()
})
export type SentimentItem = z.infer<typeof SentimentItemSchema>

// What the strategy agent emits. The orchestrator wraps it into an
// OutcomeProposal (id, edgeBps, kellyFraction, expiresAt) before risk eval.
export const AgentProposalSchema = z.object({
  side: OutcomeSideSchema,
  pHat: Probability,
  sizeUsd: z.number().nonnegative(),
  limitPrice: Probability,
  thesis: z.string().max(1000),
  signalsConsideredAt: z.string().datetime()
})
export type AgentProposal = z.infer<typeof AgentProposalSchema>

export const OutcomeProposalSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  side: OutcomeSideSchema,
  limitPrice: Probability,
  sizeUsd: z.number().positive(),
  pHat: Probability,
  edgeBps: z.number(),
  kellyFraction: z.number().min(0).max(1),
  expiresAt: z.string().datetime(),
  thesis: z.string().max(1000),
  signalsConsideredAt: z.string().datetime(),
  ts: z.string().datetime()
})
export type OutcomeProposal = z.infer<typeof OutcomeProposalSchema>

export const RiskGateCodeSchema = z.enum([
  'OPERATOR_HALT',
  'INVALID_PROPOSAL',
  'PROPOSAL_EXPIRED',
  'STALE_SENTIMENT',
  'MARKET_NOT_TRADING',
  'RESOLUTION_TOO_SOON',
  'RESOLUTION_TOO_FAR',
  'CHALLENGE_WINDOW_OPEN',
  'EDGE_TOO_THIN',
  'STAKE_PER_MARKET',
  'CONCURRENT_MARKETS',
  'CORRELATED_EXPOSURE',
  'BANKROLL_DEPLETED',
  'LOW_LIQUIDITY'
])
export type RiskGateCode = z.infer<typeof RiskGateCodeSchema>

export const RiskGateFailureSchema = z.object({
  code: RiskGateCodeSchema,
  reason: z.string().min(1),
  observed: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  threshold: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
})
export type RiskGateFailure = z.infer<typeof RiskGateFailureSchema>

export const RiskDecisionSchema = z.object({
  proposalId: z.string().min(1),
  decision: z.enum(['ALLOW', 'DENY']),
  failures: z.array(RiskGateFailureSchema).default([]),
  evaluatedAt: z.string().datetime()
})
export type RiskDecision = z.infer<typeof RiskDecisionSchema>

export const OutcomeFillSchema = z.object({
  id: z.string().min(1),
  proposalId: z.string().min(1),
  marketId: z.string().min(1),
  side: OutcomeSideSchema,
  fillPrice: Probability,
  fillSizeUsd: z.number().nonnegative(),
  feeUsd: z.number().nonnegative().default(0),
  txHash: z.string().optional(),
  ts: z.string().datetime()
})
export type OutcomeFill = z.infer<typeof OutcomeFillSchema>

export const RiskConfigSchema = z.object({
  maxSentimentAgeSec: z.number().int().positive().default(900),
  minSecondsToResolution: z.number().int().nonnegative().default(3600),
  maxSecondsToResolution: z.number().int().positive().default(60 * 24 * 3600),
  challengeWindowBufferSec: z.number().int().nonnegative().default(0),
  bankrollUsd: z.number().positive().default(1000),
  maxStakePerMarketUsd: z.number().positive().default(25),
  maxConcurrentMarkets: z.number().int().positive().default(20),
  maxGrossExposureUsd: z.number().positive().default(250),
  maxCorrelatedClusterUsd: z.number().positive().default(100),
  minEdgeBps: z.number().nonnegative().default(200),
  minBookDepthUsd: z.number().nonnegative().default(500),
  kellyCap: z.number().min(0).max(1).default(0.25),
  proposalTtlSec: z.number().int().positive().default(300),
  haltAll: z.boolean().default(false)
})
export type RiskConfig = z.infer<typeof RiskConfigSchema>

export const FloorTapeLineSchema = z.object({
  ts: z.string().datetime(),
  role: z.enum(['AGT', 'RSK', 'EXE', 'OPS']),
  message: z.string().min(1)
})
export type FloorTapeLine = z.infer<typeof FloorTapeLineSchema>

export const PublicMarketSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  status: MarketStatusSchema,
  yesPrice: Probability,
  pHat: Probability.optional(),
  edge: z.number().min(-1).max(1).optional(),
  resolutionAt: z.string().datetime(),
  topicTags: z.array(z.string()).default([])
})
export type PublicMarket = z.infer<typeof PublicMarketSchema>

export const FloorSnapshotSchema = z.object({
  mode: RuntimeModeSchema,
  pnlPct: z.number().nullable(),
  marketsTracked: z.number().int().nonnegative(),
  markets: z.array(PublicMarketSchema),
  tape: z.array(FloorTapeLineSchema)
})
export type FloorSnapshot = z.infer<typeof FloorSnapshotSchema>

// The strategy is the swappable, gitignored slice: agent prompt, risk
// knobs, and an optional market filter. Everything else (gates, math,
// orchestrator, audit, schemas, HTTP) stays public and deterministic.
export const StrategyConfigSchema = z.object({
  risk: RiskConfigSchema.default({}),
  prompts: z
    .object({
      strategist: z.string().optional()
    })
    .default({}),
  marketFilter: z
    .object({
      allowTags: z.array(z.string()).optional(),
      blockTags: z.array(z.string()).optional()
    })
    .default({})
})
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>
