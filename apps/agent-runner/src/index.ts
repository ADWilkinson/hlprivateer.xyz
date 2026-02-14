import { ulid } from 'ulid'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import type { EventEnvelope, AuditEvent, OperatorPosition, StrategyProposal } from '@hl/privateer-contracts'
import { parseStrategyProposal } from '@hl/privateer-contracts'
import type { PluginSignal } from '@hl/privateer-plugin-sdk'
import { env } from './config'
import { fetchMetaAndAssetCtxs, type HyperliquidUniverseAsset } from './hyperliquid'
import { computePriceFeaturePack, type PriceFeature } from './price-features'
import { createCoinGeckoClient, type CoinGeckoCategorySnapshot, type CoinGeckoMarketSnapshot } from './coingecko'
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

type LlmChoice = 'claude' | 'codex' | 'none'

type FloorRole =
  | 'scout'
  | 'research'
  | 'strategist'
  | 'execution'
  | 'risk'
  | 'scribe'
  | 'ops'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(items.length, concurrency))
  const results: R[] = new Array(items.length)
  let index = 0

  const workers = new Array(limit).fill(0).map(async () => {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) {
        break
      }
      results[current] = await fn(items[current] as T)
    }
  })

  await Promise.all(workers)
  return results
}

function sanitizeLine(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function safeDateMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function msSince(valueMs: number | null, nowMs: number): number | null {
  if (!Number.isFinite(valueMs) || !valueMs) {
    return null
  }
  const ageMs = nowMs - valueMs
  return Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : 0
}

function roleActorId(role: FloorRole): string {
  return `${env.AGENT_ID}:${role}`
}

let codexDisabledUntilMs = 0

function parseCodexUsageLimit(message: string): { summary: string; tryAgainAtMs: number | null } | null {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const usageLine = lines.find((line) => line.includes("You've hit your usage limit for"))
  if (!usageLine) {
    return null
  }

  const normalized = usageLine.replace(/^ERROR:\s*/i, '')
  const match = normalized.match(/Try again at\s+(.+?)\.?$/i)
  if (!match) {
    return { summary: normalized, tryAgainAtMs: null }
  }

  const raw = match[1] ?? ''
  // The CLI message uses ordinal suffixes (e.g. "14th"), which Date.parse won't understand.
  const cleaned = raw.replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1').trim()
  const parsed = Date.parse(cleaned)
  const tryAgainAtMs = Number.isFinite(parsed) ? parsed : null
  return { summary: normalized, tryAgainAtMs }
}

function summarizeCodexError(error: unknown): string {
  const message = String(error ?? '')
  const usage = parseCodexUsageLimit(message)
  if (usage) {
    return sanitizeLine(usage.summary, 200)
  }

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  // Prefer the most specific failure line, when present.
  const lastErrorLine = [...lines].reverse().find((line) => line.startsWith('ERROR:'))
  if (lastErrorLine) {
    return sanitizeLine(lastErrorLine.replace(/^ERROR:\s*/i, ''), 200)
  }

  return sanitizeLine(message, 200)
}

function maybeDisableCodexFromError(error: unknown, nowMs: number): { untilMs: number; reason: string } | null {
  const message = String(error ?? '')
  const usage = parseCodexUsageLimit(message)
  if (!usage) {
    return null
  }

  // Fail-closed: if we can't parse the time, back off briefly to avoid hammering the CLI.
  const untilMs = usage.tryAgainAtMs ?? nowMs + 60_000
  if (untilMs <= codexDisabledUntilMs) {
    return null
  }

  codexDisabledUntilMs = untilMs
  return { untilMs, reason: usage.summary }
}

function llmForRole(role: FloorRole, nowMs = Date.now()): LlmChoice {
  const base = env.AGENT_LLM
  let chosen: LlmChoice = base
  if (role === 'research') {
    chosen = env.AGENT_RESEARCH_LLM ?? base
  } else if (role === 'risk') {
    chosen = env.AGENT_RISK_LLM ?? base
  } else if (role === 'strategist' || role === 'execution') {
    chosen = env.AGENT_STRATEGIST_LLM ?? base
  } else if (role === 'scribe') {
    chosen = env.AGENT_SCRIBE_LLM ?? base
  }

  // Circuit-break Codex when its CLI reports a usage limit to avoid repeated failures.
  if (chosen === 'codex' && codexDisabledUntilMs > nowMs) {
    return 'claude'
  }

  return chosen
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

function bucketNotional(notionalUsd: number): 'XS' | 'S' | 'M' | 'L' | 'XL' {
  const n = Math.abs(notionalUsd)
  if (n < 50) return 'XS'
  if (n < 250) return 'S'
  if (n < 1000) return 'M'
  if (n < 5000) return 'L'
  return 'XL'
}

function renderLegSummary(legs: Array<{ symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number }>): string {
  return legs
    .map((leg) => `${leg.side} ${leg.symbol} [${bucketNotional(leg.notionalUsd)}]`)
    .join(' | ')
}

function computeExecutionTactics(params: { signals: PluginSignal[] }): { expectedSlippageBps: number; maxSlippageBps: number } {
  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const volPct = latestVolatility ? Math.abs(latestVolatility.value) : 0

  // Heuristic: scale expected slippage with volatility; cap at 12 bps expected.
  const expected = clamp(Math.round(2 + volPct * 0.25), 2, 12)
  // Keep max within risk default (20 bps).
  const max = clamp(Math.round(expected * 2), expected, 20)

  return { expectedSlippageBps: expected, maxSlippageBps: max }
}

const BASE_LONG_SYMBOL = 'HYPE'

const COMMON_AGENT_PROMPT_PREAMBLE: string[] = [
  'Core floor rules:',
  `- Objective: maintain LONG ${BASE_LONG_SYMBOL} and SHORT basket-only exposure with market-neutral behavior.`,
  '- Market-neutral execution safety dominates all recommendations.',
  '- No direct order routing or execution control lives in this model; runtime + risk-engine are authoritative.',
  '- If context is stale, contradictory, or incomplete, choose conservative actions.',
  '- Never invent symbols, metrics, or events not present in context.',
  '- Return strictly structured JSON only, no commentary.',
  '- Prioritize stability and avoid unnecessary churn.',
  '- Use latest risk decisions to drive recovery: when a recent DENY cites DRAWDOWN/EXPOSURE/LEVERAGE/SAFE_MODE/DEPENDENCY_FAILURE, require immediate risk-reduction first.',
  '- If risk posture requires reduction, do not scale up notional or propose growth-facing changes.',
  '- Preserve market neutrality and risk budgets: prioritize reduced gross first, then re-enable sizing only after reduced-risk state is confirmed.',
  '- All non-EXIT proposals must state expected gross/notional outcome and never exceed recovery constraints.',
  '- Treat SAFE_MODE and DEPENDENCY_FAILURE as hard-reduce states: request only flat/close actions until state is cleared.',
  '- Use runtime recovery policy context in prompts before proposing growth; execution control is runtime-owned and only risk mitigation command is /flatten.',
  '- Read the floor context memory every cycle: active directive, target risk caps, allocation multipliers, and latest risk/posture tape before sizing any basket leg.',
  '- Keep proposals explicit about leverage and gross/notional impact; avoid growth when risk posture is constrained.'
]

const FLOOR_TAPE_CONTEXT_LINES = 12
const STRATEGY_CONTEXT_MAX_AGE_MS = 120_000

type FloorTapeLine = {
  ts: string
  role: string
  level: 'INFO' | 'WARN' | 'ERROR'
  line: string
}

type FloorTapePromptEntry = {
  role: string
  level: 'INFO' | 'WARN' | 'ERROR'
  ageMs: number | null
  line: string
}

const RISK_RECOVERY_FORCE_EXIT_CODES = new Set([
  'DRAWDOWN',
  'EXPOSURE',
  'LEVERAGE',
  'SAFE_MODE',
  'DEPENDENCY_FAILURE',
  'NOTIONAL_PARITY',
  'SYSTEM_GATED',
  'STALE_DATA',
  'LIQUIDITY',
  'SLIPPAGE_BREACH'
])
const RISK_RECOVERY_TTL_MS = 120_000

type RuntimeRiskReason = {
  code: string
  message: string
  details?: Record<string, unknown>
}

type RuntimeRiskDecision = {
  decision?: 'ALLOW' | 'ALLOW_REDUCE_ONLY' | 'DENY'
  reasons?: RuntimeRiskReason[]
  computedAt?: string
  computed?: {
    grossExposureUsd: number
    netExposureUsd: number
    projectedDrawdownPct: number
    notionalImbalancePct: number
  }
  decisionId?: string
  proposalCorrelation?: string
}

type InterAgentRoleContext = {
  lastRunAtMs: number | null
  ageMs: number | null
  status: 'never' | 'stale' | 'fresh'
  source: 'memory' | 'heartbeat'
}

function summarizeInterAgentContext(nowMs = Date.now()): Record<string, InterAgentRoleContext> {
  const staleThresholdMs = Math.max(STRATEGY_CONTEXT_MAX_AGE_MS, env.AGENT_OPS_INTERVAL_MS * 3)

  const entries: Record<string, InterAgentRoleContext> = {}
  entries.research = toInterAgentRoleContext(lastResearchAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.risk = toInterAgentRoleContext(lastRiskAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.strategist = toInterAgentRoleContext(lastDirectiveAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.scribe = toInterAgentRoleContext(lastAnalysisAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.ops = toInterAgentRoleContext(lastOpsAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.scout = toInterAgentRoleContext(lastProposalPublishedAt, nowMs, staleThresholdMs, 'heartbeat')
  entries.execution = toInterAgentRoleContext(lastProposalPublishedAt, nowMs, staleThresholdMs, 'heartbeat')
  return entries
}

function toInterAgentRoleContext(
  lastAtMs: number,
  nowMs: number,
  staleThresholdMs: number,
  source: 'memory' | 'heartbeat'
): InterAgentRoleContext {
  const ageMs = msSince(lastAtMs, nowMs)
  if (ageMs === null) {
    return { lastRunAtMs: null, ageMs: null, status: 'never', source }
  }
  return {
    lastRunAtMs: lastAtMs,
    ageMs,
    status: ageMs > staleThresholdMs ? 'stale' : 'fresh',
    source
  }
}

const floorTapeHistory: FloorTapeLine[] = []

function compactReportFields(report: unknown, keep: readonly string[]): Record<string, unknown> | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return null
  }

  const source = report as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of keep) {
    if (!(key in source)) {
      continue
    }
    const value = source[key]
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 4)
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, 260)
    } else {
      out[key] = value
    }
  }
  return out
}

type LatestSignalEntry = {
  pluginId: string
  value: number
  ts: string
  ageMs: number | null
}

function summarizeLatestSignals(nowMs = Date.now()): Record<string, LatestSignalEntry[]> {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now()
  const latest: Record<string, LatestSignalEntry[]> = {}

  for (const signal of latestSignals.values()) {
    if (typeof signal.signalType !== 'string' || !Number.isFinite(signal.value)) {
      continue
    }

    const tsMs = safeDateMs(signal.ts)
    if (tsMs === null) {
      continue
    }
    const entries = latest[signal.signalType] ?? []
    entries.push({
      pluginId: String(signal.pluginId ?? 'unknown'),
      value: Number(signal.value),
      ts: typeof signal.ts === 'string' ? signal.ts : new Date(tsMs).toISOString(),
      ageMs: msSince(tsMs, safeNowMs)
    })
    latest[signal.signalType] = entries
  }

  const out: Record<string, LatestSignalEntry[]> = {}
  for (const [signalType, entries] of Object.entries(latest)) {
    out[signalType] = entries
      .map((entry) => ({ ...entry }))
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, 3)
  }
  return out
}

