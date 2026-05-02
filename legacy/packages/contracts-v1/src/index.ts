import { z } from 'zod'

export const TradeStateSchema = z.enum([
  'INIT',
  'WARMUP',
  'READY',
  'IN_TRADE',
  'HALT',
  'SAFE_MODE'
])

export type TradeState = z.infer<typeof TradeStateSchema>

export const ActorTypeSchema = z.enum(['human', 'internal_agent', 'external_agent', 'system'])
export type ActorType = z.infer<typeof ActorTypeSchema>

export const OPERATOR_VIEW_ROLE = 'operator_view'
export const OPERATOR_ADMIN_ROLE = 'operator_admin'

export const RoleSchema = z.enum([OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE])
export type Role = z.infer<typeof RoleSchema>

export const ChannelSchema = z.enum([
  'public',
  'operator',
  'agent',
  'replay',
  'audit'
])
export type Channel = z.infer<typeof ChannelSchema>

export const StreamNameSchema = z.enum([
  'hlp.market.raw',
  'hlp.market.normalized',
  'hlp.market.watchlist',
  'hlp.strategy.proposals',
  'hlp.plugin.signals',
  'hlp.risk.decisions',
  'hlp.execution.commands',
  'hlp.execution.fills',
  'hlp.audit.events',
  'hlp.ui.events',
  'hlp.payments.events',
  'hlp.commands'
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
  riskMode: z.string().optional(),
  sensitive: z.boolean().optional()
})
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, 'payload'> & {
  payload: T
}

export const NormalizedTickSchema = z.object({
  symbol: z.string().min(1),
  px: z.number().positive(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  bidSize: z.number().nonnegative(),
  askSize: z.number().nonnegative(),
  volume24hUsd: z.number().nonnegative().optional(),
  updatedAt: z.string().datetime(),
  source: z.string().default('market')
})
export type NormalizedTick = z.infer<typeof NormalizedTickSchema>

export const StrategyActionTypeSchema = z.enum(['ENTER', 'EXIT', 'HOLD'])
export const ActionSideSchema = z.enum(['BUY', 'SELL'])

export const StrategyLegSchema = z
  .object({
    symbol: z.string().min(1),
    side: ActionSideSchema,
    notionalUsd: z.number().positive(),
    targetRatio: z.number().min(0).max(1).optional(),
    stopLossPrice: z.number().positive().optional(),
    takeProfitPrice: z.number().positive().optional(),
    thesisNote: z.string().max(500).optional()
  })
  .strict()

export const StrategyActionSchema = z
  .object({
    type: StrategyActionTypeSchema,
    rationale: z.string().min(3),
    notionalUsd: z.number().positive(),
    legs: z.array(StrategyLegSchema).min(1),
    expectedSlippageBps: z.number().nonnegative().default(0),
    maxSlippageBps: z.number().nonnegative().optional()
  })
  .strict()

export const StrategyExitReasonSchema = z.enum([
  'DISCRETIONARY',
  'STOP_LOSS',
  'TAKE_PROFIT',
  'TIME_EXIT',
  'INVALIDATION',
  'RISK_OFF'
])

export const StrategyHorizonClassSchema = z.enum(['DAY', 'SWING', 'CORE'])

export const StrategyThesisSchema = z
  .object({
    thesisId: z.string().min(1),
    horizonClass: StrategyHorizonClassSchema.optional(),
    timeframeMin: z.number().int().positive().optional(),
    stopLossPct: z.number().positive().optional(),
    takeProfitPct: z.number().positive().optional(),
    invalidation: z.string().min(3).max(500).optional(),
    createdAt: z.string().datetime().optional()
  })
  .strict()

export const StrategyProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    cycleId: z.string().min(1),
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1),
    actions: z.array(StrategyActionSchema).min(1),
    createdBy: z.string().min(1),
    requestedMode: z.enum(['SIM', 'LIVE']).default('SIM'),
    thesis: StrategyThesisSchema.optional(),
    exitReason: StrategyExitReasonSchema.optional()
  })
  .strict()

export type StrategyProposal = z.infer<typeof StrategyProposalSchema>

export const ParseErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional()
})

export const StrategyParseResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    proposal: StrategyProposalSchema
  }),
  z.object({
    ok: z.literal(false),
    errors: z.array(ParseErrorSchema)
  })
])
export type StrategyParseResult = z.infer<typeof StrategyParseResultSchema>

export const FloorTapeLineLevelSchema = z.enum(['INFO', 'WARN', 'ERROR'])
export type FloorTapeLineLevel = z.infer<typeof FloorTapeLineLevelSchema>

