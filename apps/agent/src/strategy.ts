import {
  AgentProposalSchema,
  type AgentProposal,
  type OutcomeMarket,
  type RiskConfig,
  type SentimentItem
} from './contracts'
import { clamp01 } from './math'

export interface AgentContext {
  market: OutcomeMarket
  signals: readonly SentimentItem[]
  exposureUsd: number
  openMarketCount: number
  clusterExposureUsd: number
  riskConfig: RiskConfig
  nowIso?: string
}

export interface StrategyAgent {
  propose(ctx: AgentContext): Promise<AgentProposal | null>
}

export type LlmCompleter = (prompt: string) => Promise<string>

export const DEFAULT_STRATEGIST_PROMPT = `You are an outcome-market trading strategist for Hyperliquid HIP-4.

A binary outcome contract settles 0 or 1. Its trading price in [0,1] is the
market's implied probability of YES. You are given a single market, the
recent raw sentiment items the operator's sources collected, and the
operator's risk knobs + current exposure.

Your job: decide whether the gap between your view and the market is large
enough to trade, and if so, propose a single order. The deterministic risk
engine downstream will clip stake by Kelly + per-market + gross caps and
deny anything thin or out of liquidity. You decide the SHAPE of the trade;
the engine decides whether it survives.

Output ONLY a JSON object on a single line. Two valid shapes:

  {"action": "skip", "reason": "<short reason>"}

  {
    "action": "trade",
    "side": "YES" | "NO",
    "pHat": <number in [0,1] - your probability of YES regardless of side>,
    "sizeUsd": <positive number - your suggested stake in USD>,
    "limitPrice": <number in (0,1) - your limit price for the chosen side>,
    "thesis": "<short rationale, max 500 chars>",
    "signalsConsideredAt": "<ISO timestamp of the freshest signal you cited>"
  }

Pick "skip" liberally. The operator would rather you wait than force a
weak trade. Never invent signals.`

export class LlmStrategyAgent implements StrategyAgent {
  constructor(
    private readonly complete: LlmCompleter,
    private readonly systemPrompt: string = DEFAULT_STRATEGIST_PROMPT
  ) {}

  async propose(ctx: AgentContext): Promise<AgentProposal | null> {
    const prompt = renderPrompt(this.systemPrompt, ctx)
    const text = await this.complete(prompt)
    return parseAgentProposal(text)
  }
}

export function renderPrompt(systemPrompt: string, ctx: AgentContext): string {
  const m = ctx.market
  const items = ctx.signals
    .slice()
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
    .slice(0, 30)
    .map((s, i) => `  [${i + 1}] (${s.source}, ${s.observedAt}) ${s.summary}${s.url ? ` <${s.url}>` : ''}`)
    .join('\n')
  return [
    systemPrompt,
    '',
    `now: ${ctx.nowIso ?? new Date().toISOString()}`,
    `market.id: ${m.id}`,
    `market.question: ${m.question}`,
    `market.status: ${m.status}`,
    `market.yesPrice: ${m.yesPrice}`,
    `market.bookDepthYesUsd: ${m.bookDepthYesUsd}`,
    `market.bookDepthNoUsd: ${m.bookDepthNoUsd}`,
    `market.resolutionAt: ${m.resolutionAt}`,
    `market.topicTags: ${m.topicTags.join(',') || '(none)'}`,
    '',
    `risk.bankrollUsd: ${ctx.riskConfig.bankrollUsd}`,
    `risk.maxStakePerMarketUsd: ${ctx.riskConfig.maxStakePerMarketUsd}`,
    `risk.maxGrossExposureUsd: ${ctx.riskConfig.maxGrossExposureUsd}`,
    `risk.minEdgeBps: ${ctx.riskConfig.minEdgeBps}`,
    `risk.kellyCap: ${ctx.riskConfig.kellyCap}`,
    `risk.maxSentimentAgeSec: ${ctx.riskConfig.maxSentimentAgeSec}`,
    '',
    `exposure.openUsd: ${ctx.exposureUsd}`,
    `exposure.openMarketCount: ${ctx.openMarketCount}`,
    `exposure.clusterUsd: ${ctx.clusterExposureUsd}`,
    '',
    `signals (${ctx.signals.length} total, freshest 30 shown):`,
    items || '  (none)'
  ].join('\n')
}

// Lenient extractor: pulls the last JSON object out of the response. The
// shell completer commonly wraps the JSON in chatter; we grab the deepest
// brace-balanced span and parse it. Returns null on skip / parse failure.
export function parseAgentProposal(text: string): AgentProposal | null {
  const obj = extractJsonObject(text)
  if (!obj) return null
  if ((obj as { action?: string }).action === 'skip') return null
  const candidate = {
    side: (obj as { side?: string }).side,
    pHat: clamp01(Number((obj as { pHat?: unknown }).pHat ?? NaN)),
    sizeUsd: Math.max(0, Number((obj as { sizeUsd?: unknown }).sizeUsd ?? 0)),
    limitPrice: clamp01(Number((obj as { limitPrice?: unknown }).limitPrice ?? NaN)),
    thesis: String((obj as { thesis?: unknown }).thesis ?? '').slice(0, 1000),
    signalsConsideredAt: String(
      (obj as { signalsConsideredAt?: unknown }).signalsConsideredAt ?? ''
    )
  }
  const parsed = AgentProposalSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function extractJsonObject(text: string): unknown {
  let depth = 0
  let start = -1
  let best: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        best = text.slice(start, i + 1)
        start = -1
      }
    }
  }
  if (!best) return null
  try {
    return JSON.parse(best)
  } catch {
    return null
  }
}

// Deterministic agent for tests. Always proposes a configurable shape, or
// skips. Production wires LlmStrategyAgent with a shell completer.
export class FixedAgent implements StrategyAgent {
  constructor(private readonly fn: (ctx: AgentContext) => AgentProposal | null) {}
  async propose(ctx: AgentContext): Promise<AgentProposal | null> {
    return this.fn(ctx)
  }
}