function latestSignalFromPack(
  signals: Record<string, LatestSignalEntry[]>,
  signalType: string
): { value: number; ts: string } | null {
  const latest = signals[signalType]?.[0]
  if (!latest || !Number.isFinite(latest.value)) {
    return null
  }
  return {
    value: latest.value,
    ts: latest.ts
  }
}

function summarizePositionsForPrompt(positions: OperatorPosition[]): {
  count: number
  symbols: string[]
  longNotionalUsd: number
  shortNotionalUsd: number
  grossNotionalUsd: number
  netNotionalUsd: number
  drift: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'
  posture: 'GREEN' | 'AMBER' | 'RED'
  topPositions: Array<{
    symbol: string
    side: 'LONG' | 'SHORT'
    notionalBucket: string
    absNotionalUsd: number
  }>
} {
  const drift = summarizePositionsForAgents(positions)
  let longNotionalUsd = 0
  let shortNotionalUsd = 0

  const topPositions = positions
    .filter((position) => Number.isFinite(position.notionalUsd))
    .map((position) => {
      const side = position.side
      const absNotionalUsd = Math.abs(position.notionalUsd)
      if (side === 'LONG') {
        longNotionalUsd += absNotionalUsd
      } else {
        shortNotionalUsd += absNotionalUsd
      }

      return {
        symbol: String(position.symbol ?? '').toUpperCase(),
        side,
        notionalBucket: bucketNotional(absNotionalUsd),
        absNotionalUsd: Number(absNotionalUsd.toFixed(2))
      }
    })
    .sort((a, b) => b.absNotionalUsd - a.absNotionalUsd)
    .slice(0, 12)

  return {
    count: positions.length,
    symbols: [...new Set(positions.map((position) => String(position.symbol ?? '').toUpperCase()))].sort(),
    longNotionalUsd: Number(longNotionalUsd.toFixed(2)),
    shortNotionalUsd: Number(shortNotionalUsd.toFixed(2)),
    grossNotionalUsd: Number((longNotionalUsd + shortNotionalUsd).toFixed(2)),
    netNotionalUsd: Number((longNotionalUsd - shortNotionalUsd).toFixed(2)),
    drift: drift.drift,
    posture: drift.posture,
    topPositions
  }
}

function summarizeFloorTapeForPrompt(nowMs = Date.now()): FloorTapePromptEntry[] {
  return floorTapeHistory.map((entry) => ({
    role: entry.role,
    level: entry.level,
    ageMs: msSince(safeDateMs(entry.ts) ?? nowMs, nowMs),
    line: entry.line
  }))
}

function summarizeProposalForContext(proposal: StrategyProposal | null): Record<string, unknown> | null {
  if (!proposal) {
    return null
  }

  const firstAction = proposal.actions?.[0]
  return {
    proposalId: proposal.proposalId,
    summary: proposal.summary,
    actionType: firstAction?.type,
    confidence: proposal.confidence,
    requestedMode: proposal.requestedMode,
    rationale: firstAction?.rationale,
    expectedSlippageBps: firstAction?.expectedSlippageBps,
    maxSlippageBps: firstAction?.maxSlippageBps
  }
}

function ageBucket(ms: number | null): 'fresh' | 'aging' | 'stale' | 'absent' {
  if (ms === null) {
    return 'absent'
  }
  if (ms <= 30_000) {
    return 'fresh'
  }
  if (ms <= 120_000) {
    return 'aging'
  }
  return 'stale'
}

function summarizeActiveBasketContext(context: BasketSelection['context'] | undefined): Record<string, unknown> | null {
  if (!context) {
    return null
  }

  return {
    featureWindowMin: context.featureWindowMin,
    hasPriceBase: !!context.priceBase,
    priceSymbols: Object.keys(context.priceBySymbol ?? {}).sort().slice(0, 12),
    coingecko: context.coingecko
      ? {
        enabled: true,
        coveragePct: context.coingecko.coveragePct,
        sectorTopGainers: (context.coingecko.sectorTopGainers ?? []).slice(0, 3),
        sectorTopLosers: (context.coingecko.sectorTopLosers ?? []).slice(0, 3)
      }
      : null
  }
}

const PROMPT_CONTEXT_MAX_CHARS = 9000

function toPromptPayload(value: unknown): string {
  const raw = JSON.stringify(value)
  if (raw.length <= PROMPT_CONTEXT_MAX_CHARS) {
    return raw
  }

  const fallback = {
    truncated: true,
    length: raw.length,
    limit: PROMPT_CONTEXT_MAX_CHARS,
    payload: raw.slice(0, Math.max(0, PROMPT_CONTEXT_MAX_CHARS - 200))
  }
  return JSON.stringify(fallback)
}

function buildCrewFloorContext(nowMs = Date.now()): Record<string, unknown> {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const signals = summarizeLatestSignals(now)
  const marketUniverse = [BASE_LONG_SYMBOL, ...activeBasket.basketSymbols]
  const marketFeed = tickStalenessMs(marketUniverse)
  const signalAges = Object.values(signals)
    .flatMap((entries) => entries.map((entry) => entry.ageMs ?? null))
    .filter((entry): entry is number => entry !== null)

  const freshSignalAges = signalAges.filter((ageMs) => ageMs <= 30_000).length
  const staleSignalAges = signalAges.filter((ageMs) => ageMs > 120_000).length

  const basketAgeMs = msSince(Date.parse(activeBasket.selectedAt), now)

  return {
    objective: `LONG ${BASE_LONG_SYMBOL} vs SHORT basket exposure, deterministic market-neutral + risk-first execution.`,
    generatedAt: new Date(now).toISOString(),
    mode: lastMode,
    requestedMode: requestedModeFromEnv(),
    stateUpdate: lastStateUpdate ?? null,
    risk: {
      autoHaltActive,
      autoHaltHealthySinceMs: autoHaltHealthySinceMs > 0 ? now - autoHaltHealthySinceMs : 0,
      lastRiskDecision
    },
    market: {
      universe: marketUniverse,
      tickAgeMs: marketFeed.maxAgeMs,
      missingTickSymbols: marketFeed.missing,
      stalenessBucket: ageBucket(marketFeed.maxAgeMs),
      signalCoverage: {
        signalTypes: Object.keys(signals).length,
        latestSignalCount: signalAges.length,
        freshSignalCount: freshSignalAges,
        staleSignalCount: staleSignalAges
      }
    },
    signals: signals,
    positions: summarizePositionsForPrompt(lastPositions),
    directive: activeDirective,
    basket: {
      symbols: activeBasket.basketSymbols,
      rationale: activeBasket.rationale,
      selectedAt: activeBasket.selectedAt,
      ageMs: basketAgeMs,
      ageBucket: ageBucket(basketAgeMs),
      context: summarizeActiveBasketContext(activeBasket.context)
    },
    pivot:
      basketPivot === null
        ? null
    : {
        startedAt: new Date(basketPivot.startedAtMs).toISOString(),
        expiresAt: new Date(basketPivot.expiresAtMs).toISOString(),
        remainingMs: basketPivot.expiresAtMs - Date.now(),
        symbols: basketPivot.basketSymbols
      },
    floorAgents: {
      heartbeatMs: STRATEGY_CONTEXT_MAX_AGE_MS,
      roles: summarizeInterAgentContext(now),
      lastReports: {
        research: compactReportFields(lastResearchReport, ['headline', 'regime', 'recommendation', 'confidence', 'computedAt']),
        risk: compactReportFields(lastRiskReport, ['headline', 'posture', 'risks', 'confidence', 'computedAt']),
        scribe: compactReportFields(lastScribeAnalysis, ['headline', 'thesis', 'risks', 'confidence', 'computedAt']),
        strategistDirective: {
          decision: activeDirective.decision,
          confidence: activeDirective.confidence,
          decidedAt: activeDirective.decidedAt,
          rationale: activeDirective.rationale,
          targetNotionalMultiplier: activeDirective.targetNotionalMultiplier
        },
        latestProposal: summarizeProposalForContext(lastProposal)
      },
      tape: summarizeFloorTapeForPrompt(now).slice(-FLOOR_TAPE_CONTEXT_LINES)
    },
    memory: {
      lastProposal: lastProposal
        ? {
          proposalId: lastProposal.proposalId,
          actionType: lastProposal.actions?.[0]?.type,
          summary: lastProposal.summary,
          requestedMode: lastProposal.requestedMode,
          confidence: lastProposal.confidence
        }
        : null,
      research: compactReportFields(lastResearchReport, ['headline', 'regime', 'recommendation', 'confidence', 'computedAt']),
      risk: compactReportFields(lastRiskReport, ['headline', 'posture', 'risks', 'confidence', 'computedAt']),
      scribe: compactReportFields(lastScribeAnalysis, ['headline', 'thesis', 'risks', 'confidence', 'computedAt'])
    },
    governance: {
      basketSize: env.AGENT_BASKET_SIZE,
      featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
      targetNotionalUsd: env.BASKET_TARGET_NOTIONAL_USD,
      notionalBounds: {
        min: env.AGENT_NOTIONAL_MULTIPLIER_MIN,
        max: env.AGENT_NOTIONAL_MULTIPLIER_MAX
      },
      riskLimits: {
        maxLeverage: env.RISK_MAX_LEVERAGE,
        maxDrawdownPct: env.RISK_MAX_DRAWDOWN_PCT,
        maxExposureUsd: env.RISK_MAX_NOTIONAL_USD,
        maxSlippageBps: env.RISK_MAX_SLIPPAGE_BPS,
        staleDataMs: env.RISK_STALE_DATA_MS,
        liquidityBufferPct: env.RISK_LIQUIDITY_BUFFER_PCT,
        notionalParityTolerance: env.RISK_NOTIONAL_PARITY_TOLERANCE
      },
      runtimeRecovery: {
        automaticExitSignal: 'AUTO_EXIT when risk decisions block with DRAWDOWN/EXPOSURE/LEVERAGE/SAFE_MODE/DEPENDENCY_FAILURE/LIQUIDITY/STALE_DATA/SYSTEM_GATED',
        defaultRecoveryCommand: '/flatten'
      }
    }
  }
}