export const FloorTapeLineSchema = z.object({
  ts: z.string().datetime(),
  role: z.string().min(1).optional(),
  level: FloorTapeLineLevelSchema.default('INFO'),
  line: z.string().min(1)
})
export type FloorTapeLine = z.infer<typeof FloorTapeLineSchema>

export const RiskDecisionSchema = z.enum(['ALLOW', 'ALLOW_REDUCE_ONLY', 'DENY'])
export type RiskDecision = z.infer<typeof RiskDecisionSchema>

export const RiskReasonSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional()
})

export const RiskDecisionComputedSchema = z.object({
  grossExposureUsd: z.number(),
  netExposureUsd: z.number(),
  projectedDrawdownPct: z.number()
})
export type RiskDecisionComputed = z.infer<typeof RiskDecisionComputedSchema>

export const PublicOpenPositionSchema = z.object({
  symbol: z.string(),
  side: z.string().optional(),
  size: z.number().optional(),
  entryPrice: z.number().optional(),
  markPrice: z.number().optional(),
  pnlUsd: z.number().optional(),
  pnlPct: z.number().optional(),
  notionalUsd: z.number().optional(),
  id: z.string().optional()
})

export type PublicOpenPosition = z.infer<typeof PublicOpenPositionSchema>

export const RiskDecisionResultSchema = z.object({
  decision: RiskDecisionSchema,
  reasons: z.array(RiskReasonSchema).default([]),
  correlationId: z.string(),
  decisionId: z.string(),
  computedAt: z.string().datetime(),
  computed: RiskDecisionComputedSchema
})
export type RiskDecisionResult = z.infer<typeof RiskDecisionResultSchema>

export const PublicPnlResponseSchema = z.object({
  pnlPct: z.number(),
  mode: TradeStateSchema,
  updatedAt: z.string().datetime()
})
export type PublicPnlResponse = z.infer<typeof PublicPnlResponseSchema>

export const TrajectoryPointSchema = z.object({
  ts: z.string().datetime(),
  pnlPct: z.number(),
  accountValueUsd: z.number().optional()
})
export type TrajectoryPoint = z.infer<typeof TrajectoryPointSchema>

export const PublicTrajectoryResponseSchema = z.object({
  points: z.array(TrajectoryPointSchema),
  sampledEveryMs: z.number()
})
export type PublicTrajectoryResponse = z.infer<typeof PublicTrajectoryResponseSchema>

export const PublicSnapshotSchema = z.object({
  mode: TradeStateSchema,
  pnlPct: z.number(),
  healthCode: z.enum(['GREEN', 'YELLOW', 'RED']),
  accountValueUsd: z.number().optional(),
  maxLeverage: z.number().optional(),
  openPositions: z.array(PublicOpenPositionSchema).optional().default([]),
  openPositionCount: z.number().optional(),
  openPositionNotionalUsd: z.number().optional(),
  recentTape: z.array(FloorTapeLineSchema).default([]),
  lastUpdateAt: z.string().datetime()
})
export type PublicSnapshot = z.infer<typeof PublicSnapshotSchema>

export const OperatorStatusSchema = z.object({
  mode: TradeStateSchema,
  pnlPct: z.number(),
  riskConfig: z.record(z.unknown()),
  activeAgents: z.number(),
  timestamp: z.string().datetime()
})
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>

export const OperatorOrderSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: ActionSideSchema,
  status: z.enum(['NEW', 'WORKING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'FAILED']),
  notionalUsd: z.number(),
  filledQty: z.number(),
  avgFillPx: z.number(),
  createdAt: z.string().datetime(),
  source: z.enum(['SIM', 'LIVE'])
})
export type OperatorOrder = z.infer<typeof OperatorOrderSchema>

export const OperatorPositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  qty: z.number(),
  notionalUsd: z.number(),
  avgEntryPx: z.number(),
  markPx: z.number(),
  pnlUsd: z.number(),
  updatedAt: z.string().datetime()
})
export type OperatorPosition = z.infer<typeof OperatorPositionSchema>

export const OperatorCommandNameSchema = z.enum([
  '/status',
  '/positions',
  '/halt',
  '/resume',
  '/flatten',
  '/risk-policy',
  '/explain'
])
export type OperatorCommandName = z.infer<typeof OperatorCommandNameSchema>

export const OperatorCommandSchema = z
  .object({
    command: OperatorCommandNameSchema,
    args: z.array(z.string()).default([]),
    reason: z.string().min(3)
  })
  .strict()
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>

export const AgentCommandSchema = OperatorCommandSchema
export type AgentCommand = z.infer<typeof AgentCommandSchema>

