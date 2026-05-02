import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────────────
// Bus envelope (carried over from v1; perp-specific stream names removed)
// ────────────────────────────────────────────────────────────────────────────

export const ActorTypeSchema = z.enum(['human', 'internal_agent', 'external_agent', 'system'])
export type ActorType = z.infer<typeof ActorTypeSchema>

export const StreamNameSchema = z.enum([
  'hlpv2.markets',
  'hlpv2.sentiment',
  'hlpv2.estimates',
  'hlpv2.proposals',
  'hlpv2.decisions',
  'hlpv2.fills',
  'hlpv2.audit',
  'hlpv2.ui',
  'hlpv2.commands'
])
export type StreamName = z.infer<typeof StreamNameSchema>

export const EventEnvelopeSchema = z.object({
  id: z.string().min(1),
  stream: StreamNameSchema,
  type: z.string().min(1),
  ts: z.string().datetime(),
  source: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().optional(),
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
  payload: z.unknown(),
  signature: z.string().optional(),
  riskMode: z.string().optional()
})
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, 'payload'> & {
  payload: T
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime mode (simplified from v1's 6-state machine)
// ────────────────────────────────────────────────────────────────────────────

export const RuntimeModeSchema = z.enum(['INIT', 'READY', 'HALT'])
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>

// ────────────────────────────────────────────────────────────────────────────
// Outcome markets (HIP-4)
// Binary contracts settling 0 or 1 in USDH; price ∈ [0,1] is implied probability.
// ────────────────────────────────────────────────────────────────────────────

export const MarketStatusSchema = z.enum([
  'auction',
  'trading',
  'settling',
  'challenged',
  'resolved',
  'voided'
])
export type MarketStatus = z.infer<typeof MarketStatusSchema>

export const Probability = z.number().min(0).max(1)

export const OutcomeMarketSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(3),
  description: z.string().optional(),
  resolutionAt: z.string().datetime(),
  challengeWindowSec: z.number().int().nonnegative().default(0),
  status: MarketStatusSchema,
  yesPrice: Probability,
  bidYes: Probability.optional(),
  askYes: Probability.optional(),
  bookDepthYesUsd: z.number().nonnegative().default(0),
  bookDepthNoUsd: z.number().nonnegative().default(0),
  topicTags: z.array(z.string()).default([]),
  updatedAt: z.string().datetime()
})
export type OutcomeMarket = z.infer<typeof OutcomeMarketSchema>

// ────────────────────────────────────────────────────────────────────────────
// Sentiment signals
// ────────────────────────────────────────────────────────────────────────────

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

export const SentimentSignalSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  source: SentimentSourceSchema,
  polarity: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  freshnessSec: z.number().int().nonnegative(),
  summary: z.string().max(500),
  url: z.string().url().optional(),
  ts: z.string().datetime()
})
export type SentimentSignal = z.infer<typeof SentimentSignalSchema>

// ────────────────────────────────────────────────────────────────────────────
// Probability estimate (output of Sentinel role)
// ────────────────────────────────────────────────────────────────────────────

export const ProbabilityEstimateSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  pHat: Probability,
  marketYesPrice: Probability,
  edge: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  basisSignalIds: z.array(z.string()).default([]),
  rationale: z.string().max(1000),
  ts: z.string().datetime()
})
export type ProbabilityEstimate = z.infer<typeof ProbabilityEstimateSchema>

// ────────────────────────────────────────────────────────────────────────────
// Proposal (Execution role's structured order intent)
// ────────────────────────────────────────────────────────────────────────────

export const OutcomeSideSchema = z.enum(['YES', 'NO'])
export type OutcomeSide = z.infer<typeof OutcomeSideSchema>

export const OutcomeProposalSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  side: OutcomeSideSchema,
  limitPrice: Probability,
  sizeUsd: z.number().positive(),
  edgeBps: z.number(),
  kellyFraction: z.number().min(0).max(1),
  expiresAt: z.string().datetime(),
  estimateId: z.string().min(1),
  rationale: z.string().max(1000),
  ts: z.string().datetime()
})
export type OutcomeProposal = z.infer<typeof OutcomeProposalSchema>

// ────────────────────────────────────────────────────────────────────────────
// Risk decision (fail-closed gate evaluation)
// ────────────────────────────────────────────────────────────────────────────

export const RiskGateCodeSchema = z.enum([
  'STALE_SENTIMENT',
  'MARKET_NOT_TRADING',
  'RESOLUTION_TOO_SOON',
  'RESOLUTION_TOO_FAR',
  'STAKE_PER_MARKET',
  'CONCURRENT_MARKETS',
  'CORRELATED_EXPOSURE',
  'CHALLENGE_WINDOW_OPEN',
  'LOW_LIQUIDITY',
  'EDGE_TOO_THIN',
  'BANKROLL_DEPLETED',
  'OPERATOR_HALT',
  'INVALID_PROPOSAL'
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

// ────────────────────────────────────────────────────────────────────────────
// Fill (post-execution confirmation)
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Risk config
// ────────────────────────────────────────────────────────────────────────────

export const RiskConfigSchema = z.object({
  maxSentimentAgeSec: z.number().int().positive().default(900),
  minSecondsToResolution: z.number().int().nonnegative().default(3600),
  maxSecondsToResolution: z.number().int().positive().default(60 * 24 * 3600),
  challengeWindowBufferSec: z.number().int().nonnegative().default(0),
  bankrollUsd: z.number().positive(),
  maxStakePerMarketUsd: z.number().positive(),
  maxConcurrentMarkets: z.number().int().positive().default(20),
  maxGrossExposureUsd: z.number().positive(),
  maxCorrelatedClusterUsd: z.number().positive(),
  minEdgeBps: z.number().nonnegative().default(200),
  minBookDepthUsd: z.number().nonnegative().default(500),
  kellyCap: z.number().min(0).max(1).default(0.25),
  haltAll: z.boolean().default(false)
})
export type RiskConfig = z.infer<typeof RiskConfigSchema>

// ────────────────────────────────────────────────────────────────────────────
// Floor / public surface (privacy by default — sizes obfuscated)
// ────────────────────────────────────────────────────────────────────────────

export const FloorTapeLineSchema = z.object({
  ts: z.string().datetime(),
  role: z.enum(['SNT', 'RSK', 'EXE', 'OPS']),
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