const EXIT_NOTIONAL_EPSILON_USD = 0

function parseRiskReasonCodes(decision: RuntimeRiskDecision | null): string[] {
  if (!decision || !Array.isArray(decision.reasons)) {
    return []
  }

  return decision.reasons
    .map((entry) => String(entry?.code ?? '').trim().toUpperCase())
    .filter((code) => code.length > 0)
}

function shouldForceRiskRecovery(nowMs: number, positions: OperatorPosition[]): {
  active: boolean
  signature: string
  reasonCodes: string[]
  computed: RuntimeRiskDecision['computed'] | undefined
  reasonMessage: string
} {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  if (!lastRiskDecision || lastRiskDecision.decision !== 'DENY' || !lastRiskDecision.computedAt) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  const parsedAt = Date.parse(lastRiskDecision.computedAt)
  if (!Number.isFinite(parsedAt) || !Number.isFinite(nowMs - parsedAt) || nowMs - parsedAt > RISK_RECOVERY_TTL_MS) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  const reasonCodes = parseRiskReasonCodes(lastRiskDecision)
  const hasBlockingCode = reasonCodes.some((code) => RISK_RECOVERY_FORCE_EXIT_CODES.has(code))
  if (!hasBlockingCode) {
    return { active: false, signature: '', reasonCodes: [], computed: undefined, reasonMessage: '' }
  }

  const signature = reasonCodes.slice().sort().join('|')
  return {
    active: true,
    signature,
    reasonCodes,
    computed: lastRiskDecision.computed,
    reasonMessage: `risk denied for ${reasonCodes.join(', ')}`
  }
}

function buildAgentPrompt(params: {
  role: string
  mission: string
  rules: readonly string[]
  schemaHint: string
  context: Record<string, unknown>
}): string {
  const nowMs = Date.now()
  return [
    `You are HL Privateer ${params.role}.`,
    `Mission: ${params.mission}`,
    '',
    ...COMMON_AGENT_PROMPT_PREAMBLE,
    '',
    'Role-specific constraints:',
    ...params.rules.map((rule) => `- ${rule}`),
    '',
    params.schemaHint,
    '',
    `BUILD_CONTEXT_MS=${nowMs}`,
    `FLOOR_CONTEXT=${toPromptPayload(buildCrewFloorContext(nowMs))}`,
    `TASK_CONTEXT=${toPromptPayload(params.context)}`
  ].join('\n')
}

const coinGeckoApiKey = env.COINGECKO_API_KEY?.trim()
const coinGecko = coinGeckoApiKey
  ? createCoinGeckoClient({
    apiKey: coinGeckoApiKey,
    baseUrl: env.COINGECKO_BASE_URL,
    timeoutMs: env.COINGECKO_TIMEOUT_MS
  })
  : null

type BasketCandidate = {
  symbol: string
  maxLeverage: number
  dayNtlVlmUsd: number
  openInterest: number
  openInterestUsd: number
  funding: number
  premium: number
  markPx: number
}

type BasketSelection = {
  basketSymbols: string[]
  rationale: string
  selectedAt: string
  context?: {
    featureWindowMin: number
    priceBase: PriceFeature | null
    priceBySymbol: Record<string, PriceFeature>
    coingecko?: {
      marketsBySymbol: Record<string, CoinGeckoMarketSnapshot>
      coinCategoriesBySymbol: Record<string, string[]>
      sectorTopLosers: Array<{ name: string; marketCapChange24hPct: number | null }>
      sectorTopGainers: Array<{ name: string; marketCapChange24hPct: number | null }>
      coveragePct: number
    }
  }
}

type StrategistDirectiveDecision = 'MAINTAIN' | 'ROTATE' | 'EXIT'

type StrategistDirective = {
  decision: StrategistDirectiveDecision
  targetNotionalMultiplier: number
  rationale: string
  confidence: number
  decidedAt: string
}

function defaultBasketFromEnv(): string[] {
  return env.BASKET_SYMBOLS
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== BASE_LONG_SYMBOL)
}

function basketFromPositions(positions: OperatorPosition[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const position of positions) {
    const symbol = String(position.symbol ?? '').trim()
    if (!symbol) continue
    if (symbol.toUpperCase() === BASE_LONG_SYMBOL) continue

    const key = symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(symbol)
  }

  // Stable ordering keeps audits/tape consistent across cycles.
  out.sort((a, b) => a.localeCompare(b))
  return out
}

function sameBasket(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].toUpperCase() !== right[i].toUpperCase()) return false
  }
  return true
}

function syncActiveBasketFromPositions(positions: OperatorPosition[]): void {
  if (positions.length === 0) {
    return
  }

  if (basketPivot) {
    const nowMs = Date.now()
    if (nowMs < basketPivot.expiresAtMs) {
      return
    }
    basketPivot = null
  }

  const heldBasket = basketFromPositions(positions)
  if (heldBasket.length === 0) {
    return
  }

  if (sameBasket(activeBasket.basketSymbols, heldBasket)) {
    return
  }

  activeBasket = {
    basketSymbols: heldBasket,
    rationale: 'synced from live positions',
    selectedAt: new Date().toISOString()
  }
}

let activeBasket: BasketSelection = {
  basketSymbols: defaultBasketFromEnv(),
  rationale: 'seeded from env',
  selectedAt: new Date(0).toISOString()
}
let activeDirective: StrategistDirective = {
  decision: 'MAINTAIN',
  targetNotionalMultiplier: 1,
  rationale: 'default directive',
  confidence: 0.3,
  decidedAt: new Date(0).toISOString()
}
let basketSelectInFlight = false
let directiveInFlight = false
let lastExitProposalSignature: string | null = null
let cachedUniverse: { assets: HyperliquidUniverseAsset[]; fetchedAtMs: number } = { assets: [], fetchedAtMs: 0 }
let basketPivot: { basketSymbols: string[]; startedAtMs: number; expiresAtMs: number } | null = null

async function fetchUniverseAssetsCached(nowMs: number): Promise<HyperliquidUniverseAsset[]> {
  // Keep a short cache to avoid hammering the info endpoint.
  if (cachedUniverse.assets.length > 0 && nowMs - cachedUniverse.fetchedAtMs < 60_000) {
    return cachedUniverse.assets
  }

  const assets = await fetchMetaAndAssetCtxs(env.HL_INFO_URL)
  cachedUniverse = { assets, fetchedAtMs: nowMs }
  return assets
}

function buildBasketCandidates(params: {
  assets: HyperliquidUniverseAsset[]
  perLegShortNotionalUsd: number
  basketSize: number
}): BasketCandidate[] {
  const all = params.assets
    .filter((asset) => asset.symbol && !asset.isDelisted)
    .filter((asset) => asset.symbol.toUpperCase() !== BASE_LONG_SYMBOL)
    .map((asset) => ({
      symbol: asset.symbol,
      maxLeverage: asset.maxLeverage,
      dayNtlVlmUsd: asset.dayNtlVlmUsd,
      openInterest: asset.openInterest,
      openInterestUsd: asset.openInterest > 0 && asset.markPx > 0 ? asset.openInterest * asset.markPx : 0,
      funding: asset.funding,
      premium: asset.premium,
      markPx: asset.markPx
    }))
    .filter((asset) => Number.isFinite(asset.dayNtlVlmUsd) && asset.dayNtlVlmUsd > 0)
    .sort((a, b) => b.dayNtlVlmUsd - a.dayNtlVlmUsd)

  const minDayNtlVlmUsd = Math.max(0, params.perLegShortNotionalUsd) * 100
  const filtered = minDayNtlVlmUsd > 0 ? all.filter((asset) => asset.dayNtlVlmUsd >= minDayNtlVlmUsd) : all

  // If we filter too aggressively for the configured size, fall back to the raw top-of-book list.
  const pool = filtered.length >= params.basketSize ? filtered : all
  return pool.slice(0, env.AGENT_BASKET_CANDIDATE_LIMIT)
}

function deterministicBasketFallback(candidates: BasketCandidate[], size: number): string[] {
  return candidates
    .filter((candidate) => candidate.symbol.toUpperCase() !== BASE_LONG_SYMBOL)
    .slice(0, Math.max(1, size))
    .map((candidate) => candidate.symbol)
}