export const CommandParseErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional()
})

export const CommandParseResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    command: OperatorCommandSchema
  }),
  z.object({
    ok: z.literal(false),
    errors: z.array(CommandParseErrorSchema)
  })
])
export type CommandParseResult = z.infer<typeof CommandParseResultSchema>

export const OperatorCommandActorSchema = z
  .object({
    actorType: ActorTypeSchema,
    actorId: z.string().min(1),
    requestedAt: z.string().datetime().optional(),
    role: z.enum([OPERATOR_VIEW_ROLE, OPERATOR_ADMIN_ROLE]).optional()
  })
  .strict()
export type OperatorCommandActor = z.infer<typeof OperatorCommandActorSchema>

export const CommandPolicySchema = z
  .object({
    command: OperatorCommandNameSchema,
    allowedActorTypes: z.array(ActorTypeSchema).default(['human']),
    requiredRoles: z.array(RoleSchema).default([]),
    requiredCapabilities: z.array(z.string()).default([])
  })
  .strict()
export type CommandPolicy = z.infer<typeof CommandPolicySchema>

export const CommandEnvelopePayloadSchema = z
  .object({
    command: OperatorCommandNameSchema,
    args: z.array(z.string()).default([]),
    reason: z.string().min(3),
    actor: OperatorCommandActorSchema.optional(),
    actorRole: RoleSchema.optional(),
    capabilities: z.array(z.string()).default([])
  })
  .strict()
export type CommandEnvelopePayload = z.infer<typeof CommandEnvelopePayloadSchema>

export const DEFAULT_TIER_CAPABILITIES: TierCapabilityMap = {
  tier0: ['stream.read.public', 'command.status'],
  tier1: ['stream.read.public', 'command.status', 'stream.read.obfuscated.realtime', 'command.explain.redacted', 'analysis.read'],
  tier2: [
    'stream.read.public',
    'stream.read.obfuscated.realtime',
    'stream.read.full',
    'command.status',
    'command.explain.redacted',
    'market.data.read',
    'agent.insights.read',
    'copy.positions.read',
    'copy.signals.read',
    'command.positions',
    'command.execute',
    'plugin.health.read',
    'analysis.read'
  ],
  tier3: [
    'stream.read.public',
    'stream.read.obfuscated.realtime',
    'stream.read.full',
    'command.status',
    'command.explain.redacted',
    'market.data.read',
    'agent.insights.read',
    'copy.positions.read',
    'copy.signals.read',
    'command.positions',
    'command.execute',
    'plugin.health.read',
    'plugin.submit',
    'command.audit',
    'analysis.read'
  ]
}

export const COMMAND_POLICIES: Record<OperatorCommandName, CommandPolicy> = {
  '/status': {
    command: '/status',
    allowedActorTypes: ['human', 'internal_agent', 'external_agent'],
    requiredRoles: [],
    requiredCapabilities: ['command.status']
  },
  '/positions': {
    command: '/positions',
    allowedActorTypes: ['human', 'internal_agent', 'external_agent'],
    requiredRoles: [],
    requiredCapabilities: ['command.positions']
  },
  '/halt': {
    command: '/halt',
    allowedActorTypes: ['human', 'internal_agent'],
    requiredRoles: [OPERATOR_ADMIN_ROLE],
    requiredCapabilities: ['command.execute']
  },
  '/resume': {
    command: '/resume',
    allowedActorTypes: ['human', 'internal_agent'],
    requiredRoles: [OPERATOR_ADMIN_ROLE],
    requiredCapabilities: ['command.execute']
  },
  '/flatten': {
    command: '/flatten',
    allowedActorTypes: ['human', 'internal_agent'],
    requiredRoles: [OPERATOR_ADMIN_ROLE],
    requiredCapabilities: ['command.execute']
  },
  '/risk-policy': {
    command: '/risk-policy',
    allowedActorTypes: ['human', 'internal_agent'],
    requiredRoles: [OPERATOR_ADMIN_ROLE],
    requiredCapabilities: ['command.execute']
  },
  '/explain': {
    command: '/explain',
    allowedActorTypes: ['human', 'internal_agent', 'external_agent'],
    requiredRoles: [],
    requiredCapabilities: ['command.explain.redacted']
  }
}

export const CommandPolicyLookupSchema = z.record(OperatorCommandNameSchema, CommandPolicySchema)

export function commandPolicy(command: OperatorCommandName): CommandPolicy {
  return COMMAND_POLICIES[command]
}

