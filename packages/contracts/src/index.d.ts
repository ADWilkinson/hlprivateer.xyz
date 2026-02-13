import { z } from 'zod';
export declare const TradeStateSchema: z.ZodEnum<["INIT", "WARMUP", "READY", "IN_TRADE", "REBALANCE", "HALT", "SAFE_MODE"]>;
export type TradeState = z.infer<typeof TradeStateSchema>;
export declare const ActorTypeSchema: z.ZodEnum<["human", "internal_agent", "external_agent", "system"]>;
export type ActorType = z.infer<typeof ActorTypeSchema>;
export declare const OPERATOR_VIEW_ROLE = "operator_view";
export declare const OPERATOR_ADMIN_ROLE = "operator_admin";
export declare const ChannelSchema: z.ZodEnum<["public", "operator", "agent", "replay", "audit"]>;
export type Channel = z.infer<typeof ChannelSchema>;
export declare const StreamNameSchema: z.ZodEnum<["hlp.market.raw", "hlp.market.normalized", "hlp.strategy.proposals", "hlp.plugin.signals", "hlp.risk.decisions", "hlp.execution.commands", "hlp.execution.fills", "hlp.audit.events", "hlp.ui.events", "hlp.payments.events", "hlp.commands"]>;
export type StreamName = z.infer<typeof StreamNameSchema>;
export declare const EventEnvelopeSchema: z.ZodObject<{
    id: z.ZodString;
    stream: z.ZodEnum<["hlp.market.raw", "hlp.market.normalized", "hlp.strategy.proposals", "hlp.plugin.signals", "hlp.risk.decisions", "hlp.execution.commands", "hlp.execution.fills", "hlp.audit.events", "hlp.ui.events", "hlp.payments.events", "hlp.commands"]>;
    type: z.ZodString;
    ts: z.ZodString;
    source: z.ZodString;
    correlationId: z.ZodString;
    causationId: z.ZodOptional<z.ZodString>;
    actorType: z.ZodEnum<["human", "internal_agent", "external_agent", "system"]>;
    actorId: z.ZodString;
    payload: z.ZodUnknown;
    signature: z.ZodOptional<z.ZodString>;
    riskMode: z.ZodOptional<z.ZodString>;
    sensitive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    stream: "hlp.market.raw" | "hlp.market.normalized" | "hlp.strategy.proposals" | "hlp.plugin.signals" | "hlp.risk.decisions" | "hlp.execution.commands" | "hlp.execution.fills" | "hlp.audit.events" | "hlp.ui.events" | "hlp.payments.events" | "hlp.commands";
    ts: string;
    source: string;
    correlationId: string;
    actorType: "human" | "internal_agent" | "external_agent" | "system";
    actorId: string;
    causationId?: string | undefined;
    payload?: unknown;
    signature?: string | undefined;
    riskMode?: string | undefined;
    sensitive?: boolean | undefined;
}, {
    type: string;
    id: string;
    stream: "hlp.market.raw" | "hlp.market.normalized" | "hlp.strategy.proposals" | "hlp.plugin.signals" | "hlp.risk.decisions" | "hlp.execution.commands" | "hlp.execution.fills" | "hlp.audit.events" | "hlp.ui.events" | "hlp.payments.events" | "hlp.commands";
    ts: string;
    source: string;
    correlationId: string;
    actorType: "human" | "internal_agent" | "external_agent" | "system";
    actorId: string;
    causationId?: string | undefined;
    payload?: unknown;
    signature?: string | undefined;
    riskMode?: string | undefined;
    sensitive?: boolean | undefined;
}>;
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, 'payload'> & {
    payload: T;
};
export declare const NormalizedTickSchema: z.ZodObject<{
    symbol: z.ZodString;
    px: z.ZodNumber;
    bid: z.ZodNumber;
    ask: z.ZodNumber;
    bidSize: z.ZodNumber;
    askSize: z.ZodNumber;
    volume24hUsd: z.ZodOptional<z.ZodNumber>;
    updatedAt: z.ZodString;
    source: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    source: string;
    px: number;
    bid: number;
    ask: number;
    bidSize: number;
    askSize: number;
    updatedAt: string;
    volume24hUsd?: number | undefined;
}, {
    symbol: string;
    px: number;
    bid: number;
    ask: number;
    bidSize: number;
    askSize: number;
    updatedAt: string;
    source?: string | undefined;
    volume24hUsd?: number | undefined;
}>;
export type NormalizedTick = z.infer<typeof NormalizedTickSchema>;
export declare const StrategyActionTypeSchema: z.ZodEnum<["ENTER", "EXIT", "REBALANCE", "HOLD"]>;
export declare const ActionSideSchema: z.ZodEnum<["BUY", "SELL"]>;
export declare const StrategyLegSchema: z.ZodObject<{
    symbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    notionalUsd: z.ZodNumber;
    targetRatio: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    symbol: string;
    side: "BUY" | "SELL";
    notionalUsd: number;
    targetRatio?: number | undefined;
}, {
    symbol: string;
    side: "BUY" | "SELL";
    notionalUsd: number;
    targetRatio?: number | undefined;
}>;
export declare const StrategyActionSchema: z.ZodObject<{
    type: z.ZodEnum<["ENTER", "EXIT", "REBALANCE", "HOLD"]>;
    rationale: z.ZodString;
    notionalUsd: z.ZodNumber;
    legs: z.ZodArray<z.ZodObject<{
        symbol: z.ZodString;
        side: z.ZodEnum<["BUY", "SELL"]>;
        notionalUsd: z.ZodNumber;
        targetRatio: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        symbol: string;
        side: "BUY" | "SELL";
        notionalUsd: number;
        targetRatio?: number | undefined;
    }, {
        symbol: string;
        side: "BUY" | "SELL";
        notionalUsd: number;
        targetRatio?: number | undefined;
    }>, "many">;
    expectedSlippageBps: z.ZodDefault<z.ZodNumber>;
    maxSlippageBps: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
    notionalUsd: number;
    rationale: string;
    legs: {
        symbol: string;
        side: "BUY" | "SELL";
        notionalUsd: number;
        targetRatio?: number | undefined;
    }[];
    expectedSlippageBps: number;
    maxSlippageBps?: number | undefined;
}, {
    type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
    notionalUsd: number;
    rationale: string;
    legs: {
        symbol: string;
        side: "BUY" | "SELL";
        notionalUsd: number;
        targetRatio?: number | undefined;
    }[];
    expectedSlippageBps?: number | undefined;
    maxSlippageBps?: number | undefined;
}>;
export declare const StrategyProposalSchema: z.ZodObject<{
    proposalId: z.ZodString;
    cycleId: z.ZodString;
    summary: z.ZodString;
    confidence: z.ZodNumber;
    actions: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["ENTER", "EXIT", "REBALANCE", "HOLD"]>;
        rationale: z.ZodString;
        notionalUsd: z.ZodNumber;
        legs: z.ZodArray<z.ZodObject<{
            symbol: z.ZodString;
            side: z.ZodEnum<["BUY", "SELL"]>;
            notionalUsd: z.ZodNumber;
            targetRatio: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            symbol: string;
            side: "BUY" | "SELL";
            notionalUsd: number;
            targetRatio?: number | undefined;
        }, {
            symbol: string;
            side: "BUY" | "SELL";
            notionalUsd: number;
            targetRatio?: number | undefined;
        }>, "many">;
        expectedSlippageBps: z.ZodDefault<z.ZodNumber>;
        maxSlippageBps: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
        notionalUsd: number;
        rationale: string;
        legs: {
            symbol: string;
            side: "BUY" | "SELL";
            notionalUsd: number;
            targetRatio?: number | undefined;
        }[];
        expectedSlippageBps: number;
        maxSlippageBps?: number | undefined;
    }, {
        type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
        notionalUsd: number;
        rationale: string;
        legs: {
            symbol: string;
            side: "BUY" | "SELL";
            notionalUsd: number;
            targetRatio?: number | undefined;
        }[];
        expectedSlippageBps?: number | undefined;
        maxSlippageBps?: number | undefined;
    }>, "many">;
    createdBy: z.ZodString;
    requestedMode: z.ZodDefault<z.ZodEnum<["SIM", "LIVE"]>>;
}, "strict", z.ZodTypeAny, {
    proposalId: string;
    cycleId: string;
    summary: string;
    confidence: number;
    actions: {
        type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
        notionalUsd: number;
        rationale: string;
        legs: {
            symbol: string;
            side: "BUY" | "SELL";
            notionalUsd: number;
            targetRatio?: number | undefined;
        }[];
        expectedSlippageBps: number;
        maxSlippageBps?: number | undefined;
    }[];
    createdBy: string;
    requestedMode: "SIM" | "LIVE";
}, {
    proposalId: string;
    cycleId: string;
    summary: string;
    confidence: number;
    actions: {
        type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
        notionalUsd: number;
        rationale: string;
        legs: {
            symbol: string;
            side: "BUY" | "SELL";
            notionalUsd: number;
            targetRatio?: number | undefined;
        }[];
        expectedSlippageBps?: number | undefined;
        maxSlippageBps?: number | undefined;
    }[];
    createdBy: string;
    requestedMode?: "SIM" | "LIVE" | undefined;
}>;
export type StrategyProposal = z.infer<typeof StrategyProposalSchema>;
export declare const ParseErrorSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    path: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    path?: (string | number)[] | undefined;
}, {
    code: string;
    message: string;
    path?: (string | number)[] | undefined;
}>;
export declare const StrategyParseResultSchema: z.ZodDiscriminatedUnion<"ok", [z.ZodObject<{
    ok: z.ZodLiteral<true>;
    proposal: z.ZodObject<{
        proposalId: z.ZodString;
        cycleId: z.ZodString;
        summary: z.ZodString;
        confidence: z.ZodNumber;
        actions: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<["ENTER", "EXIT", "REBALANCE", "HOLD"]>;
            rationale: z.ZodString;
            notionalUsd: z.ZodNumber;
            legs: z.ZodArray<z.ZodObject<{
                symbol: z.ZodString;
                side: z.ZodEnum<["BUY", "SELL"]>;
                notionalUsd: z.ZodNumber;
                targetRatio: z.ZodOptional<z.ZodNumber>;
            }, "strict", z.ZodTypeAny, {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }, {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }>, "many">;
            expectedSlippageBps: z.ZodDefault<z.ZodNumber>;
            maxSlippageBps: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
            notionalUsd: number;
            rationale: string;
            legs: {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }[];
            expectedSlippageBps: number;
            maxSlippageBps?: number | undefined;
        }, {
            type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
            notionalUsd: number;
            rationale: string;
            legs: {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }[];
            expectedSlippageBps?: number | undefined;
            maxSlippageBps?: number | undefined;
        }>, "many">;
        createdBy: z.ZodString;
        requestedMode: z.ZodDefault<z.ZodEnum<["SIM", "LIVE"]>>;
    }, "strict", z.ZodTypeAny, {
        proposalId: string;
        cycleId: string;
        summary: string;
        confidence: number;
        actions: {
            type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
            notionalUsd: number;
            rationale: string;
            legs: {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }[];
            expectedSlippageBps: number;
            maxSlippageBps?: number | undefined;
        }[];
        createdBy: string;
        requestedMode: "SIM" | "LIVE";
    }, {
        proposalId: string;
        cycleId: string;
        summary: string;
        confidence: number;
        actions: {
            type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
            notionalUsd: number;
            rationale: string;
            legs: {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }[];
            expectedSlippageBps?: number | undefined;
            maxSlippageBps?: number | undefined;
        }[];
        createdBy: string;
        requestedMode?: "SIM" | "LIVE" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    ok: true;
    proposal: {
        proposalId: string;
        cycleId: string;
        summary: string;
        confidence: number;
        actions: {
            type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
            notionalUsd: number;
            rationale: string;
            legs: {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }[];
            expectedSlippageBps: number;
            maxSlippageBps?: number | undefined;
        }[];
        createdBy: string;
        requestedMode: "SIM" | "LIVE";
    };
}, {
    ok: true;
    proposal: {
        proposalId: string;
        cycleId: string;
        summary: string;
        confidence: number;
        actions: {
            type: "REBALANCE" | "ENTER" | "EXIT" | "HOLD";
            notionalUsd: number;
            rationale: string;
            legs: {
                symbol: string;
                side: "BUY" | "SELL";
                notionalUsd: number;
                targetRatio?: number | undefined;
            }[];
            expectedSlippageBps?: number | undefined;
            maxSlippageBps?: number | undefined;
        }[];
        createdBy: string;
        requestedMode?: "SIM" | "LIVE" | undefined;
    };
}>, z.ZodObject<{
    ok: z.ZodLiteral<false>;
    errors: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        path: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        path?: (string | number)[] | undefined;
    }, {
        code: string;
        message: string;
        path?: (string | number)[] | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    ok: false;
    errors: {
        code: string;
        message: string;
        path?: (string | number)[] | undefined;
    }[];
}, {
    ok: false;
    errors: {
        code: string;
        message: string;
        path?: (string | number)[] | undefined;
    }[];
}>]>;
export type StrategyParseResult = z.infer<typeof StrategyParseResultSchema>;
export declare const RiskDecisionSchema: z.ZodEnum<["ALLOW", "ALLOW_REDUCE_ONLY", "DENY"]>;
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
export declare const RiskReasonSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
}, {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
}>;
export declare const RiskDecisionComputedSchema: z.ZodObject<{
    grossExposureUsd: z.ZodNumber;
    netExposureUsd: z.ZodNumber;
    projectedDrawdownPct: z.ZodNumber;
    notionalImbalancePct: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    grossExposureUsd: number;
    netExposureUsd: number;
    projectedDrawdownPct: number;
    notionalImbalancePct: number;
}, {
    grossExposureUsd: number;
    netExposureUsd: number;
    projectedDrawdownPct: number;
    notionalImbalancePct: number;
}>;
export type RiskDecisionComputed = z.infer<typeof RiskDecisionComputedSchema>;
export declare const RiskDecisionResultSchema: z.ZodObject<{
    decision: z.ZodEnum<["ALLOW", "ALLOW_REDUCE_ONLY", "DENY"]>;
    reasons: z.ZodDefault<z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }>, "many">>;
    correlationId: z.ZodString;
    decisionId: z.ZodString;
    computedAt: z.ZodString;
    computed: z.ZodObject<{
        grossExposureUsd: z.ZodNumber;
        netExposureUsd: z.ZodNumber;
        projectedDrawdownPct: z.ZodNumber;
        notionalImbalancePct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        grossExposureUsd: number;
        netExposureUsd: number;
        projectedDrawdownPct: number;
        notionalImbalancePct: number;
    }, {
        grossExposureUsd: number;
        netExposureUsd: number;
        projectedDrawdownPct: number;
        notionalImbalancePct: number;
    }>;
}, "strip", z.ZodTypeAny, {
    correlationId: string;
    decision: "ALLOW" | "ALLOW_REDUCE_ONLY" | "DENY";
    reasons: {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }[];
    decisionId: string;
    computedAt: string;
    computed: {
        grossExposureUsd: number;
        netExposureUsd: number;
        projectedDrawdownPct: number;
        notionalImbalancePct: number;
    };
}, {
    correlationId: string;
    decision: "ALLOW" | "ALLOW_REDUCE_ONLY" | "DENY";
    decisionId: string;
    computedAt: string;
    computed: {
        grossExposureUsd: number;
        netExposureUsd: number;
        projectedDrawdownPct: number;
        notionalImbalancePct: number;
    };
    reasons?: {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }[] | undefined;
}>;
export type RiskDecisionResult = z.infer<typeof RiskDecisionResultSchema>;
export declare const PublicPnlResponseSchema: z.ZodObject<{
    pnlPct: z.ZodNumber;
    mode: z.ZodEnum<["INIT", "WARMUP", "READY", "IN_TRADE", "REBALANCE", "HALT", "SAFE_MODE"]>;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updatedAt: string;
    pnlPct: number;
    mode: "INIT" | "WARMUP" | "READY" | "IN_TRADE" | "REBALANCE" | "HALT" | "SAFE_MODE";
}, {
    updatedAt: string;
    pnlPct: number;
    mode: "INIT" | "WARMUP" | "READY" | "IN_TRADE" | "REBALANCE" | "HALT" | "SAFE_MODE";
}>;
export type PublicPnlResponse = z.infer<typeof PublicPnlResponseSchema>;
export declare const PublicSnapshotSchema: z.ZodObject<{
    mode: z.ZodEnum<["INIT", "WARMUP", "READY", "IN_TRADE", "REBALANCE", "HALT", "SAFE_MODE"]>;
    pnlPct: z.ZodNumber;
    healthCode: z.ZodEnum<["GREEN", "YELLOW", "RED"]>;
    driftState: z.ZodEnum<["IN_TOLERANCE", "POTENTIAL_DRIFT", "BREACH"]>;
    lastUpdateAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    pnlPct: number;
    mode: "INIT" | "WARMUP" | "READY" | "IN_TRADE" | "REBALANCE" | "HALT" | "SAFE_MODE";
    healthCode: "GREEN" | "YELLOW" | "RED";
    driftState: "IN_TOLERANCE" | "POTENTIAL_DRIFT" | "BREACH";
    lastUpdateAt: string;
}, {
    pnlPct: number;
    mode: "INIT" | "WARMUP" | "READY" | "IN_TRADE" | "REBALANCE" | "HALT" | "SAFE_MODE";
    healthCode: "GREEN" | "YELLOW" | "RED";
    driftState: "IN_TOLERANCE" | "POTENTIAL_DRIFT" | "BREACH";
    lastUpdateAt: string;
}>;
export type PublicSnapshot = z.infer<typeof PublicSnapshotSchema>;
export declare const OperatorStatusSchema: z.ZodObject<{
    mode: z.ZodEnum<["INIT", "WARMUP", "READY", "IN_TRADE", "REBALANCE", "HALT", "SAFE_MODE"]>;
    pnlPct: z.ZodNumber;
    riskConfig: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    activeAgents: z.ZodNumber;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    pnlPct: number;
    mode: "INIT" | "WARMUP" | "READY" | "IN_TRADE" | "REBALANCE" | "HALT" | "SAFE_MODE";
    riskConfig: Record<string, unknown>;
    activeAgents: number;
    timestamp: string;
}, {
    pnlPct: number;
    mode: "INIT" | "WARMUP" | "READY" | "IN_TRADE" | "REBALANCE" | "HALT" | "SAFE_MODE";
    riskConfig: Record<string, unknown>;
    activeAgents: number;
    timestamp: string;
}>;
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>;
export declare const OperatorOrderSchema: z.ZodObject<{
    orderId: z.ZodString;
    symbol: z.ZodString;
    side: z.ZodEnum<["BUY", "SELL"]>;
    status: z.ZodEnum<["NEW", "WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "FAILED"]>;
    notionalUsd: z.ZodNumber;
    filledQty: z.ZodNumber;
    avgFillPx: z.ZodNumber;
    createdAt: z.ZodString;
    source: z.ZodEnum<["SIM", "LIVE"]>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    status: "NEW" | "WORKING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "FAILED";
    source: "SIM" | "LIVE";
    side: "BUY" | "SELL";
    notionalUsd: number;
    orderId: string;
    filledQty: number;
    avgFillPx: number;
    createdAt: string;
}, {
    symbol: string;
    status: "NEW" | "WORKING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "FAILED";
    source: "SIM" | "LIVE";
    side: "BUY" | "SELL";
    notionalUsd: number;
    orderId: string;
    filledQty: number;
    avgFillPx: number;
    createdAt: string;
}>;
export type OperatorOrder = z.infer<typeof OperatorOrderSchema>;
export declare const OperatorPositionSchema: z.ZodObject<{
    symbol: z.ZodString;
    side: z.ZodEnum<["LONG", "SHORT"]>;
    qty: z.ZodNumber;
    notionalUsd: z.ZodNumber;
    avgEntryPx: z.ZodNumber;
    markPx: z.ZodNumber;
    pnlUsd: z.ZodNumber;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    updatedAt: string;
    side: "LONG" | "SHORT";
    notionalUsd: number;
    qty: number;
    avgEntryPx: number;
    markPx: number;
    pnlUsd: number;
}, {
    symbol: string;
    updatedAt: string;
    side: "LONG" | "SHORT";
    notionalUsd: number;
    qty: number;
    avgEntryPx: number;
    markPx: number;
    pnlUsd: number;
}>;
export type OperatorPosition = z.infer<typeof OperatorPositionSchema>;
export declare const OperatorCommandSchema: z.ZodObject<{
    command: z.ZodEnum<["/status", "/positions", "/simulate", "/halt", "/resume", "/flatten", "/explain"]>;
    args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    command: "/status" | "/positions" | "/simulate" | "/halt" | "/resume" | "/flatten" | "/explain";
    args: string[];
    reason: string;
}, {
    command: "/status" | "/positions" | "/simulate" | "/halt" | "/resume" | "/flatten" | "/explain";
    reason: string;
    args?: string[] | undefined;
}>;
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;
export declare const OperatorCommandActorSchema: z.ZodObject<{
    actorType: z.ZodEnum<["human", "internal_agent", "external_agent", "system"]>;
    actorId: z.ZodString;
    requestedAt: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<["operator_view", "operator_admin"]>>;
}, "strip", z.ZodTypeAny, {
    actorType: "human" | "internal_agent" | "external_agent" | "system";
    actorId: string;
    requestedAt?: string | undefined;
    role?: "operator_view" | "operator_admin" | undefined;
}, {
    actorType: "human" | "internal_agent" | "external_agent" | "system";
    actorId: string;
    requestedAt?: string | undefined;
    role?: "operator_view" | "operator_admin" | undefined;
}>;
export type OperatorCommandActor = z.infer<typeof OperatorCommandActorSchema>;
export declare const CommandResultSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    command: z.ZodString;
    message: z.ZodString;
    requestId: z.ZodString;
    payload: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    message: string;
    ok: boolean;
    command: string;
    requestId: string;
    payload?: unknown;
}, {
    message: string;
    ok: boolean;
    command: string;
    requestId: string;
    payload?: unknown;
}>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export declare const EntitlementTierSchema: z.ZodEnum<["tier0", "tier1", "tier2", "tier3"]>;
export type EntitlementTier = z.infer<typeof EntitlementTierSchema>;
export declare const PaymentChallengeSchema: z.ZodObject<{
    challengeId: z.ZodString;
    resource: z.ZodString;
    tier: z.ZodEnum<["tier0", "tier1", "tier2", "tier3"]>;
    nonce: z.ZodString;
    issuedAt: z.ZodString;
    expiresAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    challengeId: string;
    resource: string;
    tier: "tier0" | "tier1" | "tier2" | "tier3";
    nonce: string;
    issuedAt: string;
    expiresAt: string;
}, {
    challengeId: string;
    resource: string;
    tier: "tier0" | "tier1" | "tier2" | "tier3";
    nonce: string;
    issuedAt: string;
    expiresAt: string;
}>;
export type PaymentChallenge = z.infer<typeof PaymentChallengeSchema>;
export declare const PaymentProofSchema: z.ZodObject<{
    challengeId: z.ZodString;
    agentId: z.ZodString;
    tier: z.ZodEnum<["tier0", "tier1", "tier2", "tier3"]>;
    signature: z.ZodString;
    nonce: z.ZodString;
    paidAmountUsd: z.ZodNumber;
    paidAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    signature: string;
    challengeId: string;
    tier: "tier0" | "tier1" | "tier2" | "tier3";
    nonce: string;
    agentId: string;
    paidAmountUsd: number;
    paidAt: string;
}, {
    signature: string;
    challengeId: string;
    tier: "tier0" | "tier1" | "tier2" | "tier3";
    nonce: string;
    agentId: string;
    paidAmountUsd: number;
    paidAt: string;
}>;
export type PaymentProof = z.infer<typeof PaymentProofSchema>;
export declare const EntitlementSchema: z.ZodObject<{
    agentId: z.ZodString;
    tier: z.ZodEnum<["tier0", "tier1", "tier2", "tier3"]>;
    capabilities: z.ZodArray<z.ZodString, "many">;
    expiresAt: z.ZodString;
    quotaRemaining: z.ZodNumber;
    rateLimitPerMinute: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tier: "tier0" | "tier1" | "tier2" | "tier3";
    expiresAt: string;
    agentId: string;
    capabilities: string[];
    quotaRemaining: number;
    rateLimitPerMinute: number;
}, {
    tier: "tier0" | "tier1" | "tier2" | "tier3";
    expiresAt: string;
    agentId: string;
    capabilities: string[];
    quotaRemaining: number;
    rateLimitPerMinute: number;
}>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
export declare const WsMessageSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"sub.add">;
    channel: z.ZodString;
    token: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "sub.add";
    channel: string;
    token?: string | undefined;
}, {
    type: "sub.add";
    channel: string;
    token?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sub.remove">;
    channel: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sub.remove";
    channel: string;
}, {
    type: "sub.remove";
    channel: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"cmd.exec">;
    command: z.ZodString;
    args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "cmd.exec";
    command: string;
    args: string[];
}, {
    type: "cmd.exec";
    command: string;
    args?: string[] | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
}, "strip", z.ZodTypeAny, {
    type: "ping";
}, {
    type: "ping";
}>]>;
export type WsClientMessage = z.infer<typeof WsMessageSchema>;
export declare const WsServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"sub.ack">;
    channel: z.ZodString;
    accepted: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    type: "sub.ack";
    channel: string;
    accepted: boolean;
}, {
    type: "sub.ack";
    channel: string;
    accepted: boolean;
}>, z.ZodObject<{
    type: z.ZodLiteral<"event">;
    channel: z.ZodString;
    payload: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "event";
    channel: string;
    payload?: unknown;
}, {
    type: "event";
    channel: string;
    payload?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"cmd.result">;
    requestId: z.ZodString;
    result: z.ZodObject<{
        ok: z.ZodBoolean;
        command: z.ZodString;
        message: z.ZodString;
        requestId: z.ZodString;
        payload: z.ZodOptional<z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        ok: boolean;
        command: string;
        requestId: string;
        payload?: unknown;
    }, {
        message: string;
        ok: boolean;
        command: string;
        requestId: string;
        payload?: unknown;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "cmd.result";
    requestId: string;
    result: {
        message: string;
        ok: boolean;
        command: string;
        requestId: string;
        payload?: unknown;
    };
}, {
    type: "cmd.result";
    requestId: string;
    result: {
        message: string;
        ok: boolean;
        command: string;
        requestId: string;
        payload?: unknown;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    requestId: z.ZodString;
    code: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    type: "error";
    requestId: string;
}, {
    code: string;
    message: string;
    type: "error";
    requestId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"pong">;
}, "strip", z.ZodTypeAny, {
    type: "pong";
}, {
    type: "pong";
}>]>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export declare const ReplayRequestSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    correlationId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string;
    limit: number;
    correlationId?: string | undefined;
}, {
    from: string;
    to: string;
    correlationId?: string | undefined;
    limit?: number | undefined;
}>;
export declare const RoleSchema: z.ZodEnum<["operator_view", "operator_admin"]>;
export type Role = z.infer<typeof RoleSchema>;
export declare const HttpReplayQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    resource: z.ZodOptional<z.ZodString>;
    correlationId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string;
    limit: number;
    correlationId?: string | undefined;
    resource?: string | undefined;
}, {
    from: string;
    to: string;
    correlationId?: string | undefined;
    resource?: string | undefined;
    limit?: number | undefined;
}>;
export declare const AuditEventSchema: z.ZodObject<{
    id: z.ZodString;
    ts: z.ZodString;
    actorType: z.ZodEnum<["human", "internal_agent", "external_agent", "system"]>;
    actorId: z.ZodString;
    action: z.ZodString;
    resource: z.ZodString;
    correlationId: z.ZodString;
    details: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    hash: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    ts: string;
    correlationId: string;
    actorType: "human" | "internal_agent" | "external_agent" | "system";
    actorId: string;
    details: Record<string, unknown>;
    resource: string;
    action: string;
    hash?: string | undefined;
}, {
    id: string;
    ts: string;
    correlationId: string;
    actorType: "human" | "internal_agent" | "external_agent" | "system";
    actorId: string;
    details: Record<string, unknown>;
    resource: string;
    action: string;
    hash?: string | undefined;
}>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export declare function parseStrategyProposal(candidate: unknown): StrategyParseResult;
