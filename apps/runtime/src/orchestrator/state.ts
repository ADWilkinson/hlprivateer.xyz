import {
  ActorType,
  AuditEvent,
  commandPolicy,
  OPERATOR_ADMIN_ROLE,
  OPERATOR_VIEW_ROLE,
  Role,
  OperatorCommandNameSchema,
  RoleSchema,
  NormalizedTick,
  OperatorOrder,
  OperatorPosition,
  parseStrategyProposal,
  RiskDecision,
  StrategyProposal,
  TradeState
} from '@hl/privateer-contracts'
import { EventBus } from '@hl/privateer-event-bus'
import { evaluateRisk, RiskConfig } from '@hl/privateer-risk-engine'
import { createLiveAdapter, createSimAdapter, ExecutionAdapter } from '../services/oms'
import { MarketDataAdapter } from '../services/market'
import { createRuntimePluginManager } from '../services/plugin-manager'
import { RuntimeStore } from '../db/persistence'
import { RuntimeEnv } from '../config'
import { canTransition } from '../state-machine'
import { computeInfraAutoFlattenEligibility } from './infra-auto-flatten'
import { shouldSuppressDiscretionaryExit, type ActiveThesisState } from './thesis-guard'
import { ulid } from 'ulid'
import promClient from 'prom-client'
import type { PluginSignal } from '@hl/privateer-plugin-sdk'
import type { HlClient } from '@hl/privateer-hl-client'
type RateLimitLevel = 'warn' | 'error'

function createRateLimitedLogger(intervalMs: number) {
  const last = new Map<string, number>()
  return (
    key: string,
    level: RateLimitLevel,
    message: string,
    meta?: Record<string, unknown>
  ) => {
    const now = Date.now()
    const lastAt = last.get(key) ?? 0
    if (now - lastAt < intervalMs) {
      return
    }
    last.set(key, now)
    const payload = meta ? { ...meta } : undefined
    if (level === 'warn') {
      console.warn(message, payload)
    } else {
      console.error(message, payload)
    }
  }
}

const logRuntimePersistenceError = (() => {
  const log = createRateLimitedLogger(30_000)
  return (operation: string, error: unknown, meta?: Record<string, unknown>) => {
    log(
      `runtime.persistence.${operation}`,
      'error',
      `runtime: persistence write failed (${operation})`,
      {
        operation,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        ...(meta ?? {})
      }
    )
  }
})()

const logRuntimeBusPublishError = (() => {
  const log = createRateLimitedLogger(30_000)
  return (stream: string, error: unknown, meta?: Record<string, unknown>) => {
    log(
      `runtime.bus.${stream}`,
      'warn',
      `runtime: bus publish failed (${stream})`,
      {
        stream,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        ...(meta ?? {})
      }
    )
  }
})()


interface LoopConfig {
  env: RuntimeEnv
  bus: EventBus
  store: RuntimeStore
  hlClient?: HlClient
}

export interface RuntimeState {
  mode: TradeState
  pnlPct: number
  realizedPnlUsd: number
  driftState: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'
  lastUpdateAt: string
  cycle: number
  positions: OperatorPosition[]
  orders: OperatorOrder[]
}

export interface RuntimeHandle {
  getState(): RuntimeState
  getPositions(): OperatorPosition[]
  getOrders(): OperatorOrder[]
  runCommand(
    command: string,
    actorType: ActorType,
    actorId: string,
    args: string[],
    reason: string,
    actorRole?: Role,
    capabilities?: string[]
  ): Promise<{ ok: true; message: string }>
  stop(): Promise<void>
}

type RuntimeRiskPolicy = Omit<RiskConfig, 'failClosedOnDependencyError'>

type ParsedRiskPolicyCommand = {
  patch: RuntimeRiskPolicy
}

type RiskPolicyValidationError = {
  message: string
  fields: string[]
}

const runtimeCycleCounter = new promClient.Counter({
  name: 'hlp_runtime_cycles_total',
  help: 'Total runtime decision cycles'
})

const runtimeCycleDurationMs = new promClient.Histogram({
  name: 'hlp_runtime_cycle_duration_ms',
  help: 'Runtime cycle duration in milliseconds',
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
})

const runtimeCycleErrorCounter = new promClient.Counter({
  name: 'hlp_runtime_cycles_failed_total',
  help: 'Failed runtime cycles'
})

const runtimeProposalCounter = new promClient.Counter({
  name: 'hlp_runtime_proposals_total',
  help: 'Proposals processed in runtime',
  labelNames: ['status']
})

const runtimeCycleMode = new promClient.Gauge({
  name: 'hlp_runtime_mode',
  help: 'Current runtime mode encoded as numeric value',
  labelNames: ['mode']
})

const runtimeRiskDecisionCounter = new promClient.Counter({
  name: 'hlp_runtime_risk_decisions_total',
  help: 'Risk decision outcomes',
  labelNames: ['decision']
})

const runtimeCommandCounter = new promClient.Counter({
  name: 'hlp_runtime_commands_total',
  help: 'Runtime command outcomes',
  labelNames: ['command', 'result']
})
const RISK_DENIAL_NOTICE_COOLDOWN_MS = 180_000
const RISK_AUTO_MITIGATION_COOLDOWN_MS = 60_000
const NO_ACTION_NOTICE_COOLDOWN_MS = 60_000
const RISK_POLICY_MIN_LEVERAGE = 0.1
const RISK_POLICY_MIN_DRAWDOWN_PCT = 0.01
const RISK_POLICY_MIN_EXPOSURE_USD = 25
const RISK_POLICY_MIN_SLIPPAGE_BPS = 0
const RISK_POLICY_MIN_STALE_DATA_MS = 300
const RISK_POLICY_MIN_LIQUIDITY_BUFFER = 1
const RISK_POLICY_MIN_NOTIONAL_PARITY_TOLERANCE = 0
const RISK_POLICY_MAX_NOTIONAL_PARITY_TOLERANCE = 1
const MIN_MEANINGFUL_POSITION_USD = 1

const RISK_POLICY_ARG_ALIASES: Record<string, keyof RuntimeRiskPolicy> = {
  maxLeverage: 'maxLeverage',
  max_leverage: 'maxLeverage',
  'max-leverage': 'maxLeverage',
  targetLeverage: 'targetLeverage',
  target_leverage: 'targetLeverage',
  'target-leverage': 'targetLeverage',
  maxDrawdownPct: 'maxDrawdownPct',
  max_drawdown_pct: 'maxDrawdownPct',
  'max-drawdown-pct': 'maxDrawdownPct',
  maxExposureUsd: 'maxExposureUsd',
  max_exposure_usd: 'maxExposureUsd',
  'max-exposure-usd': 'maxExposureUsd',
  maxSlippageBps: 'maxSlippageBps',
  max_slippage_bps: 'maxSlippageBps',
  'max-slippage-bps': 'maxSlippageBps',
  staleDataMs: 'staleDataMs',
  stale_data_ms: 'staleDataMs',
  'stale-data-ms': 'staleDataMs',
  liquidityBufferPct: 'liquidityBufferPct',
  liquidity_buffer_pct: 'liquidityBufferPct',
  'liquidity-buffer-pct': 'liquidityBufferPct',
  notionalParityTolerance: 'notionalParityTolerance',
  notional_parity_tolerance: 'notionalParityTolerance',
  'notional-parity-tolerance': 'notionalParityTolerance'
}

void promClient.collectDefaultMetrics()

function driftFrom(state: RuntimeState, breachThreshold = 1.0): 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH' {
  if (state.positions.length === 0) {
    return 'IN_TOLERANCE'
  }

  const longs = state.positions
    .filter((position) => position.side === 'LONG')
    .reduce((acc, position) => acc + Math.max(0, Math.abs(position.notionalUsd)), 0)
  const shorts = state.positions
    .filter((position) => position.side === 'SHORT')
    .reduce((acc, position) => acc + Math.max(0, Math.abs(position.notionalUsd)), 0)
  const gross = longs + shorts
  const mismatch = Math.abs(longs - shorts)
  const pct = gross === 0 ? 0 : mismatch / gross

  if (pct > breachThreshold) {
    return 'BREACH'
  }

  if (pct > breachThreshold * 0.25) {
    return 'POTENTIAL_DRIFT'
  }

  return 'IN_TOLERANCE'
}

function setModeGauge(mode: TradeState): void {
  runtimeCycleMode.reset()
  runtimeCycleMode.labels({ mode }).set(1)
}