export const CommandResultSchema = z.object({
  ok: z.boolean(),
  command: z.string(),
  message: z.string(),
  requestId: z.string(),
  payload: z.unknown().optional()
})
export type CommandResult = z.infer<typeof CommandResultSchema>

export const EntitlementTierSchema = z.enum(['tier0', 'tier1', 'tier2', 'tier3'])
export type EntitlementTier = z.infer<typeof EntitlementTierSchema>

export const PaymentChallengeSchema = z.object({
  challengeId: z.string(),
  resource: z.string().min(1),
  tier: EntitlementTierSchema,
  nonce: z.string().min(8),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
})
export type PaymentChallenge = z.infer<typeof PaymentChallengeSchema>

export const PaymentProofSchema = z.object({
  challengeId: z.string(),
  agentId: z.string().min(1),
  tier: EntitlementTierSchema,
  signature: z.string().min(1),
  nonce: z.string().min(8),
  paidAmountUsd: z.number().positive(),
  paidAt: z.string().datetime()
})
export type PaymentProof = z.infer<typeof PaymentProofSchema>

export const EntitlementSchema = z.object({
  agentId: z.string(),
  tier: EntitlementTierSchema,
  capabilities: z.array(z.string()),
  expiresAt: z.string().datetime(),
  quotaRemaining: z.number().int().nonnegative(),
  rateLimitPerMinute: z.number().int().nonnegative()
})
export type Entitlement = z.infer<typeof EntitlementSchema>

export const WsMessageSchema = z.union([
  z.object({
    type: z.literal('sub.add'),
    channel: ChannelSchema,
    token: z.string().optional()
  }).strict(),
  z.object({
    type: z.literal('sub.remove'),
    channel: ChannelSchema
  }).strict(),
  z.object({
    type: z.literal('cmd.exec'),
    command: z.string(),
    args: z.array(z.string()).default([])
  }).strict(),
  z.object({
    type: z.literal('ping')
  }).strict()
])

export type WsClientMessage = z.infer<typeof WsMessageSchema>

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sub.ack'),
    channel: ChannelSchema,
    accepted: z.boolean()
  }).strict(),
  z.object({
    type: z.literal('event'),
    channel: ChannelSchema,
    payload: z.unknown()
  }).strict(),
  z.object({
    type: z.literal('cmd.result'),
    requestId: z.string(),
    result: CommandResultSchema
  }).strict(),
  z.object({
    type: z.literal('error'),
    requestId: z.string(),
    code: z.string(),
    message: z.string()
  }).strict(),
  z.object({
    type: z.literal('pong')
  }).strict()
])
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>

export const ReplayRequestSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  correlationId: z.string().optional(),
  resource: z.string().optional(),
  limit: z.number().int().positive().max(5000).default(500)
}).strict().refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
  message: 'from must be before or equal to to',
  path: ['to']
})

export const HttpReplayQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  resource: z.string().optional(),
  correlationId: z.string().optional(),
  limit: z.number().int().positive().max(5000).default(200)
}).strict().refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
  message: 'from must be before or equal to to',
  path: ['to']
})

export const AuditEventSchema = z.object({
  id: z.string(),
  ts: z.string().datetime(),
  actorType: ActorTypeSchema,
  actorId: z.string(),
  action: z.string(),
  resource: z.string(),
  correlationId: z.string(),
  details: z.record(z.unknown()),
  hash: z.string().optional()
})
export type AuditEvent = z.infer<typeof AuditEventSchema>

export function parseStrategyProposal(candidate: unknown): StrategyParseResult {
  const parsed = StrategyProposalSchema.safeParse(candidate)
  if (parsed.success) {
    return {
      ok: true,
      proposal: parsed.data
    }
  }

  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      code: 'SCHEMA_VALIDATION_ERROR',
      message: issue.message,
      path: issue.path.map((segment) => String(segment))
    }))
  }
}

export function parseCommand(candidate: unknown): CommandParseResult {
  const parsed = OperatorCommandSchema.safeParse(candidate)
  if (parsed.success) {
    return {
      ok: true,
      command: parsed.data
    }
  }

  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      code: 'SCHEMA_VALIDATION_ERROR',
      message: issue.message,
      path: issue.path.map((segment) => String(segment))
    }))
  }
}

export const ReplayRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  resource: z.string().optional(),
  correlationId: z.string().optional()
}).strict().refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
  message: 'from must be before or equal to to',
  path: ['to']
})

export const TierCapabilityMapSchema = z.record(
  z.enum(['tier0', 'tier1', 'tier2', 'tier3']),
  z.array(z.string())
)

export type TierCapabilityMap = z.infer<typeof TierCapabilityMapSchema>