async function generateBasketSelection(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ basketSymbols: string[]; rationale: string }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      basketSymbols: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
      rationale: { type: 'string' }
    },
    required: ['basketSymbols', 'rationale']
  } as const

  if (params.llm === 'none') {
    return {
      basketSymbols: [],
      rationale: 'llm disabled'
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'basket-selector',
      mission: `Select the short basket for the next ${BASE_LONG_SYMBOL}-hedged relative value cycle.`,
      rules: [
        'Choose ONLY from the provided candidate symbols.',
        `Do NOT include ${BASE_LONG_SYMBOL}.`,
        'Prefer high liquidity (day notional volume + open interest).',
        'Prefer candidates with positive or neutral funding (all else equal).',
        `Prefer baskets with lower relative drift and higher correlation to ${BASE_LONG_SYMBOL}.`,
        'Use CoinGecko context only when present, especially coverage and sector drift.',
        'Prefer diversified, liquid selections over concentrated micro-cap names.',
        'If context is weak, keep a conservative, stable basket.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: {
        ...params.input,
        activeDirective: activeDirective
      }
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  return {
    basketSymbols: Array.isArray(raw.basketSymbols) ? raw.basketSymbols.map((s) => String(s)).slice(0, 12) : [],
    rationale: String(raw.rationale ?? '').slice(0, 600)
  }
}

function validateBasketSelection(params: { requested: string[]; allowed: BasketCandidate[]; size: number }): string[] {
  const allowedByUpper = new Map<string, string>()
  for (const candidate of params.allowed) {
    allowedByUpper.set(candidate.symbol.toUpperCase(), candidate.symbol)
  }

  const picked: string[] = []
  for (const raw of params.requested) {
    const upper = String(raw).trim().toUpperCase()
    if (!upper || upper === BASE_LONG_SYMBOL) {
      continue
    }
    const canonical = allowedByUpper.get(upper)
    if (!canonical) {
      continue
    }
    if (picked.some((sym) => sym.toUpperCase() === canonical.toUpperCase())) {
      continue
    }
    picked.push(canonical)
    if (picked.length >= params.size) {
      break
    }
  }

  return picked
}

async function maybeSelectBasket(params: {
  targetNotionalUsd: number
  signals: PluginSignal[]
  positions: OperatorPosition[]
  force?: boolean
}): Promise<void> {
  const nowMs = Date.now()
  if (basketSelectInFlight) {
    return
  }
  if (params.positions.length > 0 && !params.force) {
    return
  }

  const needsRefresh =
    params.force ||
    activeBasket.basketSymbols.length !== env.AGENT_BASKET_SIZE ||
    nowMs - Date.parse(activeBasket.selectedAt) > env.AGENT_BASKET_REFRESH_MS
  if (!needsRefresh) {
    return
  }

  basketSelectInFlight = true
  try {
    const universe = await fetchUniverseAssetsCached(nowMs)
    const perLegShortNotionalUsd = Number((params.targetNotionalUsd / Math.max(1, env.AGENT_BASKET_SIZE)).toFixed(2))
    const candidates = buildBasketCandidates({
      assets: universe,
      perLegShortNotionalUsd,
      basketSize: env.AGENT_BASKET_SIZE
    })
    const fallback = deterministicBasketFallback(candidates, env.AGENT_BASKET_SIZE)

    const candidateSymbols = candidates.map((candidate) => candidate.symbol)
    const pricePack = await computePriceFeaturePack({
      infoUrl: env.HL_INFO_URL,
      baseSymbol: BASE_LONG_SYMBOL,
      symbols: candidateSymbols,
      windowMin: env.AGENT_FEATURE_WINDOW_MIN,
      interval: '1m',
      timeoutMs: 1500,
      concurrency: env.AGENT_FEATURE_CONCURRENCY
    })

    let cgMarketsBySymbol: Record<string, CoinGeckoMarketSnapshot> = {}
    let cgIdsBySymbol: Record<string, string> = {}
    let cgSectorTopLosers: Array<{ name: string; marketCapChange24hPct: number | null }> = []
    let cgSectorTopGainers: Array<{ name: string; marketCapChange24hPct: number | null }> = []
    let cgCoveragePct = 0

    if (coinGecko) {
      try {
        const concurrency = Math.min(env.AGENT_FEATURE_CONCURRENCY, 4)
        const resolved = await mapWithConcurrency(candidateSymbols, concurrency, async (symbol) => {
          const id = await coinGecko.getCoinIdForSymbol(symbol)
          return { symbol, id }
        })

        for (const entry of resolved) {
          if (entry?.id) {
            cgIdsBySymbol[entry.symbol] = entry.id
          }
        }

        const ids = [...new Set(Object.values(cgIdsBySymbol))]
        const markets = await coinGecko.fetchMarkets(ids)
        const marketById = new Map<string, CoinGeckoMarketSnapshot>()
        for (const market of markets) {
          marketById.set(market.id, market)
        }

        for (const [symbol, id] of Object.entries(cgIdsBySymbol)) {
          const market = marketById.get(id)
          if (market) {
            cgMarketsBySymbol[symbol] = market
          }
        }

        cgCoveragePct = candidateSymbols.length > 0 ? (Object.keys(cgMarketsBySymbol).length / candidateSymbols.length) * 100 : 0

        try {
          const categories = await coinGecko.fetchCategories()
          const withChange = categories.filter(
            (category) => typeof category.marketCapChange24hPct === 'number' && Number.isFinite(category.marketCapChange24hPct)
          )
          withChange.sort((a, b) => (a.marketCapChange24hPct ?? 0) - (b.marketCapChange24hPct ?? 0))
          cgSectorTopLosers = withChange
            .slice(0, 5)
            .map((category) => ({ name: category.name, marketCapChange24hPct: category.marketCapChange24hPct }))
          cgSectorTopGainers = withChange
            .slice(Math.max(0, withChange.length - 5))
            .reverse()
            .map((category) => ({ name: category.name, marketCapChange24hPct: category.marketCapChange24hPct }))
        } catch {
          // optional
        }
      } catch {
        cgMarketsBySymbol = {}
        cgIdsBySymbol = {}
        cgCoveragePct = 0
      }
    }

    const candidatesForLlm = candidates.map((candidate) => ({
      ...candidate,
      hist: pricePack.bySymbol[candidate.symbol] ?? null,
      cg: cgMarketsBySymbol[candidate.symbol] ?? null
    }))
    const signalPack = summarizeLatestSignals(nowMs)
    const latestBasketSignals = {
      volatility: latestSignalFromPack(signalPack, 'volatility')?.value ?? null,
      correlation: latestSignalFromPack(signalPack, 'correlation')?.value ?? null,
      funding: latestSignalFromPack(signalPack, 'funding')?.value ?? null
    }

    const input = {
      ts: new Date().toISOString(),
      mode: lastMode,
      basketSize: env.AGENT_BASKET_SIZE,
      targetNotionalUsd: params.targetNotionalUsd,
      perLegShortNotionalUsd,
      candidateFilter: {
        // Pre-filter candidates by daily notional volume as a rough proxy for tradability at size.
        minDayNtlVlmUsd: Number((Math.max(0, perLegShortNotionalUsd) * 100).toFixed(2))
      },
      featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
      priceBase: pricePack.base,
      coingecko: coinGecko
        ? {
          enabled: true,
          coveragePct: Number(cgCoveragePct.toFixed(1)),
          sectorTopLosers: cgSectorTopLosers,
          sectorTopGainers: cgSectorTopGainers
        }
        : { enabled: false },
      candidates: candidatesForLlm,
      signals: {
        all: signalPack,
        latest: latestBasketSignals
      }
    }

    const llm = llmForRole('strategist', nowMs)
    const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

    let chosen: { basketSymbols: string[]; rationale: string }
    try {
      chosen = await generateBasketSelection({ llm, model, input })
    } catch (primaryError) {
      if (llm === 'codex') {
        try {
          chosen = await generateBasketSelection({ llm: 'claude', model: env.CLAUDE_MODEL, input })
          const disabled = maybeDisableCodexFromError(primaryError, nowMs)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `basket codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
          })
        } catch (fallbackError) {
          chosen = { basketSymbols: fallback, rationale: `deterministic fallback: ${String(fallbackError).slice(0, 120)}` }
        }
      } else {
        chosen = { basketSymbols: fallback, rationale: `deterministic fallback: ${String(primaryError).slice(0, 120)}` }
      }
    }

    const validated = validateBasketSelection({ requested: chosen.basketSymbols, allowed: candidates, size: env.AGENT_BASKET_SIZE })
    const finalBasket = validated.length === env.AGENT_BASKET_SIZE ? validated : fallback

    const priceBySymbol: Record<string, PriceFeature> = {}
    for (const symbol of finalBasket) {
      const feature = pricePack.bySymbol[symbol]
      if (feature) {
        priceBySymbol[symbol] = feature
      }
    }

    const cgMarketsSelected: Record<string, CoinGeckoMarketSnapshot> = {}
    for (const symbol of finalBasket) {
      const market = cgMarketsBySymbol[symbol]
      if (market) {
        cgMarketsSelected[symbol] = market
      }
    }

    const cgCoinCategoriesBySymbol: Record<string, string[]> = {}
    if (coinGecko) {
      const tasks = finalBasket
        .map((symbol) => ({ symbol, id: cgIdsBySymbol[symbol] }))
        .filter((task): task is { symbol: string; id: string } => Boolean(task.id))

      const rows = await mapWithConcurrency(tasks, Math.min(tasks.length, 3), async (task) => ({
        symbol: task.symbol,
        categories: await coinGecko.fetchCoinCategories(task.id)
      }))

      for (const row of rows) {
        if (row.categories.length > 0) {
          cgCoinCategoriesBySymbol[row.symbol] = row.categories
        }
      }
    }

    activeBasket = {
      basketSymbols: finalBasket,
      rationale: chosen.rationale || 'selected',
      selectedAt: new Date().toISOString(),
      context: {
        featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
        priceBase: pricePack.base,
        priceBySymbol,
        coingecko: coinGecko
          ? {
            marketsBySymbol: cgMarketsSelected,
            coinCategoriesBySymbol: cgCoinCategoriesBySymbol,
            sectorTopLosers: cgSectorTopLosers,
            sectorTopGainers: cgSectorTopGainers,
            coveragePct: Number(cgCoveragePct.toFixed(1))
          }
          : undefined
      }
    }

    void maybePublishWatchlist({ symbols: [BASE_LONG_SYMBOL, ...activeBasket.basketSymbols], reason: 'basket selected' }).catch(() => undefined)

    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      line: `basket selected: ${activeBasket.basketSymbols.join(',')} (size=${activeBasket.basketSymbols.length})`
    })

    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'basket.selected',
      resource: 'agent.basket',
      correlationId: ulid(),
      details: {
        basketSymbols: activeBasket.basketSymbols,
        rationale: activeBasket.rationale,
        targetNotionalUsd: params.targetNotionalUsd,
        candidateCount: candidates.length,
        context: activeBasket.context
      }
    })
  } catch (error) {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'WARN',
      line: `basket selection failed: ${String(error).slice(0, 140)}`
    })
  } finally {
    basketSelectInFlight = false
  }
}

function signedNotionalBySymbol(positions: OperatorPosition[]): Map<string, number> {
  const currentBySymbol = new Map<string, number>()
  for (const position of positions) {
    const signed = position.side === 'LONG' ? Math.abs(position.notionalUsd) : -Math.abs(position.notionalUsd)
    currentBySymbol.set(position.symbol, (currentBySymbol.get(position.symbol) ?? 0) + signed)
  }
  return currentBySymbol
}

function buildFlatSignature(positions: OperatorPosition[]): string {
  const rows = positions
    .filter((position) => Number.isFinite(position.notionalUsd) && Math.abs(position.notionalUsd) >= EXIT_NOTIONAL_EPSILON_USD)
    .map((position) => ({
      symbol: String(position.symbol).toUpperCase(),
      side: position.side,
      qtyBucket: Number((Math.round(Math.abs(position.qty) * 10000) / 10000).toFixed(4))
    }))
    .sort((a, b) => {
      const symbolCmp = a.symbol.localeCompare(b.symbol)
      if (symbolCmp !== 0) {
        return symbolCmp
      }
      return a.side.localeCompare(b.side)
    })

  if (rows.length === 0) {
    return 'FLAT'
  }

  return rows.map((row) => `${row.symbol}:${row.side}:${row.qtyBucket.toFixed(4)}`).join('|')
}

function buildTargetProposal(params: {
  createdBy: string
  basketSymbols: string[]
  targetNotionalUsd: number
  positions: OperatorPosition[]
  signals: PluginSignal[]
  requestedMode: 'SIM' | 'LIVE'
  executionTactics: { expectedSlippageBps: number; maxSlippageBps: number }
  confidence?: number
  rationale?: string
  summaryPrefix?: string
}): StrategyProposal | null {
  const basketSymbols = params.basketSymbols
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== BASE_LONG_SYMBOL)

  if (basketSymbols.length === 0) {
    return null
  }

  const desiredBySymbol = new Map<string, number>()
  desiredBySymbol.set(BASE_LONG_SYMBOL, params.targetNotionalUsd)
  const perBasket = params.targetNotionalUsd / basketSymbols.length
  for (const symbol of basketSymbols) {
    desiredBySymbol.set(symbol, -perBasket)
  }

  // Any currently-held symbols not in the desired set must be closed (target=0),
  // enabling mid-trade basket pivots without leaving dangling legs.
  for (const position of params.positions) {
    if (!desiredBySymbol.has(position.symbol)) {
      desiredBySymbol.set(position.symbol, 0)
    }
  }

  const currentBySymbol = signedNotionalBySymbol(params.positions)
  const minLegUsd = Math.max(25, params.targetNotionalUsd * 0.01)
  const deltas = [...desiredBySymbol.entries()]
    .map(([symbol, desiredNotional]) => {
      const current = currentBySymbol.get(symbol) ?? 0
      const delta = desiredNotional - current
      if (!Number.isFinite(delta) || Math.abs(delta) < minLegUsd) {
        return null
      }
      const side: 'BUY' | 'SELL' = delta > 0 ? 'BUY' : 'SELL'
      const notionalUsd = Number(Math.abs(delta).toFixed(2))
      const reduces =
        (current > 0 && side === 'SELL') ||
        (current < 0 && side === 'BUY')
      return { symbol, side, notionalUsd, reduces }
    })
    .filter((leg): leg is { symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number; reduces: boolean } => Boolean(leg))

  if (deltas.length === 0) {
    return null
  }

  // Place reducing legs first to minimize transient gross exposure and to work well under reduce-only risk mode.
  deltas.sort((a, b) => {
    if (a.reduces !== b.reduces) return a.reduces ? -1 : 1
    return a.symbol.localeCompare(b.symbol)
  })

  const legs = deltas.map(({ symbol, side, notionalUsd }) => ({ symbol, side, notionalUsd }))

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

  const actionType = params.positions.length > 0 ? 'REBALANCE' : 'ENTER'
  const summaryPrefix = params.summaryPrefix ?? 'agent delta-to-target'
  const confidence = typeof params.confidence === 'number' ? clamp(params.confidence, 0, 1) : 0.65
  const rationale = params.rationale ?? `agent-driven rebalance to target exposure (${BASE_LONG_SYMBOL} vs basket)`

  return {
    proposalId,
    cycleId: ulid(),
    summary: `${summaryPrefix} (${signalSummary})`,
    confidence,
    requestedMode: params.requestedMode,
    createdBy: params.createdBy,
    actions: [
      {
        type: actionType,
        rationale,
        notionalUsd: Number(actionNotionalUsd.toFixed(2)),
        expectedSlippageBps: params.executionTactics.expectedSlippageBps,
        maxSlippageBps: params.executionTactics.maxSlippageBps,
        legs
      }
    ]
  }
}

function buildExitProposal(params: {
  createdBy: string
  positions: OperatorPosition[]
  signals: PluginSignal[]
  requestedMode: 'SIM' | 'LIVE'
  executionTactics: { expectedSlippageBps: number; maxSlippageBps: number }
  confidence?: number
  rationale?: string
}): StrategyProposal | null {
  if (params.positions.length === 0) {
    return null
  }

  const currentBySymbol = signedNotionalBySymbol(params.positions)
  const symbols = [...new Set(params.positions.map((position) => position.symbol))].sort((a, b) => a.localeCompare(b))

  const legs = symbols
    .map((symbol) => {
      const current = currentBySymbol.get(symbol) ?? 0
      if (!Number.isFinite(current) || Math.abs(current) < EXIT_NOTIONAL_EPSILON_USD) {
        return null
      }
      const side: 'BUY' | 'SELL' = current > 0 ? 'SELL' : 'BUY'
      return { symbol, side, notionalUsd: Number(Math.abs(current).toFixed(2)) }
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
  const confidence = typeof params.confidence === 'number' ? clamp(params.confidence, 0, 1) : 0.6
  const rationale = params.rationale ?? 'risk-off: exit to flat'

  return {
    proposalId,
    cycleId: ulid(),
    summary: `agent exit to flat (${signalSummary})`,
    confidence,
    requestedMode: params.requestedMode,
    createdBy: params.createdBy,
    actions: [
      {
        type: 'EXIT',
        rationale,
        notionalUsd: Number(actionNotionalUsd.toFixed(2)),
        expectedSlippageBps: params.executionTactics.expectedSlippageBps,
        maxSlippageBps: params.executionTactics.maxSlippageBps,
        legs
      }
    ]
  }
}

async function generateAnalysis(params: {
  llm: LlmChoice
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
      thesis: `Maintain market-neutral ${BASE_LONG_SYMBOL} vs basket exposure by rebalancing notionals to the target.`,
      risks: ['Funding regime shift', 'Liquidity slippage during volatility', 'Model-free signal blindness'],
      confidence: 0.4
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'scribe',
      mission: 'Write concise post-decision floor analysis tied to execution rationale and current risk posture.',
      rules: [
        'Use the latest floor context before writing interpretation.',
        'Keep output tight and concrete.',
        'If confidence is low, reflect uncertainty explicitly.',
        'Do not include raw order tickets, signatures, or venue credentials.',
        'Each risk item should be specific and observable.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
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
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const confidence = clamp(Number(raw.confidence), 0, 1)
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'HL Privateer Analysis',
    thesis: String(raw.thesis ?? '').slice(0, 1200),
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence
  }
}

async function generateResearchReport(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; regime: string; recommendation: string; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      regime: { type: 'string' },
      recommendation: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['headline', 'regime', 'recommendation', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Research pulse',
      regime: 'range / mean-reversion bias',
      recommendation: 'keep basket stable; watch correlation + funding for regime shifts',
      confidence: 0.35
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'research-agent',
      mission: 'Classify current market regime and return one actionable recommendation.',
      rules: [
        'Use only context and observed signals; do not speculate on external events.',
        'Output one recommendation, not a portfolio plan.',
        'If data indicates regime shift, indicate it explicitly in regime.',
        'Prefer basket-stability guidance when correlation deteriorates or signals are mixed.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; regime: string; recommendation: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; regime: string; recommendation: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'Research pulse',
    regime: String(raw.regime ?? '').slice(0, 160) || 'unknown',
    recommendation: String(raw.recommendation ?? '').slice(0, 240),
    confidence: clamp(Number(raw.confidence), 0, 1)
  }
}

async function generateRiskReport(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      posture: { type: 'string', enum: ['GREEN', 'AMBER', 'RED'] },
      risks: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      confidence: { type: 'number' }
    },
    required: ['headline', 'posture', 'risks', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Risk posture',
      posture: 'GREEN',
      risks: ['Volatility spike', 'Liquidity gaps', 'Correlation break'],
      confidence: 0.35
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'risk-agent',
      mission: 'Assess immediate risk posture and list concrete blockers or residual risks.',
      rules: [
        'Only return posture GREEN/AMBER/RED.',
        'Prioritize stale data, volatility regime, and drift imbalance.',
        'Tie each risk item to specific observable context.',
        'When posture is RED, favor conservative action and explicit blockers.',
        'Do not output execution mechanics.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const posture = raw.posture === 'GREEN' || raw.posture === 'AMBER' || raw.posture === 'RED' ? raw.posture : 'AMBER'
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'Risk posture',
    posture,
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence: clamp(Number(raw.confidence), 0, 1)
  }
}

async function generateStrategistDirective(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ decision: StrategistDirectiveDecision; targetNotionalMultiplier: number; rationale: string; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: ['MAINTAIN', 'ROTATE', 'EXIT'] },
      targetNotionalMultiplier: { type: 'number' },
      rationale: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['decision', 'targetNotionalMultiplier', 'rationale', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      decision: 'MAINTAIN',
      targetNotionalMultiplier: 1,
      rationale: 'llm disabled',
      confidence: 0.25
    }
  }

  const prompt = [
    buildAgentPrompt({
      role: 'strategist-directive agent',
      mission: 'Choose the best directive for the next cycle and optionally scale notional.',
      rules: [
        'Allowed decisions: MAINTAIN, ROTATE, EXIT only.',
        'Prefer MAINTAIN unless there is clear evidence to rotate or exit.',
        'Use ROTATE only when hedge quality or liquidity improves materially.',
        'Use EXIT if correlation breaks, volatility is extreme, or risk posture is RED.',
        'If lastRiskDecision contains blocking DENY codes (DRAWDOWN, EXPOSURE, LEVERAGE, SAFE_MODE, STALE_DATA, LIQUIDITY), force EXIT / flat-first behavior.',
        'Respect min/max notional multipliers and avoid growth in SAFE_MODE.',
        'Prefer lower multipliers when uncertainty rises.'
      ],
      schemaHint: 'Return only JSON that matches the provided schema.',
      context: params.input
    })
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ decision: StrategistDirectiveDecision; targetNotionalMultiplier: number; rationale: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ decision: StrategistDirectiveDecision; targetNotionalMultiplier: number; rationale: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const decision: StrategistDirectiveDecision =
    raw.decision === 'EXIT' || raw.decision === 'ROTATE' || raw.decision === 'MAINTAIN' ? raw.decision : 'MAINTAIN'

  return {
    decision,
    targetNotionalMultiplier: Number(raw.targetNotionalMultiplier),
    rationale: String(raw.rationale ?? '').slice(0, 600),
    confidence: clamp(Number(raw.confidence), 0, 1)
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
let lastResearchAt = 0
let lastRiskAt = 0
let lastOpsAt = 0
let lastDirectiveAt = 0
let lastProposal: StrategyProposal | null = null
let lastProposalPublishedAt = 0
let lastRiskDecision: RuntimeRiskDecision | null = null
let lastRiskRecoverySignature = ''
let lastRiskRecoveryNoticeAt = 0
let lastStateUpdate:
  | {
    mode?: string
    pnlPct?: number
    realizedPnlUsd?: number
    driftState?: string
    lastUpdateAt?: string
    message?: string
  }
  | null = null
let lastResearchReport: { headline: string; regime: string; recommendation: string; confidence: number; computedAt: string } | null = null
let lastRiskReport: { headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number; computedAt: string } | null = null
let lastScribeAnalysis: { headline: string; thesis: string; risks: string[]; confidence: number; computedAt: string } | null = null
let autoHaltActive = false
let autoHaltHealthySinceMs = 0

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

async function publishProposal(params: { actorId: string; proposal: StrategyProposal }): Promise<void> {
  await bus.publish('hlp.strategy.proposals', {
    type: 'STRATEGY_PROPOSAL',
    stream: 'hlp.strategy.proposals',
    source: 'agent-runner',
    correlationId: params.proposal.proposalId,
    actorType: 'internal_agent',
    actorId: params.actorId,
    payload: params.proposal
  })
}

async function publishTape(params: { correlationId: string; role: string; line: string; level?: 'INFO' | 'WARN' | 'ERROR' }): Promise<void> {
  const line = sanitizeLine(params.line, 240)
  const role = sanitizeLine(params.role, 32)
  const level: 'INFO' | 'WARN' | 'ERROR' = params.level ?? 'INFO'
  const ts = new Date().toISOString()
  if (!line) {
    return
  }
  floorTapeHistory.push({ ts, role, level, line })
  if (floorTapeHistory.length > FLOOR_TAPE_CONTEXT_LINES) {
    floorTapeHistory.splice(0, floorTapeHistory.length - FLOOR_TAPE_CONTEXT_LINES)
  }

  await bus.publish('hlp.ui.events', {
    type: 'FLOOR_TAPE',
    stream: 'hlp.ui.events',
    source: 'agent-runner',
    correlationId: params.correlationId,
    actorType: 'internal_agent',
    actorId: env.AGENT_ID,
    payload: {
      ts,
      role,
      level,
      line
    }
  })
}

let lastWatchlistKey = ''
let lastWatchlistPublishedAtMs = 0

function normalizeSymbolList(symbols: string[]): string[] {
  return symbols
    .map((symbol) => String(symbol).trim())
    .filter(Boolean)
}

function watchlistKey(symbols: string[]): string {
  return normalizeSymbolList(symbols)
    .map((symbol) => symbol.toUpperCase())
    .join(',')
}

async function maybePublishWatchlist(params: { symbols: string[]; reason: string }): Promise<void> {
  const normalized = normalizeSymbolList(params.symbols)
  if (normalized.length === 0) {
    return
  }

  const nowMs = Date.now()
  const key = watchlistKey(normalized)
  const changed = key !== lastWatchlistKey
  const stale = nowMs - lastWatchlistPublishedAtMs > 30_000
  if (!changed && !stale) {
    return
  }

  lastWatchlistKey = key
  lastWatchlistPublishedAtMs = nowMs
  await bus.publish('hlp.market.watchlist', {
    type: 'MARKET_WATCHLIST',
    stream: 'hlp.market.watchlist',
    source: 'agent-runner',
    correlationId: ulid(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    payload: {
      ts: new Date().toISOString(),
      symbols: normalized,
      reason: sanitizeLine(params.reason, 120)
    }
  })
}

async function publishAgentCommand(params: {
  command: '/halt' | '/resume' | '/flatten'
  reason: string
}): Promise<void> {
  await bus.publish('hlp.commands', {
    type: 'agent.command',
    stream: 'hlp.commands',
    source: 'agent-runner',
    correlationId: ulid(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    payload: {
      command: params.command,
      args: [],
      reason: sanitizeLine(params.reason, 160),
      actorRole: 'operator_admin',
      capabilities: ['command.execute']
    }
  })
}

function requestedModeFromEnv(): 'SIM' | 'LIVE' {
  if (!env.DRY_RUN && env.ENABLE_LIVE_OMS) {
    return 'LIVE'
  }
  return 'SIM'
}

function summarizePositionsForAgents(positions: OperatorPosition[]): { drift: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'; posture: 'GREEN' | 'AMBER' | 'RED' } {
  if (positions.length === 0) {
    return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
  }

  const longs = positions
    .filter((position) => position.side === 'LONG')
    .reduce((sum, position) => sum + Math.max(0, Math.abs(position.notionalUsd)), 0)
  const shorts = positions
    .filter((position) => position.side === 'SHORT')
    .reduce((sum, position) => sum + Math.max(0, Math.abs(position.notionalUsd)), 0)

  const gross = longs + shorts
  if (gross <= 0) {
    return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
  }

  const mismatch = Math.abs(longs - shorts) / (gross / 2)
  if (mismatch > 0.2) {
    return { drift: 'BREACH', posture: 'RED' }
  }
  if (mismatch > 0.05) {
    return { drift: 'POTENTIAL_DRIFT', posture: 'AMBER' }
  }
  return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
}

function tickStalenessMs(symbols: string[]): { maxAgeMs: number; missing: string[] } {
  const missing: string[] = []
  let maxAgeMs = 0

  for (const symbol of symbols) {
    const tick = latestTicks.get(symbol)
    if (!tick) {
      missing.push(symbol)
      maxAgeMs = Math.max(maxAgeMs, 60_000)
      continue
    }

    const updatedAt = safeDateMs(tick.updatedAt)
    if (updatedAt === null) {
      maxAgeMs = Math.max(maxAgeMs, 60_000)
      continue
    }

    maxAgeMs = Math.max(maxAgeMs, Date.now() - updatedAt)
  }

  return { maxAgeMs, missing }
}

async function runOpsAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastOpsAt < env.AGENT_OPS_INTERVAL_MS) {
    return
  }
  lastOpsAt = now

  const universe = [BASE_LONG_SYMBOL, ...activeBasket.basketSymbols]
  const { maxAgeMs, missing } = tickStalenessMs(universe)

  const level: 'INFO' | 'WARN' | 'ERROR' = maxAgeMs > 15000 || missing.length > 0 ? 'WARN' : 'INFO'
  await publishTape({
    correlationId: ulid(),
    role: 'ops',
    level,
    line: `deck status mode=${lastMode} feedAgeMs=${Math.round(maxAgeMs)} missing=${missing.length}`
  })

  // Runtime can source ticks for dynamic basket symbols on-demand via l2Book snapshots.
  void maybePublishWatchlist({ symbols: universe, reason: 'ops heartbeat' }).catch(() => undefined)

  const healthy = maxAgeMs <= 15_000 && missing.length === 0

  // Auto-resume only if we were the party that auto-halted.
  if (autoHaltActive) {
    if (lastMode !== 'HALT') {
      autoHaltActive = false
      autoHaltHealthySinceMs = 0
    } else if (healthy) {
      if (autoHaltHealthySinceMs === 0) {
        autoHaltHealthySinceMs = now
      }
      if (now - autoHaltHealthySinceMs > 30_000) {
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: 'auto-resume: market data recovered'
        })
        await publishAgentCommand({ command: '/resume', reason: 'auto-resume: market data recovered' })
        autoHaltActive = false
        autoHaltHealthySinceMs = 0
      }
    } else {
      autoHaltHealthySinceMs = 0
    }
  }

  if (env.OPS_AUTO_HALT && lastMode !== 'HALT' && !healthy) {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'ERROR',
      line: 'auto-halt: market data stale'
    })
    await publishAgentCommand({ command: '/halt', reason: 'auto-halt: market data stale' })
    autoHaltActive = true
    autoHaltHealthySinceMs = 0
  }
}

async function runResearchAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastResearchAt < env.AGENT_RESEARCH_INTERVAL_MS) {
    return
  }
  lastResearchAt = now

  const signalPack = summarizeLatestSignals(now)
  const latestVol = latestSignalFromPack(signalPack, 'volatility')
  const latestCorr = latestSignalFromPack(signalPack, 'correlation')
  const latestFunding = latestSignalFromPack(signalPack, 'funding')
  const regime =
    latestVol && Math.abs(latestVol.value) > 15
      ? 'high vol'
      : latestCorr && latestCorr.value < 0.1
        ? 'correlation break risk'
        : 'stable'

  const input = {
    ts: new Date().toISOString(),
    mode: lastMode,
    basketSymbols: activeBasket.basketSymbols.join(','),
    signals: {
      all: signalPack,
      latest: {
        vol: latestVol?.value ?? null,
        corr: latestCorr?.value ?? null,
        funding: latestFunding?.value ?? null
      }
    },
    inferredRegime: regime
  }

  const llm = llmForRole('research', now)
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

  let report: { headline: string; regime: string; recommendation: string; confidence: number }
  try {
    report = await generateResearchReport({ llm, model, input })
  } catch (primaryError) {
    if (llm === 'codex') {
      try {
        report = await generateResearchReport({ llm: 'claude', model: env.CLAUDE_MODEL, input })
        const disabled = maybeDisableCodexFromError(primaryError, now)
        const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `research codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
        })
      } catch (fallbackError) {
        report = await generateResearchReport({ llm: 'none', model, input })
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `research codex+claude failed; deterministic: ${String(fallbackError).slice(0, 120)}`
        })
      }
    } else {
      report = await generateResearchReport({ llm: 'none', model, input })
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `research llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
    }
  }

  lastResearchReport = { ...report, computedAt: new Date().toISOString() }

  await publishTape({
    correlationId: ulid(),
    role: 'research',
    line: `${report.headline}: regime=${report.regime}`
  })

  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('research'),
    action: 'research.report',
    resource: 'agent.research',
    correlationId: ulid(),
    details: {
      ...report,
      input
    }
  })
}

async function runRiskAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastRiskAt < env.AGENT_RISK_INTERVAL_MS) {
    return
  }
  lastRiskAt = now

  const summary = summarizePositionsForAgents(lastPositions)
  const signalPack = summarizeLatestSignals(now)
  const latestVol = latestSignalFromPack(signalPack, 'volatility')

  const input = {
    ts: new Date().toISOString(),
    mode: lastMode,
    drift: summary.drift,
    postureHint: summary.posture,
    vol1hPct: latestVol?.value ?? null,
    signalCoverage: {
      types: Object.keys(signalPack).length,
      signalCount: Object.values(signalPack).reduce((count, entries) => count + entries.length, 0)
    },
    signals: signalPack,
    lastRiskDecision
  }

  const llm = llmForRole('risk', now)
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

  let report: { headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }
  try {
    report = await generateRiskReport({ llm, model, input })
  } catch (primaryError) {
    if (llm === 'codex') {
      try {
        report = await generateRiskReport({ llm: 'claude', model: env.CLAUDE_MODEL, input })
        const disabled = maybeDisableCodexFromError(primaryError, now)
        const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
        })
      } catch (fallbackError) {
        report = await generateRiskReport({ llm: 'none', model, input })
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk codex+claude failed; deterministic: ${String(fallbackError).slice(0, 120)}`
        })
      }
    } else {
      report = await generateRiskReport({ llm: 'none', model, input })
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `risk llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
    }
  }

  lastRiskReport = { ...report, computedAt: new Date().toISOString() }

  await publishTape({
    correlationId: ulid(),
    role: 'risk',
    line: `${report.headline}: ${report.posture} drift=${summary.drift}`
  })

  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('risk'),
    action: 'risk.report',
    resource: 'agent.risk',
    correlationId: ulid(),
    details: {
      ...report,
      derived: summary,
      input
    }
  })
}

async function maybeRefreshStrategistDirective(params: { signals: PluginSignal[]; targetNotionalUsd: number; positions: OperatorPosition[] }): Promise<void> {
  const nowMs = Date.now()
  if (directiveInFlight) {
    return
  }

  // Deterministic safety: SAFE_MODE should bias to risk-off without waiting for an LLM decision.
  if (lastMode === 'SAFE_MODE' && params.positions.length > 0) {
    if (activeDirective.decision === 'EXIT') {
      return
    }
    lastDirectiveAt = nowMs
    activeDirective = {
      decision: 'EXIT',
      targetNotionalMultiplier: 1,
      rationale: 'SAFE_MODE: force exit to flat',
      confidence: 1,
      decidedAt: new Date().toISOString()
    }
    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      level: 'WARN',
      line: `directive: EXIT (safe mode)`
    })
    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'strategist.directive',
      resource: 'agent.strategist',
      correlationId: ulid(),
      details: activeDirective
    })
    return
  }

  if (nowMs - lastDirectiveAt < env.AGENT_DIRECTIVE_INTERVAL_MS) {
    return
  }

  directiveInFlight = true
  try {
    const summary = summarizePositionsForAgents(params.positions)
    const heldBasket = basketFromPositions(params.positions)
    const signalPack = summarizeLatestSignals(nowMs)
    const latestVol = latestSignalFromPack(signalPack, 'volatility')
    const latestCorr = latestSignalFromPack(signalPack, 'correlation')
    const latestFunding = latestSignalFromPack(signalPack, 'funding')

    const input = {
      ts: new Date().toISOString(),
      mode: lastMode,
      state: lastStateUpdate ?? null,
      drift: summary.drift,
      postureHint: summary.posture,
      targetNotionalUsd: params.targetNotionalUsd,
      heldBasketSymbols: heldBasket,
      activeBasket: {
        basketSymbols: activeBasket.basketSymbols,
        rationale: activeBasket.rationale,
        selectedAt: activeBasket.selectedAt,
        context: activeBasket.context ?? null
      },
      positions: params.positions.map((position) => ({
        symbol: position.symbol,
        side: position.side,
        notionalBucket: bucketNotional(position.notionalUsd),
        updatedAt: position.updatedAt
      })),
      signals: {
        all: signalPack,
        latest: {
          volatility: latestVol?.value ?? null,
          correlation: latestCorr?.value ?? null,
          funding: latestFunding?.value ?? null
        }
      },
      lastRiskDecision,
      lastResearchReport,
      lastRiskReport,
      lastScribeAnalysis,
      multiplierBounds: {
        min: env.AGENT_NOTIONAL_MULTIPLIER_MIN,
        max: env.AGENT_NOTIONAL_MULTIPLIER_MAX
      },
      currentDirective: activeDirective
    }

    const llm = llmForRole('strategist', nowMs)
    const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

    let raw: { decision: StrategistDirectiveDecision; targetNotionalMultiplier: number; rationale: string; confidence: number }
    try {
      raw = await generateStrategistDirective({ llm, model, input })
    } catch (primaryError) {
      if (llm === 'codex') {
        try {
          raw = await generateStrategistDirective({ llm: 'claude', model: env.CLAUDE_MODEL, input })
          const disabled = maybeDisableCodexFromError(primaryError, nowMs)
          const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `directive codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
          })
        } catch (fallbackError) {
          raw = { decision: 'MAINTAIN', targetNotionalMultiplier: 1, rationale: `deterministic fallback: ${String(fallbackError).slice(0, 120)}`, confidence: 0.25 }
        }
      } else {
        raw = { decision: 'MAINTAIN', targetNotionalMultiplier: 1, rationale: `deterministic fallback: ${String(primaryError).slice(0, 120)}`, confidence: 0.25 }
      }
    }

    const mult = clamp(
      Number(raw.targetNotionalMultiplier),
      env.AGENT_NOTIONAL_MULTIPLIER_MIN,
      env.AGENT_NOTIONAL_MULTIPLIER_MAX
    )

    activeDirective = {
      decision: raw.decision,
      targetNotionalMultiplier: Number.isFinite(mult) ? mult : 1,
      rationale: raw.rationale || 'directive',
      confidence: clamp(Number(raw.confidence), 0, 1),
      decidedAt: new Date().toISOString()
    }
    lastDirectiveAt = nowMs

    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      line: `directive: ${activeDirective.decision} mult=${activeDirective.targetNotionalMultiplier.toFixed(2)}`
    })

    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'strategist.directive',
      resource: 'agent.strategist',
      correlationId: ulid(),
      details: {
        ...activeDirective,
        input
      }
    })
  } finally {
    directiveInFlight = false
  }
}