export async function createRuntime({ env, bus, store, hlClient }: LoopConfig): Promise<RuntimeHandle> {
  if (env.ENABLE_LIVE_OMS && !env.LIVE_MODE_APPROVED) {
    throw new Error('live mode requires explicit operator approval (set LIVE_MODE_APPROVED=true)')
  }
  if (env.ENABLE_LIVE_OMS && env.DRY_RUN) {
    throw new Error('live mode requires DRY_RUN=false')
  }

  let runtimeRiskPolicy: RuntimeRiskPolicy = {
    maxLeverage: env.RISK_MAX_LEVERAGE,
    targetLeverage: Math.min(env.RISK_TARGET_LEVERAGE, env.RISK_MAX_LEVERAGE),
    maxDrawdownPct: env.RISK_MAX_DRAWDOWN_PCT,
    maxExposureUsd: env.RISK_MAX_NOTIONAL_USD,
    maxSlippageBps: env.RISK_MAX_SLIPPAGE_BPS,
    staleDataMs: env.RISK_STALE_DATA_MS,
    liquidityBufferPct: env.RISK_LIQUIDITY_BUFFER_PCT,
    notionalParityTolerance: env.RISK_NOTIONAL_PARITY_TOLERANCE
  }

  const readRuntimeRiskPolicy = (): RuntimeRiskPolicy => ({ ...runtimeRiskPolicy })

  const adapter = env.ENABLE_LIVE_OMS
    ? createLiveAdapter(env, () => readRuntimeRiskPolicy().maxSlippageBps, hlClient)
    : createSimAdapter(() => readRuntimeRiskPolicy().maxSlippageBps, 25)
  const marketAdapter = await createMarketAdapterLazy(env, bus)
  const pluginManager = await createRuntimePluginManager(bus)
  const l2BookDepthCache = new Map<
    string,
    { bidPx: number; askPx: number; bidDepthUsd: number; askDepthUsd: number; fetchedAtMs: number; updatedAtIso: string }
  >()
  const persistedState = await store.getSystemState()
  const persistedPositions = await store.getPositions()
  const persistedOrders = await store.getOrders()

  const state: RuntimeState = {
    mode: persistedState?.state ?? 'INIT',
    pnlPct: 0,
    realizedPnlUsd: 0,
    driftState: 'IN_TOLERANCE',
    lastUpdateAt: new Date().toISOString(),
    cycle: 0,
    positions: persistedPositions,
    orders: persistedOrders
  }

  state.lastUpdateAt = persistedState?.updatedAt ?? state.lastUpdateAt
  state.driftState = driftFrom(state, env.RISK_DRIFT_BREACH_PCT)

  setModeGauge(state.mode)

  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let reconcileTimer: ReturnType<typeof setInterval> | undefined
  let reconcileRunning = false
  let loopRunning = false
  const consumerStops: Array<() => Promise<void>> = []
  let lastUrgentCycleAt = 0
  let lastLiveAccountValueCheckAtMs = 0
  let lastLiveAccountValueOkAtMs = 0
  let cachedLiveAccountValueUsd = 0
  let cachedLiveWalletAddress = ''
  let agentWatchlistSymbols: string[] = []
  let lastSafeModeHoldNoticeAtMs = 0
  let lastSafeModeNoExposureHoldNoticeAtMs = 0
  let lastRiskDeniedSignature = ''
  let lastRiskDeniedNoticeAtMs = 0
  let lastRiskAutoMitigationAtMs = 0
  let lastRiskAutoMitigationSignature = ''
  let firstInfraFailureAtMs = 0
  let lastInfraAutoFlattenNoticeAtMs = 0
  let lastNoActionNoticeAtMs = 0
  let lastNoActionSignature = ''
  let lastDustSweepAtMs = 0
  const DUST_SWEEP_COOLDOWN_MS = 30_000
  let consecutiveCycleErrors = 0
  const SAFE_MODE_ERROR_THRESHOLD = 5
  const infraAutoFlattenMinOutageMs = env.RUNTIME_INFRA_AUTO_FLATTEN_MIN_OUTAGE_MS
  const infraAutoFlattenNoticeCooldownMs = env.RUNTIME_INFRA_AUTO_FLATTEN_NOTICE_COOLDOWN_MS
  const infraAutoFlattenMinGrossUsd = Math.max(0, env.RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_USD)
  const infraAutoFlattenMinGrossPct = Math.max(0, Math.min(1, env.RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_PCT))
  let activeThesis: ActiveThesisState | null = null

  const normalizeRiskSignature = (message: string): string =>
    message
      .toLowerCase()
      .replace(/\b\d+(?:\.\d+)?%?/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\b[a-f0-9]{8,}\b/g, '')
      .trim()

  const markInfraRecovered = (): void => {
    firstInfraFailureAtMs = 0
    lastInfraAutoFlattenNoticeAtMs = 0
  }

  const normalizeRiskPolicy = (
    current: RuntimeRiskPolicy,
    patch: Partial<RuntimeRiskPolicy>
  ): ParsedRiskPolicyCommand | RiskPolicyValidationError => {
    if (Object.keys(patch).length === 0) {
      return { message: 'no valid risk policy changes were provided', fields: [] }
    }

    const normalized: Partial<RuntimeRiskPolicy> = {}
    const fields: string[] = []
    const next: RuntimeRiskPolicy = { ...current }

    for (const [key, rawValue] of Object.entries(patch)) {
      const numericValue = Number(rawValue)
      if (!Number.isFinite(numericValue)) {
        fields.push(`${key}: not numeric`)
        continue
      }

      if (key === 'maxLeverage') {
        if (numericValue < RISK_POLICY_MIN_LEVERAGE) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_LEVERAGE}`)
          continue
        }
        normalized.maxLeverage = numericValue
      }

      if (key === 'targetLeverage') {
        if (numericValue < RISK_POLICY_MIN_LEVERAGE) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_LEVERAGE}`)
          continue
        }
        normalized.targetLeverage = numericValue
      }

      if (key === 'maxDrawdownPct') {
        if (numericValue < RISK_POLICY_MIN_DRAWDOWN_PCT) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_DRAWDOWN_PCT}`)
          continue
        }
        normalized.maxDrawdownPct = numericValue
      }

      if (key === 'maxExposureUsd') {
        if (numericValue < RISK_POLICY_MIN_EXPOSURE_USD) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_EXPOSURE_USD}`)
          continue
        }
        normalized.maxExposureUsd = numericValue
      }

      if (key === 'maxSlippageBps') {
        if (numericValue < RISK_POLICY_MIN_SLIPPAGE_BPS) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_SLIPPAGE_BPS}`)
          continue
        }
        normalized.maxSlippageBps = numericValue
      }

      if (key === 'staleDataMs') {
        if (numericValue < RISK_POLICY_MIN_STALE_DATA_MS) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_STALE_DATA_MS}`)
          continue
        }
        normalized.staleDataMs = numericValue
      }

      if (key === 'liquidityBufferPct') {
        if (numericValue < RISK_POLICY_MIN_LIQUIDITY_BUFFER) {
          fields.push(`${key}: min ${RISK_POLICY_MIN_LIQUIDITY_BUFFER}`)
          continue
        }
        normalized.liquidityBufferPct = numericValue
      }

      if (key === 'notionalParityTolerance') {
        if (numericValue < RISK_POLICY_MIN_NOTIONAL_PARITY_TOLERANCE || numericValue > RISK_POLICY_MAX_NOTIONAL_PARITY_TOLERANCE) {
          fields.push(`${key}: range ${RISK_POLICY_MIN_NOTIONAL_PARITY_TOLERANCE}..${RISK_POLICY_MAX_NOTIONAL_PARITY_TOLERANCE}`)
          continue
        }
        normalized.notionalParityTolerance = numericValue
      }
    }

    if (fields.length > 0) {
      return { message: `invalid risk policy value(s): ${fields.join(', ')}`, fields }
    }

    const nextPolicy: RuntimeRiskPolicy = {
      ...next,
      ...normalized
    }

    if (
      typeof nextPolicy.targetLeverage === 'number' &&
      Number.isFinite(nextPolicy.targetLeverage) &&
      nextPolicy.targetLeverage > nextPolicy.maxLeverage
    ) {
      return {
        message: `invalid risk policy value(s): targetLeverage must be <= maxLeverage`,
        fields: ['targetLeverage']
      }
    }

    return { patch: nextPolicy }
  }

  const parseRiskPolicyArgs = (args: string[]): ParsedRiskPolicyCommand | RiskPolicyValidationError => {
    const rawPatch: Record<string, number> = {}

    if (args.length === 1 && args[0].trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(args[0]) as Record<string, unknown>
        for (const [rawKey, rawValue] of Object.entries(parsed ?? {})) {
          const canonicalKey = RISK_POLICY_ARG_ALIASES[rawKey]
          if (!canonicalKey) {
            continue
          }
          rawPatch[canonicalKey] = Number(rawValue)
        }
        return normalizeRiskPolicy(readRuntimeRiskPolicy(), rawPatch)
      } catch (error) {
        console.warn('[runtime-state] failed to parse risk policy json payload', error) // eslint-disable-line no-console
        return { message: 'invalid JSON payload', fields: ['json'] }
      }
    }

    const rawTokens = args.filter(Boolean)
    for (const token of rawTokens) {
      const [rawKeyRaw, rawValueRaw] = token.split('=')
      if (!rawKeyRaw || rawValueRaw === undefined) {
        return { message: `invalid token ${token}`, fields: [token] }
      }
      const canonicalKey = RISK_POLICY_ARG_ALIASES[rawKeyRaw.trim()]
      if (!canonicalKey) {
        return { message: `unknown key ${rawKeyRaw}`, fields: [rawKeyRaw] }
      }
      rawPatch[canonicalKey] = Number(rawValueRaw)
    }

    return normalizeRiskPolicy(readRuntimeRiskPolicy(), rawPatch)
  }

  const minLiveAccountValueUsd = (): number => {
    const policy = readRuntimeRiskPolicy()
    const leverageCap = Math.max(1, policy.targetLeverage ?? policy.maxLeverage)
    const leverageAwareFloor = env.BASKET_TARGET_NOTIONAL_USD / leverageCap
    return Math.max(env.RUNTIME_MIN_LIVE_ACCOUNT_VALUE_USD, leverageAwareFloor)
  }

  const minimumFlatExposureUsd = Math.max(MIN_MEANINGFUL_POSITION_USD, env.RUNTIME_FLAT_DUST_NOTIONAL_USD)
  const exposureUsd = (positions: readonly OperatorPosition[]): number =>
    positions.reduce((sum, position) => sum + Math.abs(position.notionalUsd), 0)

  const isMeaningfulPosition = (position: OperatorPosition): boolean => {
    const absNotionalUsd = Math.abs(position.notionalUsd)
    return Number.isFinite(absNotionalUsd) && absNotionalUsd >= minimumFlatExposureUsd && absNotionalUsd > 0
  }

  const meaningfulPositions = (positions: readonly OperatorPosition[] = state.positions): OperatorPosition[] =>
    positions.filter(isMeaningfulPosition)

  const hasMeaningfulExposure = (positions: readonly OperatorPosition[] = state.positions): boolean =>
    meaningfulPositions(positions).length > 0
  const hasAnyExposure = (positions: readonly OperatorPosition[] = state.positions): boolean =>
    hasMeaningfulExposure(positions)
  const driftFromMeaningful = (positions: readonly OperatorPosition[] = state.positions): ReturnType<typeof driftFrom> =>
    driftFrom({ ...state, positions: meaningfulPositions(positions) }, env.RISK_DRIFT_BREACH_PCT)

  const refreshLiveAccountValue = async (nowMs: number): Promise<void> => {
    if (!env.ENABLE_LIVE_OMS) {
      return
    }

    if (nowMs - lastLiveAccountValueCheckAtMs <= 15_000) {
      return
    }
    lastLiveAccountValueCheckAtMs = nowMs

    try {
      const getWallet = (adapter as ExecutionAdapter).getWalletAddress
      if (!cachedLiveWalletAddress && typeof getWallet === 'function') {
        cachedLiveWalletAddress = String(getWallet())
      }

      const getAccountValueUsd = (adapter as ExecutionAdapter).getAccountValueUsd
      if (typeof getAccountValueUsd === 'function') {
        const next = await getAccountValueUsd()
        if (Number.isFinite(next) && next >= 0) {
          cachedLiveAccountValueUsd = next
          lastLiveAccountValueOkAtMs = nowMs
        }
      }
    } catch (error) {
      console.warn(
        '[runtime-state] failed to fetch live account value',
        {
          nowMs,
          hasWallet: Boolean(cachedLiveWalletAddress)
        },
        error
      ) // eslint-disable-line no-console
      // Keep last known value. Funding gate additionally requires a recent successful fetch.
    }
  }

  const resolveLiveAccountValueUsd = (): number | undefined =>
    env.ENABLE_LIVE_OMS && cachedLiveAccountValueUsd > 0 ? cachedLiveAccountValueUsd : undefined

  const resolveRuntimeAccountValueUsd = (): number =>
    resolveLiveAccountValueUsd() ?? 0

  const buildRiskConfig = (): RiskConfig => {
    const policy = readRuntimeRiskPolicy()
    return {
      ...policy,
      failClosedOnDependencyError: true
    }
  }

  const runtimeRiskPolicyContext = (): Record<string, number> => {
    const policy = readRuntimeRiskPolicy()
    return {
      maxLeverage: policy.maxLeverage,
      targetLeverage: typeof policy.targetLeverage === 'number' && Number.isFinite(policy.targetLeverage) ? policy.targetLeverage : policy.maxLeverage,
      maxDrawdownPct: policy.maxDrawdownPct,
      maxExposureUsd: policy.maxExposureUsd,
      maxSlippageBps: policy.maxSlippageBps,
      staleDataMs: policy.staleDataMs,
      liquidityBufferPct: policy.liquidityBufferPct,
      notionalParityTolerance: policy.notionalParityTolerance
    }
  }

  await bus.publish('hlp.ui.events', {
    type: 'STATE_UPDATE',
    stream: 'hlp.ui.events',
    source: 'runtime',
    correlationId: 'init',
    actorType: 'system',
    actorId: 'runtime',
    payload: {
      mode: state.mode,
      pnlPct: state.pnlPct,
      realizedPnlUsd: state.realizedPnlUsd,
      driftState: state.driftState,
      healthCode: 'GREEN',
      lastUpdateAt: state.lastUpdateAt,
      riskPolicy: runtimeRiskPolicyContext(),
      message: 'runtime boot'
    }
  })
  await store.saveSystemState(state.mode, persistedState?.reason ?? 'startup')

  await marketAdapter.start()
  await pluginManager.start()

  const setMode = async (mode: TradeState, reason: string): Promise<void> => {
    if (!canTransition(state.mode, mode)) {
      await addAudit('invalid_transition', 'runtime', envelopeId(), {
        from: state.mode,
        to: mode,
        reason
      })
      return
    }

    const previousMode = state.mode
    state.mode = mode
    state.lastUpdateAt = new Date().toISOString()
    state.driftState = driftFromMeaningful()
    setModeGauge(mode)
    await store.saveSystemState(mode, reason).catch(() => {
      void bus.publish('hlp.audit.events', {
        type: 'RUNTIME_CONFIG',
        stream: 'hlp.audit.events',
        source: 'runtime',
        correlationId: ulid(),
        actorType: 'system',
        actorId: 'runtime',
        payload: {
          id: envelopeId(),
          ts: new Date().toISOString(),
          actorType: 'system',
          actorId: 'runtime',
          action: 'state.persist_failed',
          resource: 'runtime.state',
          correlationId: envelopeId(),
          details: {
            from: previousMode,
            to: mode,
            reason
          }
        }
      })
    })

    await bus.publish('hlp.ui.events', {
      type: 'STATE_UPDATE',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId: ulid(),
      actorType: 'system',
      actorId: 'runtime-state',
      payload: {
        mode,
        previousMode,
        reason,
        pnlPct: state.pnlPct,
        realizedPnlUsd: state.realizedPnlUsd,
        driftState: state.driftState,
        healthCode: mode === 'SAFE_MODE' || mode === 'HALT' ? 'RED' : 'GREEN',
        lastUpdateAt: state.lastUpdateAt,
        riskPolicy: runtimeRiskPolicyContext()
      }
    })
  }

  if (!persistedState) {
    await setMode('WARMUP', 'startup complete')
    await setMode('READY', 'runtime ready')
  }
  else if (state.mode === 'INIT') {
    await setMode('WARMUP', 'startup complete')
    await setMode('READY', 'runtime ready')
  }

  consumerStops.push(await bus.consume('hlp.commands', '$', async (envelope) => {
    if (!envelope?.type) {
      return
    }

    if (envelope.type.startsWith('operator') || envelope.type.startsWith('agent')) {
      const payload = envelope.payload as {
        command?: string
        args?: string[]
        reason?: string
        actorRole?: Role
        capabilities?: string[]
        actor?: { role?: Role }
      }

      const roleFromPayload = RoleSchema.safeParse(payload.actorRole ?? payload.actor?.role)
      const actorRole = roleFromPayload.success ? roleFromPayload.data : undefined
      const actorCapabilities = Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((capability) => typeof capability === 'string')
        : []

      if (!payload?.command) {
        return
      }

      await handleCommand(
        payload.command,
        envelope.actorType,
        envelope.actorId,
        payload.args ?? [],
        payload.reason ?? 'command',
        actorRole,
        actorCapabilities
      )

      const now = Date.now()
      if (now - lastUrgentCycleAt >= 1_000) {
        lastUrgentCycleAt = now
        void runCycle(true)
      }
    }
  }))

  consumerStops.push(await bus.consume('hlp.market.watchlist', '$', (envelope) => {
    if (envelope?.type !== 'MARKET_WATCHLIST') {
      return
    }

    const payload = envelope.payload as any
    const symbols = Array.isArray(payload?.symbols) ? payload.symbols : []
    const normalized = symbols
      .map((symbol: unknown) => String(symbol ?? '').trim())
      .filter(Boolean)
      .slice(0, 25)

    if (normalized.length === 0) {
      return
    }

    agentWatchlistSymbols = normalized
  }))

  let pendingAgentProposal: StrategyProposal | null = null
  let pendingAgentProposalReceivedAt = 0

  const publishPositionsUpdate = async (correlationId: string) => {
    await bus.publish('hlp.ui.events', {
      type: 'POSITION_UPDATE',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId,
      actorType: 'system',
      actorId: 'runtime',
      payload: state.positions
    })
  }

  const publishOrdersUpdate = async (correlationId: string) => {
    await bus.publish('hlp.ui.events', {
      type: 'ORDER_UPDATE',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId,
      actorType: 'system',
      actorId: 'runtime',
      payload: state.orders
    })
  }

  const publishStateUpdate = async (correlationId: string, message: string) => {
    const openPositionNotionalUsd = state.positions.reduce((seed, position) => {
      const notionalUsd = typeof position.notionalUsd === 'number' && Number.isFinite(position.notionalUsd) ? position.notionalUsd : 0
      return seed + Math.abs(notionalUsd)
    }, 0)
    const accountValueUsd = resolveLiveAccountValueUsd()

    await bus.publish('hlp.ui.events', {
      type: 'STATE_UPDATE',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId,
      actorType: 'system',
      actorId: 'runtime-state',
      payload: {
        mode: state.mode,
        pnlPct: state.pnlPct,
        realizedPnlUsd: state.realizedPnlUsd,
        openPositions: state.positions,
        openPositionCount: state.positions.length,
        openPositionNotionalUsd,
        driftState: state.driftState,
        healthCode: state.mode === 'SAFE_MODE' || state.mode === 'HALT' ? 'RED' : 'GREEN',
        lastUpdateAt: state.lastUpdateAt,
        riskPolicy: runtimeRiskPolicyContext(),
        message,
        ...(accountValueUsd !== undefined ? { accountValueUsd } : {})
      }
    })
  }

  const runCycle = async (urgency = false) => {
    if (stopped || loopRunning) {
      return
    }

    loopRunning = true
    runtimeCycleCounter.inc()
    const endCycleTimer = runtimeCycleDurationMs.startTimer()
    const cycleCorrelationId = envelopeId()
    try {
      const nowIso = new Date().toISOString()
      const nowMs = Date.now()
      state.lastUpdateAt = nowIso

      // Keep cached live account value fresh for risk + pnl calculations.
      await refreshLiveAccountValue(nowMs)

      // In live mode, sync our state from the exchange each cycle (restart-safe).
      if (env.ENABLE_LIVE_OMS) {
        const live = await adapter.snapshot()
        state.positions = live.positions
        state.orders = live.orders
        state.realizedPnlUsd = live.realizedPnlUsd
        await Promise.all([store.savePositions(state.positions), store.saveOrders(state.orders)]).catch((error) =>
          logRuntimePersistenceError('savePositionsOrders', error, { positions: state.positions.length, orders: state.orders.length })
        )
      }

      // Note: `BASKET_SYMBOLS` is treated as a market-data seed only.
      // Trade entry is agent-driven; runtime will not open new exposure from this env var.
      const seedBasketSymbols = env.BASKET_SYMBOLS
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean)

      // Pull latest ticks for any symbol we might touch this cycle.
      const tickSymbols = new Set<string>([
        ...seedBasketSymbols,
        ...agentWatchlistSymbols,
        ...state.positions.map((position) => position.symbol)
      ])
      const ticks: Record<string, NormalizedTick> = {}

      const fallbackSymbols: string[] = []
      for (const symbol of tickSymbols) {
        const tick = await marketAdapter.latest(symbol)
        if (tick) {
          ticks[symbol] = tick
          continue
        }

        fallbackSymbols.push(symbol)
      }

      if (fallbackSymbols.length > 0) {
        // Resolve missing symbols concurrently so one slow endpoint does not stall the whole cycle.
        const snapshots = await Promise.allSettled(
          fallbackSymbols.map((symbol) =>
            fetchHyperliquidL2BookSnapshotCached({
              postInfo: hlClient?.postInfo,
              infoUrl: env.HL_INFO_URL,
              coin: symbol,
              cache: l2BookDepthCache
            })
          )
        )

        for (let index = 0; index < fallbackSymbols.length; index += 1) {
          const symbol = fallbackSymbols[index]
          const settled = snapshots[index]

          if (!settled || settled.status !== 'fulfilled') {
            continue
          }

          const snapshot = settled.value
          if (!snapshot) {
            continue
          }

          const derivedTick = {
            symbol,
            px: snapshot.px,
            bid: snapshot.bidPx,
            ask: snapshot.askPx,
            bidSize: snapshot.bidPx > 0 ? snapshot.bidDepthUsd / snapshot.bidPx : 0,
            askSize: snapshot.askPx > 0 ? snapshot.askDepthUsd / snapshot.askPx : 0,
            updatedAt: snapshot.updatedAtIso,
            source: 'runtime.market.l2book'
          }
          ticks[symbol] = derivedTick
          void bus.publish('hlp.market.normalized', {
            type: 'MARKET_TICK',
            stream: 'hlp.market.normalized',
            source: 'runtime.market.l2book',
            correlationId: cycleCorrelationId,
            actorType: 'system',
            actorId: 'market-l2book',
            payload: derivedTick
          }).catch((error) => logRuntimeBusPublishError('hlp.market.normalized', error, { symbol }))
        }
      }

      const mark = markToMarketPositions(state.positions, ticks, nowIso)
      state.positions = mark.positions
      const totalPnlUsd = state.realizedPnlUsd + mark.unrealizedPnlUsd
      const pnlDenominatorUsd = resolveRuntimeAccountValueUsd()
      state.pnlPct = pnlDenominatorUsd > 0 ? Number(((totalPnlUsd / pnlDenominatorUsd) * 100).toFixed(3)) : 0
      state.driftState = driftFromMeaningful()
      if (!hasAnyExposure(state.positions)) {
        activeThesis = null
      }

      // Cycle reached mark-to-market without error — reset transient error counter.
      consecutiveCycleErrors = 0

      // Keep downstream views live even on no-op cycles.
      await publishPositionsUpdate(cycleCorrelationId)

      // Periodic dust sweep: close sub-meaningful positions left by IOC partial fills.
      if (adapter.closeBySize && !hasAnyExposure() && nowMs - lastDustSweepAtMs >= DUST_SWEEP_COOLDOWN_MS) {
        const dustPositions = state.positions.filter(
          (p) => Math.abs(p.notionalUsd) > 0 && !isMeaningfulPosition(p) && p.qty > 0
        )
        if (dustPositions.length > 0) {
          lastDustSweepAtMs = nowMs
          for (const position of dustPositions) {
            const dustTick = ticks[position.symbol] ?? (await marketAdapter.latest(position.symbol))
            if (!dustTick) continue
            const dustSide: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY'
            try {
              await adapter.closeBySize({
                symbol: position.symbol,
                side: dustSide,
                size: String(position.qty),
                tick: dustTick,
                idempotencyKey: `dust-sweep:${cycleCorrelationId}:${position.symbol}:${dustSide}`
              })
            } catch (error) {
              await addAudit('execution.dust_sweep_error', 'runtime', cycleCorrelationId, {
                symbol: position.symbol,
                side: dustSide,
                qty: position.qty,
                notionalUsd: position.notionalUsd,
                message: String(error)
              })
            }
          }
          const dustSnapshot = await adapter.snapshot()
          state.positions = dustSnapshot.positions
          state.orders = dustSnapshot.orders
          state.realizedPnlUsd = dustSnapshot.realizedPnlUsd
          await Promise.all([store.savePositions(state.positions), store.saveOrders(state.orders)]).catch((error) =>
            logRuntimePersistenceError('savePositionsOrders', error, { positions: state.positions.length, orders: state.orders.length })
          )
          await publishPositionsUpdate(cycleCorrelationId)
        }
      }

      if (state.mode === 'HALT') {
        runtimeProposalCounter.inc({ status: 'skipped_halt' })
        await publishStateUpdate(cycleCorrelationId, urgency ? 'halted (urgent)' : 'halted')
        return
      }

      if (state.mode === 'SAFE_MODE') {
        const dependencyHealth = await bus.health()
        const databaseHealth = env.DRY_RUN ? true : await store.health()
        const canExitSafeMode = dependencyHealth.ok && databaseHealth

        if (hasAnyExposure()) {
          lastSafeModeNoExposureHoldNoticeAtMs = 0
          if (canExitSafeMode) {
            lastSafeModeHoldNoticeAtMs = 0
            markInfraRecovered()
            consecutiveCycleErrors = 0
            const recoveryMode = hasAnyExposure() ? 'IN_TRADE' : 'READY'
            await setMode(recoveryMode, 'safe mode auto-resolve: dependencies recovered')
            return
          }
          runtimeProposalCounter.inc({ status: 'safe_mode_holding' })
          if (nowMs - lastSafeModeHoldNoticeAtMs >= 30_000) {
            lastSafeModeHoldNoticeAtMs = nowMs
            await publishStateUpdate(
              cycleCorrelationId,
              `safe mode: holding open positions — dependencies healthy=${dependencyHealth.ok ? 'YES' : 'NO'}, db=${databaseHealth ? 'YES' : 'NO'}`
            )
          }
          return
        }

        if (canExitSafeMode) {
          lastSafeModeHoldNoticeAtMs = 0
          lastSafeModeNoExposureHoldNoticeAtMs = 0
          markInfraRecovered()
          consecutiveCycleErrors = 0
          await setMode('READY', 'safe mode auto-resolve: no open exposure')
          return
        } else if (nowMs - lastSafeModeHoldNoticeAtMs >= 30_000) {
          lastSafeModeHoldNoticeAtMs = nowMs
          await publishStateUpdate(
            cycleCorrelationId,
            `safe mode hold: dependencies healthy=${dependencyHealth.ok ? 'YES' : 'NO'}, db=${databaseHealth ? 'YES' : 'NO'}`
          )
        }

        runtimeProposalCounter.inc({ status: 'safe_mode_flat_hold' })
        if (lastSafeModeNoExposureHoldNoticeAtMs === 0) {
          lastSafeModeNoExposureHoldNoticeAtMs = nowMs
        } else if (nowMs - lastSafeModeNoExposureHoldNoticeAtMs >= 60_000) {
          lastSafeModeNoExposureHoldNoticeAtMs = nowMs
          await publishStateUpdate(cycleCorrelationId, 'safe mode hold: no open exposure, awaiting recovery conditions')
        }
        return
      }

      // Live funding gate: don't open new exposure until the Hyperliquid account has enough value
      // to support the configured target notional under the leverage cap.
      if (env.ENABLE_LIVE_OMS && !hasAnyExposure()) {
        const minAccountValueUsd = minLiveAccountValueUsd()
        const hasFreshValue = lastLiveAccountValueOkAtMs > 0 && nowMs - lastLiveAccountValueOkAtMs <= 30_000
        const effectiveAccountValueUsd = hasFreshValue ? cachedLiveAccountValueUsd : 0

        if (effectiveAccountValueUsd < minAccountValueUsd) {
          runtimeProposalCounter.inc({ status: 'awaiting_funding' })
          const walletHint = cachedLiveWalletAddress ? `${cachedLiveWalletAddress.slice(0, 10)}...` : 'unknown'
          await publishStateUpdate(
            cycleCorrelationId,
            `awaiting Hyperliquid funding (accountValueUsd=${effectiveAccountValueUsd.toFixed(2)} < min=${minAccountValueUsd.toFixed(2)} wallet=${walletHint})`
          )
          return
        }
      }

      const recentSignals = pluginManager.getSignals()
      const targetNotional = computeTargetNotional(env.BASKET_TARGET_NOTIONAL_USD, recentSignals)

      const agentFresh = pendingAgentProposal && Date.now() - pendingAgentProposalReceivedAt < 60_000
      let proposalCandidate: StrategyProposal | null
      let origin: 'agent' | 'runtime' = 'runtime'

      if (agentFresh && pendingAgentProposal) {
        proposalCandidate = pendingAgentProposal
        pendingAgentProposal = null
        pendingAgentProposalReceivedAt = 0
        origin = 'agent'
      } else {
        proposalCandidate = null
      }

      if (!proposalCandidate) {
        const hasOpenExposure = hasAnyExposure()
        runtimeProposalCounter.inc({ status: hasOpenExposure ? 'no_action' : 'awaiting_agent_proposal' })
        if (!hasOpenExposure && state.mode !== 'READY') {
          await setMode('READY', 'flat (no proposal)')
        }
        const message =
          !hasOpenExposure
            ? 'awaiting agent proposal (entry is agent-driven)'
            : urgency
              ? 'no action (urgent)'
              : 'no action'
        if (
          message !== lastNoActionSignature ||
          nowMs - lastNoActionNoticeAtMs >= NO_ACTION_NOTICE_COOLDOWN_MS
        ) {
          lastNoActionSignature = message
          lastNoActionNoticeAtMs = nowMs
          await publishStateUpdate(cycleCorrelationId, message)
        }
        return
      }

      const parsedProposal = parseStrategyProposal(proposalCandidate)
      if (!parsedProposal.ok) {
        const proposalId = typeof (proposalCandidate as any)?.proposalId === 'string' ? String((proposalCandidate as any).proposalId) : envelopeId()
        const reasons = parsedProposal.errors.map((error: { code: string; message: string; path?: unknown[] }) => ({
          code: error.code,
          message: error.message,
          details: error.path ? { path: error.path } : undefined
        }))

        await addAudit('proposal.parse_error', 'runtime', proposalId, {
          action: 'parse_error',
          origin,
          proposal: proposalCandidate,
          reasons
        })

        await publishRiskDecision(
          {
            decision: 'DENY',
            reasons,
            correlationId: proposalId,
            decisionId: `dec-${proposalId}`,
            computedAt: new Date().toISOString(),
            computed: {
              grossExposureUsd: 0,
              netExposureUsd: 0,
              projectedDrawdownPct: 0,
              notionalImbalancePct: 100
            }
          },
          'PARSE_ERROR',
          proposalId
        )

        runtimeProposalCounter.inc({ status: 'parse_error' })
        runtimeRiskDecisionCounter.inc({ decision: 'DENY' })
        await publishStateUpdate(proposalId, 'proposal parse error')
        return
      }

      const proposal = parsedProposal.proposal
      runtimeProposalCounter.inc({ status: origin === 'agent' ? 'agent_parsed' : 'parsed' })
      await addAudit('proposal.selected', 'runtime', proposal.proposalId, {
        proposalId: proposal.proposalId,
        cycleId: proposal.cycleId,
        origin,
        createdBy: proposal.createdBy,
        actionCount: proposal.actions.length,
        summary: proposal.summary,
        requestedMode: proposal.requestedMode,
        urgency: urgency ? 'urgent' : 'scheduled'
      }, 'runtime.proposal')

      const exitGuard = shouldSuppressDiscretionaryExit({
        proposal,
        activeThesis,
        pnlPct: state.pnlPct,
        nowMs: Date.now()
      })
      if (exitGuard.suppress) {
        runtimeProposalCounter.inc({ status: 'exit_suppressed_thesis_valid' })
        await addAudit('proposal.exit_suppressed', 'runtime', proposal.proposalId, {
          proposalId: proposal.proposalId,
          reason: exitGuard.reason,
          exitReason: proposal.exitReason ?? 'DISCRETIONARY',
          thesis: activeThesis
        }, 'runtime.proposal')
        await publishStateUpdate(proposal.proposalId, `exit suppressed (${exitGuard.reason})`)
        return
      }

      const dependencyHealth = await bus.health()
      // In DRY_RUN mode we allow running without Postgres persistence to reduce operational complexity.
      // In live mode, persistence health remains a hard dependency (fail-closed).
      const databaseHealth = env.DRY_RUN ? true : await store.health()
      const dependenciesHealthy = dependencyHealth.ok && databaseHealth
      if (dependenciesHealthy) {
        markInfraRecovered()
      }

      await augmentTicksWithL2BookDepth({
        postInfo: hlClient?.postInfo,
        infoUrl: env.HL_INFO_URL,
        proposal,
        ticks,
        cache: l2BookDepthCache
      })

      const risk = evaluateRisk(buildRiskConfig(), {
        state: state.mode,
        actorType: 'system',
        accountValueUsd: resolveRuntimeAccountValueUsd(),
        dependenciesHealthy,
        openPositions: meaningfulPositions(state.positions),
        ticks,
        proposal
      })
      runtimeRiskDecisionCounter.inc({ decision: risk.decision })

      await publishRiskDecision(risk, 'RISK_EVAL', proposal.proposalId)
      if (risk.decision === 'DENY') {
        const reasonMessage = risk.reasons.length
          ? risk.reasons.map((entry) => `${entry.code}: ${entry.message}`).join(' | ')
          : 'no risk reasons provided'
        const reasonCodes = risk.reasons
          .map((entry) => String(entry.code).trim().toUpperCase())
          .filter((entry) => entry.length > 0)
        const detailedReasonSignature = [...new Set(
          risk.reasons.map((entry) => {
            const raw = `${String(entry.code ?? 'GENERIC').trim().toUpperCase()}: ${normalizeRiskSignature(String(entry.message ?? ''))}`
            return raw.replace(/\|+/g, '|').trim()
          })
        )].sort().join('|')
        const denialSignature = reasonCodes.length > 0
          ? [...new Set(reasonCodes)].sort().join('|')
          : detailedReasonSignature || 'no_reason'
        const shouldPublishDenialNotice =
          nowMs - lastRiskDeniedNoticeAtMs >= RISK_DENIAL_NOTICE_COOLDOWN_MS ||
          lastRiskDeniedSignature !== denialSignature
        if (shouldPublishDenialNotice) {
          lastRiskDeniedSignature = denialSignature
          lastRiskDeniedNoticeAtMs = nowMs
          await publishStateUpdate(proposal.proposalId, `risk denied (${reasonMessage})`)
        }

        runtimeProposalCounter.inc({ status: 'risk_denied' })
        if (risk.reasons.some((entry) => entry.code === 'DEPENDENCY_FAILURE')) {
          await setMode('SAFE_MODE', 'risk dependency failure')
        }
        return
      }

      const previousMode = state.mode
      await execute(proposal, risk.decision, ticks)
      runtimeProposalCounter.inc({ status: 'executed' })

      // Re-mark after execution so operator/public views show updated PnL.
      const postMarkIso = new Date().toISOString()
      state.lastUpdateAt = postMarkIso
      const postMark = markToMarketPositions(state.positions, ticks, postMarkIso)
      state.positions = postMark.positions
      const totalAfterUsd = state.realizedPnlUsd + postMark.unrealizedPnlUsd
      const pnlDenominatorUsdAfter = resolveRuntimeAccountValueUsd()
      state.pnlPct = pnlDenominatorUsdAfter > 0 ? Number(((totalAfterUsd / pnlDenominatorUsdAfter) * 100).toFixed(3)) : 0
      state.driftState = driftFromMeaningful()
      await publishPositionsUpdate(proposal.proposalId)

      if (previousMode === 'READY' && hasAnyExposure()) {
        await setMode('IN_TRADE', 'trade entry')
      } else if (hasAnyExposure() && (state.mode === 'IN_TRADE' || state.mode === 'REBALANCE')) {
        await setMode('REBALANCE', 'rebalance')
      } else if (!hasAnyExposure() && state.mode !== 'READY') {
        await setMode('READY', 'flat')
      }

      if (risk.decision === 'ALLOW_REDUCE_ONLY') {
        await setMode('SAFE_MODE', 'risk decision requested risk-only posture')
        runtimeProposalCounter.inc({ status: 'reduce_only' })
      }

      await bus.publish('hlp.execution.fills', {
        type: 'execution.report',
        stream: 'hlp.execution.fills',
        source: 'runtime',
        correlationId: proposal.proposalId,
        actorType: 'system',
        actorId: 'runtime',
        payload: {
          positions: state.positions,
          orders: state.orders,
          cycle: state.cycle
        }
      })

      await publishStateUpdate(proposal.proposalId, `${origin} proposal executed`)
    } catch (error) {
      consecutiveCycleErrors += 1
      await addAudit('runtime_error', 'runtime', envelopeId(), {
        message: String(error),
        consecutiveErrors: consecutiveCycleErrors
      })
      runtimeCycleErrorCounter.inc()
      if (consecutiveCycleErrors >= SAFE_MODE_ERROR_THRESHOLD) {
        await setMode('SAFE_MODE', `runtime error (${consecutiveCycleErrors} consecutive): ${String(error)}`)
      } else {
        console.warn(`[runtime-state] transient cycle error (${consecutiveCycleErrors}/${SAFE_MODE_ERROR_THRESHOLD}):`, String(error))
      }
    } finally {
      state.cycle += 1
      endCycleTimer()
      loopRunning = false
    }
  }

  consumerStops.push(await bus.consume('hlp.strategy.proposals', '$', async (envelope) => {
    const candidate = envelope?.payload
    if (!candidate) {
      return
    }

    const parsed = parseStrategyProposal(candidate)
    if (!parsed.ok) {
      await addAudit('agent.proposal.parse_error', envelope.actorId ?? 'agent', envelopeId(), {
        errors: parsed.errors
      }, 'runtime.agent')
      runtimeProposalCounter.inc({ status: 'agent_parse_error' })
      return
    }

    // Ignore live proposals unless the runtime has explicitly enabled live execution.
    if (parsed.proposal.requestedMode === 'LIVE' && !env.ENABLE_LIVE_OMS) {
      await addAudit('agent.proposal.ignored', envelope.actorId ?? 'agent', parsed.proposal.proposalId, {
        reason: 'live proposal received while ENABLE_LIVE_OMS=false',
        proposalId: parsed.proposal.proposalId,
        requestedMode: parsed.proposal.requestedMode
      }, 'runtime.agent')
      runtimeProposalCounter.inc({ status: 'agent_ignored_live' })
      return
    }

    pendingAgentProposal = parsed.proposal
    pendingAgentProposalReceivedAt = Date.now()
    await addAudit('agent.proposal.received', envelope.actorId ?? 'agent', parsed.proposal.proposalId, {
      proposalId: parsed.proposal.proposalId,
      summary: parsed.proposal.summary,
      createdBy: parsed.proposal.createdBy,
      requestedMode: parsed.proposal.requestedMode
    }, 'runtime.agent')

    const now = Date.now()
    if (now - lastUrgentCycleAt >= 1_000) {
      lastUrgentCycleAt = now
      void runCycle(true)
    }
  }))

  const execute = async (
    proposal: StrategyProposal,
    decision: RiskDecision,
    ticks: Record<string, NormalizedTick>
  ): Promise<void> => {
    const action = proposal.actions[0]
    const created: OperatorOrder[] = []

    for (const leg of action.legs) {
      if (state.mode === 'HALT') {
        break
      }

      const tick = ticks[leg.symbol] ?? (await marketAdapter.latest(leg.symbol))
      if (!tick) {
        continue
      }

      if (decision === 'ALLOW_REDUCE_ONLY') {
        const shouldReduce = state.positions.some((position) =>
          (position.side === 'LONG' && leg.side === 'SELL' && position.symbol === leg.symbol) ||
          (position.side === 'SHORT' && leg.side === 'BUY' && position.symbol === leg.symbol)
        )

        if (!shouldReduce) {
          continue
        }
      }

      const placed = await adapter.place({
        symbol: leg.symbol,
        side: leg.side,
        notionalUsd: leg.notionalUsd,
        idempotencyKey: `${proposal.proposalId}:${leg.symbol}:${leg.side}:${action.type}`,
        tick
      })
      created.push(placed)
    }

    let snapshot = await adapter.snapshot()
    state.positions = snapshot.positions
    state.orders = snapshot.orders
    state.realizedPnlUsd = snapshot.realizedPnlUsd
    await Promise.all([store.savePositions(state.positions), store.saveOrders(state.orders)]).catch((error) =>
      logRuntimePersistenceError('savePositionsOrders', error, { positions: state.positions.length, orders: state.orders.length })
    )

    if (adapter.closeBySize && state.positions.length > 0) {
      const dustPositions = state.positions.filter(
        (p) => Math.abs(p.notionalUsd) > 0 && !isMeaningfulPosition(p) && p.qty > 0
      )
      for (const position of dustPositions) {
        const dustTick = ticks[position.symbol] ?? (await marketAdapter.latest(position.symbol))
        if (!dustTick) continue
        const dustSide: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY'
        try {
          await adapter.closeBySize({
            symbol: position.symbol,
            side: dustSide,
            size: String(position.qty),
            tick: dustTick,
            idempotencyKey: `dust:${proposal.proposalId}:${position.symbol}:${dustSide}`
          })
        } catch (error) {
          await addAudit('execution.dust_error', 'runtime', proposal.proposalId, {
            symbol: position.symbol,
            side: dustSide,
            qty: position.qty,
            message: String(error)
          })
        }
      }
      if (dustPositions.length > 0) {
        snapshot = await adapter.snapshot()
        state.positions = snapshot.positions
        state.orders = snapshot.orders
        state.realizedPnlUsd = snapshot.realizedPnlUsd
        await Promise.all([store.savePositions(state.positions), store.saveOrders(state.orders)]).catch((error) =>
          logRuntimePersistenceError('savePositionsOrders', error, { positions: state.positions.length, orders: state.orders.length })
        )
      }
    }

    if (adapter.placeTpsl && (action.type === 'ENTER' || action.type === 'REBALANCE')) {
      const legsWithTpsl = action.legs.filter(
        (leg: any) => leg.stopLossPrice != null || leg.takeProfitPrice != null
      )

      if (legsWithTpsl.length > 0) {
        const currentSnapshot = await adapter.snapshot().catch(() => null)

        for (const leg of legsWithTpsl) {
          const position = currentSnapshot?.positions.find((p) => p.symbol === leg.symbol)
          if (!position || position.qty <= 0) continue

          const closingSide: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY'
          const tickEntry = ticks[leg.symbol]
          const fallbackTick: NormalizedTick = {
            symbol: leg.symbol,
            px: position.markPx,
            bid: position.markPx * 0.999,
            ask: position.markPx * 1.001,
            bidSize: 0,
            askSize: 0,
            updatedAt: new Date().toISOString(),
            source: 'market'
          }

          try {
            const tpsl = await adapter.placeTpsl({
              symbol: leg.symbol,
              closingSide,
              size: String(position.qty),
              stopLossPrice: (leg as any).stopLossPrice,
              takeProfitPrice: (leg as any).takeProfitPrice,
              tick: tickEntry ?? fallbackTick,
              correlationId: proposal.proposalId
            })

            await addAudit('tpsl.placed', 'runtime', proposal.proposalId, {
              symbol: leg.symbol,
              closingSide,
              stopLossPrice: (leg as any).stopLossPrice,
              takeProfitPrice: (leg as any).takeProfitPrice,
              tpOrderId: tpsl.tpOrderId,
              slOrderId: tpsl.slOrderId,
              qty: position.qty
            })
          } catch (error) {
            await addAudit('tpsl.error', 'runtime', proposal.proposalId, {
              symbol: leg.symbol,
              error: String(error)
            })
          }
        }
      }
    }

    if (action.type === 'EXIT') {
      if (!hasAnyExposure(state.positions)) {
        activeThesis = null
      }
    } else if (hasAnyExposure(state.positions)) {
      activeThesis = {
        thesisId: proposal.thesis?.thesisId ?? proposal.proposalId,
        symbols: [...new Set(action.legs.map((leg) => leg.symbol))]
      }
    }

    await bus.publish('hlp.execution.commands', {
      type: 'execution.complete',
      stream: 'hlp.execution.commands',
      source: 'runtime',
      correlationId: proposal.proposalId,
      actorType: 'system',
      actorId: 'runtime',
      payload: {
        proposalId: proposal.proposalId,
        placed: created,
        mode: state.mode
      }
    })

    await bus.publish('hlp.ui.events', {
      type: 'POSITION_UPDATE',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId: proposal.proposalId,
      actorType: 'system',
      actorId: 'runtime',
      payload: snapshot.positions
    })

    await bus.publish('hlp.ui.events', {
      type: 'ORDER_UPDATE',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId: proposal.proposalId,
      actorType: 'system',
      actorId: 'runtime',
      payload: snapshot.orders
    })

    await addAudit('execution', 'runtime', proposal.proposalId, {
      proposalId: proposal.proposalId,
      orderCount: created.length,
      mode: state.mode,
      decision
    })
  }

  const addAudit = async (
    action: string,
    actor: string,
    correlationId: string,
    details: unknown,
    resource = 'runtime'
  ) => {
    const event: AuditEvent = {
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'system',
      actorId: actor,
      action,
      resource,
      correlationId,
      details: details as Record<string, unknown>
    }

    // Audit persistence is handled by the API consumer of hlp.audit.events (single-writer).
    await bus.publish('hlp.audit.events', {
      type: 'RUNTIME_DECISION',
      stream: 'hlp.audit.events',
      source: 'runtime',
      correlationId,
      actorType: 'system',
      actorId: actor,
      payload: event
    })
  }

  const publishRiskDecision = async (risk: { decision: RiskDecision; reasons: Array<{ code: string; message: string; details?: Record<string, unknown> }> ; correlationId: string; decisionId: string; computedAt: string; computed: { grossExposureUsd: number; netExposureUsd: number; projectedDrawdownPct: number; notionalImbalancePct: number } }, source: string, correlationId: string) => {
    await bus.publish('hlp.risk.decisions', {
      type: 'risk.decision',
      stream: 'hlp.risk.decisions',
      source,
      correlationId,
      actorType: 'system',
      actorId: 'runtime',
      payload: {
        decision: risk.decision,
        reasons: risk.reasons,
        computed: risk.computed,
        computedAt: risk.computedAt,
        decisionId: risk.decisionId,
        proposalCorrelation: correlationId
      }
    })

    await addAudit('risk.decision', 'runtime', correlationId, {
      decision: risk.decision,
      reasons: risk.reasons,
      computed: risk.computed,
      computedAt: risk.computedAt,
      decisionId: risk.decisionId,
      proposalCorrelation: correlationId
    }, 'runtime.risk')
  }

  const attemptRiskAutoMitigation = async (
    proposalId: string,
    reasonMessage: string,
    reasons: Array<{ code: string; message: string; details?: Record<string, unknown> }>
  ): Promise<boolean> => {
    if (!hasAnyExposure()) {
      return false
    }

    const mitigationCodes = new Set([
      'DRAWDOWN',
      'EXPOSURE',
      'LEVERAGE',
      'SAFE_MODE',
      'DEPENDENCY_FAILURE',
      'NOTIONAL_PARITY',
      'STALE_DATA',
      'LIQUIDITY',
      'SLIPPAGE_BREACH',
      'SYSTEM_GATED'
    ])
    if (!reasons.some((entry) => mitigationCodes.has(String(entry.code).toUpperCase()))) {
      markInfraRecovered()
      return false
    }

    const reasonCodes = [...new Set(reasons
      .map((entry) => String(entry.code).trim().toUpperCase())
      .filter((entry) => entry.length > 0)
    )]
    const infraOnlyCodes = new Set(['SAFE_MODE', 'DEPENDENCY_FAILURE', 'STALE_DATA', 'SYSTEM_GATED'])
    const hardRiskCodes = new Set(['DRAWDOWN', 'EXPOSURE', 'LEVERAGE', 'LIQUIDITY', 'SLIPPAGE_BREACH', 'NOTIONAL_PARITY'])
    const isInfraOnlyMitigation = reasonCodes.length > 0 && reasonCodes.every((code) => infraOnlyCodes.has(code))
    const hasHardRiskSignal = reasonCodes.some((code) => hardRiskCodes.has(code))

    const reasonSignature = reasonCodes.sort().join('|') || 'no_reason'
    const nowMs = Date.now()

    if (isInfraOnlyMitigation && !hasHardRiskSignal) {
      if (firstInfraFailureAtMs === 0) {
        firstInfraFailureAtMs = nowMs
      }
      const outageMs = nowMs - firstInfraFailureAtMs
      if (outageMs < infraAutoFlattenMinOutageMs) {
        const remainingMin = Math.ceil((infraAutoFlattenMinOutageMs - outageMs) / 60_000)
        if (nowMs - lastInfraAutoFlattenNoticeAtMs >= infraAutoFlattenNoticeCooldownMs) {
          lastInfraAutoFlattenNoticeAtMs = nowMs
          await publishStateUpdate(
            proposalId,
            `risk degraded (${reasonMessage}); holding positions, auto-flatten deferred (remaining ~${remainingMin}m before eligibility)`
          )
        }
        return false
      }

      const grossUsd = exposureUsd(state.positions)
      const accountValueUsd = resolveRuntimeAccountValueUsd()
      const flattenEligibility = computeInfraAutoFlattenEligibility({
        grossUsd,
        accountValueUsd: accountValueUsd > 0 ? accountValueUsd : null,
        minGrossUsd: infraAutoFlattenMinGrossUsd,
        minGrossPct: infraAutoFlattenMinGrossPct,
        minimumMeaningfulExposureUsd: minimumFlatExposureUsd
      })
      if (!flattenEligibility.eligible) {
        if (nowMs - lastInfraAutoFlattenNoticeAtMs >= infraAutoFlattenNoticeCooldownMs) {
          lastInfraAutoFlattenNoticeAtMs = nowMs
          const grossPctLabel =
            flattenEligibility.grossPct === null ? 'na' : `${(flattenEligibility.grossPct * 100).toFixed(1)}%`
          await publishStateUpdate(
            proposalId,
            `risk degraded (${reasonMessage}); outage>${Math.floor(infraAutoFlattenMinOutageMs / 60_000)}m but flatten skipped (gross=${grossUsd.toFixed(
              2
            )} usd, pct=${grossPctLabel}, minUsd=${flattenEligibility.effectiveMinGrossUsd.toFixed(2)}, minPct=${(
              infraAutoFlattenMinGrossPct * 100
            ).toFixed(1)}%)`
          )
        }
        return false
      }
    } else {
      markInfraRecovered()
    }

    if (reasonSignature === lastRiskAutoMitigationSignature && nowMs - lastRiskAutoMitigationAtMs < RISK_AUTO_MITIGATION_COOLDOWN_MS) {
      return false
    }

    lastRiskAutoMitigationSignature = reasonSignature
    lastRiskAutoMitigationAtMs = nowMs

    if (state.mode !== 'SAFE_MODE') {
      await setMode('SAFE_MODE', `risk auto-mitigation (${reasonSignature})`)
    }
    await publishStateUpdate(
      proposalId,
      `risk denied (${reasonMessage}); auto-mitigation started for ${reasonSignature}, flatten requested`
    )
    await handleCommand(
      '/flatten',
      'internal_agent',
      'runtime-autofix',
      [],
      'risk auto-mitigation',
      OPERATOR_ADMIN_ROLE,
      ['command.execute']
    )
    runtimeProposalCounter.inc({ status: 'risk_auto_mitigated' })
    return true
  }

  async function handleCommand(
    command: string,
    actorType: ActorType,
    actorId: string,
    args: string[],
    reason: string,
    actorRole?: Role,
    capabilities: string[] = []
  ): Promise<{ ok: true; message: string }> {
    const parsedCommand = OperatorCommandNameSchema.safeParse(command)
    if (!parsedCommand.success) {
      runtimeCommandCounter.inc({ command, result: 'parse_error' })
      await addAudit('command.parse_error', actorId, envelopeId(), {
        actorType,
        command,
        args,
        reason
      }, 'runtime.command')

      return { ok: true, message: `unsupported command ${command}` }
    }

    const commandName = parsedCommand.data
    const policy = commandPolicy(commandName)

    if (!policy.allowedActorTypes.includes(actorType)) {
      runtimeCommandCounter.inc({ command, result: 'forbidden_actor' })
      await addAudit('command.forbidden', actorId, envelopeId(), {
        command,
        actorType,
        actorRole,
        capabilities,
        reason: 'actor type denied by command policy'
      }, 'runtime.command')

      return { ok: true, message: `command ${command} forbidden for actor type ${actorType}` }
    }

    if (
      policy.requiredRoles.length > 0 &&
      !(
        actorRole &&
        policy.requiredRoles.includes(actorRole) &&
        [
          OPERATOR_VIEW_ROLE,
          OPERATOR_ADMIN_ROLE
        ].includes(actorRole)
      )
    ) {
      runtimeCommandCounter.inc({ command, result: 'forbidden_role' })
      await addAudit('command.forbidden', actorId, envelopeId(), {
        command,
        actorType,
        actorRole,
        capabilities,
        requiredRoles: policy.requiredRoles,
        reason: 'missing required role'
      }, 'runtime.command')

      return { ok: true, message: `command ${command} requires operator role` }
    }

    if (!policy.requiredCapabilities.every((requiredCapability) => capabilities.includes(requiredCapability))) {
      runtimeCommandCounter.inc({ command, result: 'forbidden_capability' })
      await addAudit('command.forbidden', actorId, envelopeId(), {
        command,
        actorType,
        actorRole,
        capabilities,
        requiredCapabilities: policy.requiredCapabilities,
        reason: 'missing required capability'
      }, 'runtime.command')

      return { ok: true, message: `command ${command} missing required capability` }
    }

    const commandAuditId = envelopeId()
    void store.saveCommand({
      command: commandName,
      actorType,
      actorId,
      reason,
      args
    }).catch((error) => logRuntimePersistenceError('saveCommand', error, { actorId, command }))

    runtimeCommandCounter.inc({ command, result: 'accepted' })
    await addAudit('command', actorId, commandAuditId, {
      actorType,
      command,
      args,
      reason
    }, 'runtime.command')

    if (commandName === '/halt') {
      await setMode('HALT', reason)
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: 'halted' }
    }

    if (commandName === '/resume') {
      await setMode('READY', reason)
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: 'resumed' }
    }

    if (commandName === '/flatten') {
      const current = await adapter.snapshot()
      for (const order of current.orders) {
        if (order.status !== 'FILLED' && order.status !== 'CANCELLED') {
          await adapter.cancel(order.orderId, 'flatten command')
        }
      }

      const closeOrders: Array<{ symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number }> = []
      for (const position of current.positions) {
        const notionalUsd = Math.abs(position.notionalUsd)
        if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
          continue
        }

        let tick = await marketAdapter.latest(position.symbol)
        if (!tick) {
          const snapshot = await fetchHyperliquidL2BookSnapshotCached({
            postInfo: hlClient?.postInfo,
            infoUrl: env.HL_INFO_URL,
            coin: position.symbol,
            cache: l2BookDepthCache
          })
          if (snapshot) {
            tick = {
              symbol: position.symbol,
              px: snapshot.px,
              bid: snapshot.bidPx,
              ask: snapshot.askPx,
              bidSize: snapshot.bidPx > 0 ? snapshot.bidDepthUsd / snapshot.bidPx : 0,
              askSize: snapshot.askPx > 0 ? snapshot.askDepthUsd / snapshot.askPx : 0,
              updatedAt: snapshot.updatedAtIso,
              source: 'runtime.market.l2book'
            }
          }
        }

        if (!tick) {
          const fallbackPx = Number(position.markPx ?? position.avgEntryPx)
          if (!Number.isFinite(fallbackPx) || fallbackPx <= 0) {
            continue
          }

          tick = {
            symbol: position.symbol,
            px: fallbackPx,
            bid: fallbackPx,
            ask: fallbackPx,
            bidSize: 1,
            askSize: 1,
            updatedAt: new Date().toISOString(),
            source: 'runtime.market.position-fallback'
          }
        }

        if (!tick) {
          continue
        }

        const side: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY'
        closeOrders.push({
          symbol: position.symbol,
          side,
          notionalUsd
        })

        try {
          await adapter.place({
            symbol: position.symbol,
            side,
            notionalUsd,
            idempotencyKey: `flatten:${commandAuditId}:${position.symbol}:${side}`,
            tick
          })
        } catch (error) {
          await addAudit('flatten.place_error', actorId, commandAuditId, {
            symbol: position.symbol,
            side,
            notionalUsd,
            message: String(error)
          }, 'runtime.command')
          continue
        }
      }

      const snapshot = await adapter.snapshot()
      state.positions = snapshot.positions
      state.orders = snapshot.orders
      state.realizedPnlUsd = snapshot.realizedPnlUsd
      await Promise.all([store.savePositions(state.positions), store.saveOrders(state.orders)]).catch((error) =>
      logRuntimePersistenceError('savePositionsOrders', error, { positions: state.positions.length, orders: state.orders.length })
    )

      // Dust sweep: close any remaining sub-dust positions by exact size.
      if (adapter.closeBySize && state.positions.length > 0) {
        const DUST_THRESHOLD_USD = 10
        const dustPositions = state.positions.filter(
          (p) => Math.abs(p.notionalUsd) > 0 && Math.abs(p.notionalUsd) < DUST_THRESHOLD_USD && p.qty > 0
        )
        for (const position of dustPositions) {
          let dustTick = await marketAdapter.latest(position.symbol)
          if (!dustTick) {
            const fallbackPx = Number(position.markPx ?? position.avgEntryPx)
            if (Number.isFinite(fallbackPx) && fallbackPx > 0) {
              dustTick = {
                symbol: position.symbol,
                px: fallbackPx,
                bid: fallbackPx,
                ask: fallbackPx,
                bidSize: 1,
                askSize: 1,
                updatedAt: new Date().toISOString(),
                source: 'runtime.market.position-fallback'
              }
            }
          }
          if (!dustTick) continue
          const dustSide: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY'
          try {
            await adapter.closeBySize({
              symbol: position.symbol,
              side: dustSide,
              size: String(position.qty),
              tick: dustTick,
              idempotencyKey: `flatten:dust:${commandAuditId}:${position.symbol}:${dustSide}`
            })
          } catch (error) {
            await addAudit('flatten.dust_error', actorId, commandAuditId, {
              symbol: position.symbol,
              side: dustSide,
              qty: position.qty,
              message: String(error)
            }, 'runtime.command')
          }
        }
        // Re-snapshot after dust cleanup
        if (dustPositions.length > 0) {
          const dustSnapshot = await adapter.snapshot()
          state.positions = dustSnapshot.positions
          state.orders = dustSnapshot.orders
          state.realizedPnlUsd = dustSnapshot.realizedPnlUsd
          await Promise.all([store.savePositions(state.positions), store.saveOrders(state.orders)]).catch((error) =>
          logRuntimePersistenceError('savePositionsOrders', error, { positions: state.positions.length, orders: state.orders.length })
        )
        }
      }

      await addAudit('flatten.execute', actorId, commandAuditId, {
        closedLegs: closeOrders,
        resultingPositions: state.positions.length,
        resultingGrossUsd: exposureUsd(state.positions)
      }, 'runtime.command')

      if (state.mode !== 'HALT') {
        if (hasAnyExposure(state.positions)) {
          if (state.mode !== 'SAFE_MODE') {
            await setMode('SAFE_MODE', reason)
          }
        } else if (state.mode !== 'READY') {
          await setMode('READY', reason)
        }
      }
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: `flatten executed (${closeOrders.length} close legs)` }
    }

    if (commandName === '/risk-policy') {
      const parsed = parseRiskPolicyArgs(args)
      if ('message' in parsed) {
        runtimeCommandCounter.inc({ command, result: 'invalid_arguments' })
        await addAudit('command.invalid', actorId, commandAuditId, {
          command,
          args,
          reason,
          errors: parsed
        }, 'runtime.command')
        return { ok: true, message: `risk-policy rejected: ${parsed.message}` }
      }

      const nextPolicy = parsed.patch
      runtimeRiskPolicy = nextPolicy
      await publishStateUpdate(commandAuditId, `risk policy updated: ${Object.keys(nextPolicy).join(',')}`)
      await addAudit('risk_policy.update', actorId, commandAuditId, {
        command,
        actorType,
        applied: nextPolicy,
        reason
      }, 'runtime.command')

      runtimeCommandCounter.inc({ command, result: 'executed' })
      return {
        ok: true,
        message: `risk policy updated (${Object.entries(nextPolicy).map(([key, value]) => `${key}=${value}`).join(', ')})`
      }
    }

    if (commandName === '/status') {
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: `state:${state.mode} pnl:${state.pnlPct}% cycle:${state.cycle}` }
    }

    if (commandName === '/explain') {
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return {
        ok: true,
        message: `state=${state.mode},drift=${state.driftState},cycle=${state.cycle},positions=${state.positions.length},orders=${state.orders.length}`
      }
    }

    if (commandName === '/positions') {
      const summary = state.positions.map((position) => `${position.symbol}:${position.side}`).join(', ')
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: summary || 'no positions' }
    }

    await bus.publish('hlp.ui.events', {
      type: 'COMMAND',
      stream: 'hlp.ui.events',
      source: 'runtime',
      correlationId: commandAuditId,
      actorType,
      actorId: actorId,
      payload: { command, args, reason }
    })
    runtimeCommandCounter.inc({ command, result: 'queued' })
    return { ok: true, message: `command ${command} queued` }
  }

  const runCommand = async (
    command: string,
    actorType: ActorType,
    actorId: string,
    args: string[],
    reason: string,
    actorRole?: Role,
    capabilities?: string[]
  ) => {
    return handleCommand(command, actorType, actorId, args, reason, actorRole, capabilities)
  }

  const startReconcile = async () => {
    reconcileTimer = setInterval(() => {
      if (stopped || reconcileRunning) {
        return
      }

      reconcileRunning = true
      void (async () => {
        try {
          const report = await adapter.reconcile()
          const mismatches = report.filter((r) => r.status === 'FAILED')
          const severity = mismatches.length > 0 ? 'CRITICAL' : 'INFO'

          await bus.publish('hlp.execution.fills', {
            type: 'reconcile.report',
            stream: 'hlp.execution.fills',
            source: 'runtime',
            correlationId: envelopeId(),
            actorType: 'system',
            actorId: 'runtime',
            payload: {
              generatedAt: new Date().toISOString(),
              severity,
              mismatchCount: mismatches.length,
              totalOrders: report.length
            }
          })

          if (mismatches.length > 0) {
            await setMode('SAFE_MODE', 'reconciliation mismatch')
            await addAudit('reconcile_mismatch', 'runtime', envelopeId(), {
              severity,
              mismatches
            })
          }
        } catch (error) {
          await addAudit('reconcile_error', 'runtime', envelopeId(), {
            message: String(error)
          })
        } finally {
          reconcileRunning = false
        }
      })()
    }, 30_000)
  }

  const stop = async () => {
    if (stopped) {
      return
    }

    stopped = true
    if (timer) {
      clearInterval(timer)
    }
    if (reconcileTimer) {
      clearInterval(reconcileTimer)
    }
    const consumerStopTasks = consumerStops.splice(0, consumerStops.length).map((stopConsumer) => stopConsumer())
    await Promise.allSettled(consumerStopTasks)
    await pluginManager.stop()
    await marketAdapter.stop()
    await store.close()
  }

  await addAudit('execution.mode', 'runtime', envelopeId(), {
    mode: env.ENABLE_LIVE_OMS ? 'LIVE' : 'SIM',
    reason: 'runtime startup adapter selection'
  }, 'runtime.execution')

  await startReconcile()
  timer = setInterval(() => void runCycle(), env.CYCLE_MS)

  return {
    getState: () => state,
    getPositions: () => [...state.positions],
    getOrders: () => [...state.orders],
    runCommand,
    stop
  }
}

function markToMarketPositions(
  positions: OperatorPosition[],
  ticks: Record<string, { symbol: string; px: number; updatedAt: string }>,
  nowIso: string
): { positions: OperatorPosition[]; unrealizedPnlUsd: number } {
  let unrealizedPnlUsd = 0

  const marked = positions
    .map((position) => {
      const tick = ticks[position.symbol]
      const markPx = tick?.px ?? position.markPx ?? position.avgEntryPx
      const qty = Math.abs(position.qty)
      const signedQty = position.side === 'LONG' ? qty : -qty
      const pnlUsd = (markPx - position.avgEntryPx) * signedQty
      unrealizedPnlUsd += pnlUsd

      return {
        ...position,
        qty,
        markPx,
        notionalUsd: qty * markPx,
        pnlUsd,
        updatedAt: nowIso
      }
    })
    .filter((position) => Math.abs(position.qty) > 1e-9)

  return { positions: marked, unrealizedPnlUsd }
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


function envelopeId() {
  return ulid()
}

const DEFAULT_HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const DEFAULT_L2_BOOK_CACHE_TTL_MS = 2500
const DEFAULT_L2_BOOK_LEVELS = 20
const DEFAULT_L2_BOOK_TIMEOUT_MS = 3000

type L2BookSnapshot = {
  bidPx: number
  askPx: number
  px: number
  bidDepthUsd: number
  askDepthUsd: number
  updatedAtIso: string
}

type L2BookDepthCache = Map<
  string,
  { bidPx: number; askPx: number; bidDepthUsd: number; askDepthUsd: number; fetchedAtMs: number; updatedAtIso: string }
>

interface HyperliquidL2Level {
  px: string
  sz: string
  n: number
}

interface HyperliquidL2BookResponse {
  coin: string
  time: number
  levels: [HyperliquidL2Level[], HyperliquidL2Level[]]
}

async function augmentTicksWithL2BookDepth(params: {
  postInfo?: <T>(body: unknown) => Promise<T>
  infoUrl?: string
  proposal: StrategyProposal
  ticks: Record<string, NormalizedTick>
  cache: L2BookDepthCache
  ttlMs?: number
  levels?: number
  timeoutMs?: number
}): Promise<void> {
  const ttlMs = params.ttlMs ?? DEFAULT_L2_BOOK_CACHE_TTL_MS
  const levels = params.levels ?? DEFAULT_L2_BOOK_LEVELS
  const timeoutMs = params.timeoutMs ?? DEFAULT_L2_BOOK_TIMEOUT_MS

  const symbols = new Set(params.proposal.actions.flatMap((action) => action.legs.map((leg) => leg.symbol)))
  const nowMs = Date.now()

  await Promise.all(
    [...symbols].map(async (symbol) => {
      const snapshot = await fetchHyperliquidL2BookSnapshotCached({
        postInfo: params.postInfo,
        infoUrl: params.infoUrl,
        coin: symbol,
        cache: params.cache,
        ttlMs,
        levels,
        timeoutMs,
        nowMs
      })
      if (!snapshot) {
        return
      }

      const tick: NormalizedTick = params.ticks[symbol] ?? {
        symbol,
        px: snapshot.px,
        bid: snapshot.bidPx,
        ask: snapshot.askPx,
        bidSize: 0,
        askSize: 0,
        updatedAt: snapshot.updatedAtIso,
        source: 'runtime.market.l2book'
      }

      applyL2BookSnapshotToTick(tick, snapshot)
      params.ticks[symbol] = tick
    })
  )
}

function applyL2BookSnapshotToTick(tick: NormalizedTick, snapshot: L2BookSnapshot): void {
  tick.bid = snapshot.bidPx
  tick.ask = snapshot.askPx
  tick.px = snapshot.px
  tick.updatedAt = snapshot.updatedAtIso
  tick.bidSize = snapshot.bidPx > 0 ? snapshot.bidDepthUsd / snapshot.bidPx : 0
  tick.askSize = snapshot.askPx > 0 ? snapshot.askDepthUsd / snapshot.askPx : 0
}

async function fetchHyperliquidL2BookSnapshotViaClient(
  postInfo: <T>(body: unknown) => Promise<T>,
  coin: string,
  levels: number
): Promise<L2BookSnapshot | null> {
  try {
    const payload = await postInfo<Partial<HyperliquidL2BookResponse>>({ type: 'l2Book', coin })
    const book = coerceL2BookResponse(payload)
    if (!book) return null

    const bids = Array.isArray(book.levels[0]) ? book.levels[0] : []
    const asks = Array.isArray(book.levels[1]) ? book.levels[1] : []
    const bestBid = parseFiniteNumber(bids[0]?.px) ?? 0
    const bestAsk = parseFiniteNumber(asks[0]?.px) ?? 0
    const px = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Math.max(bestBid, bestAsk)
    if (!Number.isFinite(px) || px <= 0) return null

    return {
      bidPx: bestBid > 0 ? bestBid : px,
      askPx: bestAsk > 0 ? bestAsk : px,
      px,
      bidDepthUsd: sumLevelsUsd(bids, levels),
      askDepthUsd: sumLevelsUsd(asks, levels),
      // Use fetch-time freshness for risk staleness checks; exchange event timestamps can lag a few seconds.
      updatedAtIso: new Date().toISOString()
    }
  } catch (error) {
    console.warn('[runtime-state] hyperliquid l2Book fetch via client failed', { coin }, error) // eslint-disable-line no-console
    return null
  }
}

async function fetchHyperliquidL2BookSnapshot(infoUrl: string, coin: string, levels: number, timeoutMs: number): Promise<L2BookSnapshot | null> {
  const retries = 2
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(infoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'l2Book', coin }),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`hyperliquid l2Book http ${response.status}`)
      }

      const payload = (await response.json()) as Partial<HyperliquidL2BookResponse>
      const book = coerceL2BookResponse(payload)
      if (!book) {
        throw new Error('invalid l2Book payload')
      }

      const bids = Array.isArray(book.levels[0]) ? book.levels[0] : []
      const asks = Array.isArray(book.levels[1]) ? book.levels[1] : []

      const bestBid = parseFiniteNumber(bids[0]?.px) ?? 0
      const bestAsk = parseFiniteNumber(asks[0]?.px) ?? 0
      const px = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Math.max(bestBid, bestAsk)
      if (!Number.isFinite(px) || px <= 0) {
        throw new Error('invalid l2Book price')
      }

      return {
        bidPx: bestBid > 0 ? bestBid : px,
        askPx: bestAsk > 0 ? bestAsk : px,
        px,
        bidDepthUsd: sumLevelsUsd(bids, levels),
        askDepthUsd: sumLevelsUsd(asks, levels),
        // Use fetch-time freshness for risk staleness checks; exchange event timestamps can lag a few seconds.
        updatedAtIso: new Date().toISOString()
      }
    } catch (error) {
      if (attempt >= retries) {
        console.warn('[runtime-state] hyperliquid l2Book fetch failed after retries', { attempt, coin, infoUrl }, error) // eslint-disable-line no-console
        return null
      }

      console.warn('[runtime-state] hyperliquid l2Book retrying', { attempt, coin, infoUrl, error }) // eslint-disable-line no-console

      const backoffMs = 120 * (attempt + 1) + Math.floor(Math.random() * 120)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
}