async function runStrategistCycle(): Promise<void> {
  const now = Date.now()
  if (now - lastProposalAt < env.AGENT_PROPOSAL_INTERVAL_MS) {
    return
  }
  lastProposalAt = now

  if (lastMode === 'HALT') {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'WARN',
      line: `strategy paused (mode=${lastMode})`
    })
    return
  }

  if (lastMode === 'SAFE_MODE' && lastPositions.length === 0) {
    return
  }

  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const baseTargetNotionalUsd = computeTargetNotional(env.BASKET_TARGET_NOTIONAL_USD, signals)
  const tactics = computeExecutionTactics({ signals })

  syncActiveBasketFromPositions(lastPositions)
  await maybeRefreshStrategistDirective({ signals, targetNotionalUsd: baseTargetNotionalUsd, positions: lastPositions })
  const riskRecovery = shouldForceRiskRecovery(now, lastPositions)
  if (riskRecovery.active) {
    if (riskRecovery.signature !== lastRiskRecoverySignature) {
      lastRiskRecoverySignature = riskRecovery.signature
      const computed = riskRecovery.computed
      const safeExposure = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : 'na')
      const exposure = computed
        ? ` gross=${safeExposure(computed.grossExposureUsd)} net=${safeExposure(computed.netExposureUsd)} drawdown=${safeExposure(computed.projectedDrawdownPct)}%`
        : ''

      if (now - lastRiskRecoveryNoticeAt > 60_000) {
        lastRiskRecoveryNoticeAt = now
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk recovery enforced: ${riskRecovery.reasonMessage}${exposure}`
        })
      }
    }

    if (activeDirective.decision !== 'EXIT') {
      activeDirective = {
        decision: 'EXIT',
        targetNotionalMultiplier: 1,
        rationale: riskRecovery.reasonMessage,
        confidence: 1,
        decidedAt: new Date().toISOString()
      }
      lastDirectiveAt = now
    }
  } else {
    lastRiskRecoverySignature = ''
  }

  const scaledTargetNotionalUsd = Number(
    Math.max(
      100,
      baseTargetNotionalUsd * clamp(activeDirective.targetNotionalMultiplier, env.AGENT_NOTIONAL_MULTIPLIER_MIN, env.AGENT_NOTIONAL_MULTIPLIER_MAX)
    ).toFixed(2)
  )

  let proposal: StrategyProposal | null = null
  if (activeDirective.decision !== 'EXIT') {
    lastExitProposalSignature = null
  }

  if (activeDirective.decision === 'EXIT') {
    const exitSignature = buildFlatSignature(lastPositions)
    if (exitSignature === 'FLAT') {
      if (lastExitProposalSignature !== 'FLAT') {
        await publishTape({
          correlationId: ulid(),
          role: 'scout',
          line: `no action (mode=${lastMode} already flat)`
        })
      }
      lastExitProposalSignature = 'FLAT'
      if (
        activeDirective.decision === 'EXIT' &&
        !riskRecovery.active &&
        lastMode !== 'SAFE_MODE' &&
        lastMode !== 'HALT'
      ) {
        activeDirective = {
          decision: 'MAINTAIN',
          targetNotionalMultiplier: clamp(activeDirective.targetNotionalMultiplier, env.AGENT_NOTIONAL_MULTIPLIER_MIN, env.AGENT_NOTIONAL_MULTIPLIER_MAX),
          rationale: 'recovered to flat: resume autonomous maintenance',
          confidence: 0.8,
          decidedAt: new Date().toISOString()
        }
        lastDirectiveAt = now
        lastExitProposalSignature = null
        await publishTape({
          correlationId: ulid(),
          role: 'strategist',
          line: `directive: MAINTAIN (recovery complete, resume trading)`
        })
      }
      return
    }
    if (lastExitProposalSignature === exitSignature) {
      return
    }
    lastExitProposalSignature = exitSignature
  }

  if (activeDirective.decision === 'EXIT') {
    proposal = buildExitProposal({
      createdBy: roleActorId('strategist'),
      positions: lastPositions,
      signals,
      requestedMode: requestedModeFromEnv(),
      executionTactics: tactics,
      confidence: activeDirective.confidence,
      rationale: activeDirective.rationale
    })
  } else {
    // When flat, ensure we have a basket selected before attempting entry.
    if (lastPositions.length === 0) {
      await maybeSelectBasket({ targetNotionalUsd: scaledTargetNotionalUsd, signals, positions: lastPositions })
    }

    let desiredBasketSymbols: string[]

    if (activeDirective.decision === 'ROTATE') {
      // Force a fresh basket selection, even mid-trade.
      await maybeSelectBasket({ targetNotionalUsd: scaledTargetNotionalUsd, signals, positions: lastPositions, force: true })
      desiredBasketSymbols = activeBasket.basketSymbols
      basketPivot = {
        basketSymbols: desiredBasketSymbols,
        startedAtMs: now,
        expiresAtMs: now + 5 * 60_000
      }
    } else {
      if (lastPositions.length > 0 && basketPivot && now < basketPivot.expiresAtMs) {
        desiredBasketSymbols = basketPivot.basketSymbols
      } else {
        desiredBasketSymbols = lastPositions.length > 0 ? basketFromPositions(lastPositions) : activeBasket.basketSymbols
      }
    }

    proposal = buildTargetProposal({
      createdBy: roleActorId('strategist'),
      basketSymbols: desiredBasketSymbols,
      targetNotionalUsd: scaledTargetNotionalUsd,
      positions: lastPositions,
      signals,
      requestedMode: requestedModeFromEnv(),
      executionTactics: tactics,
      confidence: activeDirective.confidence,
      rationale: activeDirective.rationale,
      summaryPrefix: activeDirective.decision === 'ROTATE' ? 'agent rotate basket' : 'agent autonomous'
    })

    // ROTATE is a one-shot directive; after emitting the pivot proposal we fall back to MAINTAIN.
    if (activeDirective.decision === 'ROTATE') {
      activeDirective = { ...activeDirective, decision: 'MAINTAIN' }
    }
  }
  if (!proposal) {
    await publishTape({
      correlationId: ulid(),
      role: 'scout',
      line: `no action (mode=${lastMode})`
    })
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

  const proposalSummary = renderLegSummary(parsed.proposal.actions[0]?.legs ?? [])
  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'scout',
    line: `proposal ${parsed.proposal.actions[0]?.type ?? 'ACTION'}: ${proposalSummary ?? parsed.proposal.summary}`
  })

  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'execution',
    line: `tactics slippage=${tactics.expectedSlippageBps}bps cap=${tactics.maxSlippageBps}bps`
  })

  await publishProposal({ actorId: roleActorId('strategist'), proposal: parsed.proposal })
  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'strategist',
    line: `${parsed.proposal.summary} (confidence=${parsed.proposal.confidence.toFixed(2)} mode=${parsed.proposal.requestedMode} positions=${lastPositions.length})`
  })

  lastProposal = parsed.proposal
  lastProposalPublishedAt = now

  if (now - lastAnalysisAt < env.AGENT_ANALYSIS_INTERVAL_MS) {
    return
  }
  lastAnalysisAt = now

  await runScribeAnalysis(parsed.proposal, { targetNotionalUsd: scaledTargetNotionalUsd })
}

async function runScribeAnalysis(proposal: StrategyProposal, context: { targetNotionalUsd: number }): Promise<void> {
  const nowMs = Date.now()
  const universe = new Set<string>([BASE_LONG_SYMBOL, ...activeBasket.basketSymbols])
  const tickSnapshot = [...universe].map((symbol) => latestTicks.get(symbol)).filter(Boolean)
  const signalPack = summarizeLatestSignals(nowMs)
  const analysisInput = {
    ts: new Date().toISOString(),
    mode: lastMode,
    targetNotionalUsd: context.targetNotionalUsd,
    basketSymbols: activeBasket.basketSymbols.join(','),
    basketContext: activeBasket.context ?? null,
    signals: signalPack,
    ticks: tickSnapshot,
    positions: lastPositions,
    proposal
  }

  const llm = llmForRole('scribe', nowMs)
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL
  let analysis: { headline: string; thesis: string; risks: string[]; confidence: number }
  try {
    analysis = await generateAnalysis({ llm, model, input: analysisInput })
  } catch (primaryError) {
    if (llm === 'codex') {
      try {
        analysis = await generateAnalysis({ llm: 'claude', model: env.CLAUDE_MODEL, input: analysisInput })
        const disabled = maybeDisableCodexFromError(primaryError, nowMs)
        const untilNote = disabled ? ` (codex disabled until ${new Date(disabled.untilMs).toISOString()})` : ''
        await publishTape({
          correlationId: proposal.proposalId,
          role: 'ops',
          level: 'WARN',
          line: `scribe codex failed; using claude ${env.CLAUDE_MODEL}: ${summarizeCodexError(primaryError)}${untilNote}`
        })
      } catch (fallbackError) {
        analysis = await generateAnalysis({ llm: 'none', model, input: analysisInput })
        await publishTape({
          correlationId: proposal.proposalId,
          role: 'ops',
          level: 'WARN',
          line: `scribe codex+claude failed; deterministic: ${String(fallbackError).slice(0, 120)}`
        })
      }
    } else {
      analysis = await generateAnalysis({ llm: 'none', model, input: analysisInput })
      await publishTape({
        correlationId: proposal.proposalId,
        role: 'ops',
        level: 'WARN',
        line: `scribe llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
    }
  }

  lastScribeAnalysis = { ...analysis, computedAt: new Date().toISOString() }

  await publishTape({
    correlationId: proposal.proposalId,
    role: 'scribe',
    line: `${analysis.headline} (confidence=${analysis.confidence.toFixed(2)})`
  })

  const audit: AuditEvent = {
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('scribe'),
    action: 'analysis.report',
    resource: 'agent.analysis',
    correlationId: proposal.proposalId,
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
      if (payload && typeof payload === 'object') {
        lastStateUpdate = {
          mode: typeof payload.mode === 'string' ? payload.mode : undefined,
          pnlPct: typeof payload.pnlPct === 'number' ? payload.pnlPct : undefined,
          realizedPnlUsd: typeof payload.realizedPnlUsd === 'number' ? payload.realizedPnlUsd : undefined,
          driftState: typeof payload.driftState === 'string' ? payload.driftState : undefined,
          lastUpdateAt: typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : undefined,
          message: typeof payload.message === 'string' ? payload.message : undefined
        }
      }
      if (payload?.mode) {
        lastMode = String(payload.mode)
      }
    }
    if (envelope.type === 'POSITION_UPDATE') {
      const payload = envelope.payload as any
      if (Array.isArray(payload)) {
        lastPositions = payload as OperatorPosition[]
        syncActiveBasketFromPositions(lastPositions)
        if (basketPivot) {
          const nowMs = Date.now()
          if (nowMs > basketPivot.expiresAtMs) {
            basketPivot = null
          } else {
            const held = basketFromPositions(lastPositions)
            if (held.length > 0 && sameBasket(held, basketPivot.basketSymbols)) {
              basketPivot = null
              void publishTape({
                correlationId: ulid(),
                role: 'execution',
                line: `basket pivot complete: ${held.join(',')}`
              }).catch(() => undefined)
            }
          }
        }
      }
    }
  })

  await bus.consume('hlp.risk.decisions', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type !== 'risk.decision') {
      return
    }
    const payload = envelope.payload as any
    if (payload && typeof payload === 'object') {
      const reasons = Array.isArray(payload.reasons)
        ? payload.reasons
          .map((item: any) => ({
            code: typeof item?.code === 'string' ? item.code : '',
            message: typeof item?.message === 'string' ? item.message : '',
            details: typeof item?.details === 'object' && item.details ? item.details as Record<string, unknown> : undefined
          }))
          .filter((reason: RuntimeRiskReason) => reason.code)
        : undefined
      lastRiskDecision = {
        decision: typeof payload.decision === 'string' ? payload.decision : undefined,
        computedAt: typeof payload.computedAt === 'string' ? payload.computedAt : undefined,
        reasons,
        decisionId: typeof payload.decisionId === 'string' ? payload.decisionId : undefined,
        proposalCorrelation: typeof payload.proposalCorrelation === 'string' ? payload.proposalCorrelation : undefined,
        computed: typeof payload.computed === 'object' && payload.computed ? {
          grossExposureUsd: Number(payload.computed.grossExposureUsd),
          netExposureUsd: Number(payload.computed.netExposureUsd),
          projectedDrawdownPct: Number(payload.computed.projectedDrawdownPct),
          notionalImbalancePct: Number(payload.computed.notionalImbalancePct)
        } : undefined
      }
    }
  })

  let tickRunning = false
  setInterval(() => {
    if (tickRunning) {
      return
    }

    tickRunning = true
    void Promise.resolve()
      .then(async () => {
        await runOpsAgent()
        await runResearchAgent()
        await runRiskAgent()
        await runStrategistCycle()
      })
      .catch((error) => {
        // Keep the runner alive; report via audit stream.
        void publishAudit({
          id: ulid(),
          ts: new Date().toISOString(),
          actorType: 'internal_agent',
          actorId: roleActorId('ops'),
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

  await publishTape({ correlationId: ulid(), role: 'ops', line: `crew online requestedMode=${requestedModeFromEnv()}` })
  await publishTape({ correlationId: ulid(), role: 'scout', line: 'scout online (market + tape)' })
  await publishTape({ correlationId: ulid(), role: 'research', line: 'research online (regime + basket notes)' })
  await publishTape({ correlationId: ulid(), role: 'risk', line: 'risk online (posture + constraints)' })
  await publishTape({ correlationId: ulid(), role: 'strategist', line: 'strategist online (proposals)' })
  await publishTape({ correlationId: ulid(), role: 'execution', line: 'execution online (tactics)' })
  await publishTape({ correlationId: ulid(), role: 'scribe', line: 'scribe online (analysis)' })

  console.log(`agent-runner started agentId=${env.AGENT_ID} llm=${env.AGENT_LLM} requestedMode=${requestedModeFromEnv()}`)
}

void start().catch((error) => {
  console.error(error)
  process.exit(1)
})