async function fetchHyperliquidL2BookSnapshotCached(params: {
  postInfo?: <T>(body: unknown) => Promise<T>
  infoUrl?: string
  coin: string
  cache: L2BookDepthCache
  ttlMs?: number
  levels?: number
  timeoutMs?: number
  nowMs?: number
}): Promise<L2BookSnapshot | null> {
  const ttlMs = params.ttlMs ?? DEFAULT_L2_BOOK_CACHE_TTL_MS
  const levels = params.levels ?? DEFAULT_L2_BOOK_LEVELS
  const timeoutMs = params.timeoutMs ?? DEFAULT_L2_BOOK_TIMEOUT_MS
  const nowMs = params.nowMs ?? Date.now()

  const cached = params.cache.get(params.coin)
  if (cached && nowMs - cached.fetchedAtMs < ttlMs) {
    const px = cached.bidPx > 0 && cached.askPx > 0 ? (cached.bidPx + cached.askPx) / 2 : Math.max(cached.bidPx, cached.askPx)
    if (!Number.isFinite(px) || px <= 0) {
      return null
    }
    return {
      bidPx: cached.bidPx,
      askPx: cached.askPx,
      px,
      bidDepthUsd: cached.bidDepthUsd,
      askDepthUsd: cached.askDepthUsd,
      updatedAtIso: cached.updatedAtIso
    }
  }

  const snapshot = params.postInfo
    ? await fetchHyperliquidL2BookSnapshotViaClient(params.postInfo, params.coin, levels)
    : await fetchHyperliquidL2BookSnapshot(params.infoUrl ?? DEFAULT_HL_INFO_URL, params.coin, levels, timeoutMs)
  if (!snapshot) {
    return null
  }

  params.cache.set(params.coin, {
    bidPx: snapshot.bidPx,
    askPx: snapshot.askPx,
    bidDepthUsd: snapshot.bidDepthUsd,
    askDepthUsd: snapshot.askDepthUsd,
    updatedAtIso: snapshot.updatedAtIso,
    fetchedAtMs: nowMs
  })
  return snapshot
}

function coerceL2BookResponse(payload: Partial<HyperliquidL2BookResponse>): HyperliquidL2BookResponse | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  if (typeof payload.coin !== 'string' || payload.coin.length === 0) {
    return null
  }
  if (typeof payload.time !== 'number' || !Number.isFinite(payload.time)) {
    return null
  }
  if (!Array.isArray(payload.levels) || payload.levels.length < 2) {
    return null
  }

  const bids = Array.isArray(payload.levels[0]) ? (payload.levels[0] as HyperliquidL2Level[]) : []
  const asks = Array.isArray(payload.levels[1]) ? (payload.levels[1] as HyperliquidL2Level[]) : []

  return {
    coin: payload.coin,
    time: payload.time,
    levels: [bids, asks]
  }
}

function sumLevelsUsd(levels: HyperliquidL2Level[], limit: number): number {
  let depthUsd = 0
  for (const level of levels.slice(0, Math.max(0, limit))) {
    const px = parseFiniteNumber(level?.px)
    const sz = parseFiniteNumber(level?.sz)
    if (px === null || sz === null || px <= 0 || sz <= 0) {
      continue
    }
    depthUsd += px * sz
  }

  return depthUsd
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function createMarketAdapterLazy(env: RuntimeEnv, bus: EventBus): Promise<MarketDataAdapter> {
  const { createMarketAdapter } = await import('../services/market')
  return createMarketAdapter(env, bus)
}
