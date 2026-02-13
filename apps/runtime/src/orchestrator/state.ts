import {
  ActorType,
  commandPolicy,
  OPERATOR_ADMIN_ROLE,
  OPERATOR_VIEW_ROLE,
  Role,
  OperatorCommandNameSchema,
  RoleSchema,
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
import { RuntimeEnv } from '../config'
import { canTransition } from '../state-machine'
import { ulid } from 'ulid'
import promClient from 'prom-client'

interface LoopConfig {
  env: RuntimeEnv
  bus: EventBus
}

export interface RuntimeState {
  mode: TradeState
  pnlPct: number
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

void promClient.collectDefaultMetrics()

function driftFrom(state: RuntimeState): 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH' {
  if (state.positions.length === 0) {
    return 'IN_TOLERANCE'
  }

  const longs = state.positions.filter((position) => position.side === 'LONG').reduce((acc, position) => acc + Math.max(0, position.notionalUsd), 0)
  const shorts = state.positions.filter((position) => position.side === 'SHORT').reduce((acc, position) => acc + Math.max(0, -position.notionalUsd), 0)
  const gross = longs + shorts
  const mismatch = Math.abs(longs - shorts)
  const pct = gross === 0 ? 0 : mismatch / gross

  if (pct > 0.2) {
    return 'BREACH'
  }

  if (pct > 0.05) {
    return 'POTENTIAL_DRIFT'
  }

  return 'IN_TOLERANCE'
}

function setModeGauge(mode: TradeState): void {
  runtimeCycleMode.reset()
  runtimeCycleMode.labels({ mode }).set(1)
}

export async function createRuntime({ env, bus }: LoopConfig): Promise<RuntimeHandle> {
  const adapter = env.ENABLE_LIVE_OMS ? createLiveAdapter() : createSimAdapter(10, 25)
  const marketAdapter = await createMarketAdapterLazy(env, bus)
  const pluginManager = await createRuntimePluginManager(bus)
  const state: RuntimeState = {
    mode: 'INIT',
    pnlPct: 0,
    driftState: 'IN_TOLERANCE',
    lastUpdateAt: new Date().toISOString(),
    cycle: 0,
    positions: [],
    orders: []
  }

  setModeGauge(state.mode)

  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let loopRunning = false

  const riskConfig: RiskConfig = {
    maxLeverage: env.RISK_MAX_LEVERAGE,
    maxDrawdownPct: env.RISK_MAX_DRAWDOWN_PCT,
    maxExposureUsd: env.RISK_MAX_NOTIONAL_USD,
    maxSlippageBps: env.RISK_MAX_SLIPPAGE_BPS,
    staleDataMs: env.RISK_STALE_DATA_MS,
    liquidityBufferPct: env.RISK_LIQUIDITY_BUFFER_PCT,
    notionalParityTolerance: env.RISK_NOTIONAL_PARITY_TOLERANCE,
    failClosedOnDependencyError: true
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
      driftState: state.driftState,
      healthCode: 'GREEN',
      lastUpdateAt: state.lastUpdateAt
    }
  })

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
    state.driftState = driftFrom(state)
    setModeGauge(mode)

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
        driftState: state.driftState,
        healthCode: mode === 'SAFE_MODE' || mode === 'HALT' ? 'RED' : 'GREEN',
        lastUpdateAt: state.lastUpdateAt
      }
    })
  }

  await setMode('WARMUP', 'startup complete')
  await setMode('READY', 'runtime ready')

  bus.consume('hlp.commands', '$', async (envelope) => {
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
    }
  })

  const runCycle = async (_urgency = false) => {
    if (stopped || loopRunning) {
      return
    }

    loopRunning = true
    runtimeCycleCounter.inc()
    const endCycleTimer = runtimeCycleDurationMs.startTimer()
    try {
      if (state.mode === 'HALT') {
        runtimeProposalCounter.inc({ status: 'skipped' })
        return
      }

      const targetNotional = env.BASKET_TARGET_NOTIONAL_USD
      const proposalCandidate = buildProposal(state, targetNotional, env.BASKET_SYMBOLS)
      const parsedProposal = parseStrategyProposal(proposalCandidate)
      if (!parsedProposal.ok) {
        const reasons = parsedProposal.errors.map((error: { code: string; message: string; path?: unknown[] }) => ({
          code: error.code,
          message: error.message,
          details: error.path ? { path: error.path } : undefined
        }))

        await addAudit('proposal.parse_error', 'runtime', proposalCandidate.proposalId, {
          action: 'parse_error',
          proposal: proposalCandidate,
          reasons
        })

        await publishRiskDecision(
          {
            decision: 'DENY',
            reasons,
            correlationId: proposalCandidate.proposalId,
            decisionId: `dec-${proposalCandidate.proposalId}`,
            computedAt: new Date().toISOString(),
            computed: {
              grossExposureUsd: 0,
              netExposureUsd: 0,
              projectedDrawdownPct: 0,
              notionalImbalancePct: 100
            }
          },
          'PARSE_ERROR',
          proposalCandidate.proposalId
        )

        runtimeProposalCounter.inc({ status: 'parse_error' })
        runtimeRiskDecisionCounter.inc({ decision: 'DENY' })
        return
      }

      const proposal = parsedProposal.proposal
      runtimeProposalCounter.inc({ status: 'parsed' })
      await addAudit('proposal.generated', 'runtime', proposal.proposalId, {
        proposalId: proposal.proposalId,
        cycleId: proposal.cycleId,
        actionCount: proposal.actions.length,
        summary: proposal.summary,
        requestedMode: proposal.requestedMode
      })

      const tickSymbols = new Set<string>(['HYPE', ...env.BASKET_SYMBOLS.split(',').map((symbol) => symbol.trim()).filter(Boolean)])
      const ticks: Record<string, { symbol: string; px: number; bid: number; ask: number; bidSize?: number; askSize?: number; updatedAt: string }> = {}

      for (const symbol of tickSymbols) {
        const tick = await marketAdapter.latest(symbol)
        if (tick) {
          ticks[symbol] = tick
        }
      }

      const dependencyHealth = await bus.health()
      const risk = evaluateRisk(riskConfig, {
        state: state.mode,
        actorType: 'system',
        accountValueUsd: env.ACCOUNT_VALUE_USD,
        dependenciesHealthy: dependencyHealth.ok,
        openPositions: state.positions,
        ticks,
        proposal
      })
      runtimeRiskDecisionCounter.inc({ decision: risk.decision })

      await publishRiskDecision(risk, 'RISK_EVAL', proposal.proposalId)
      if (risk.decision === 'DENY') {
        runtimeProposalCounter.inc({ status: 'risk_denied' })
        if (risk.reasons.some((entry) => entry.code === 'DEPENDENCY_FAILURE')) {
          await setMode('SAFE_MODE', 'risk dependency failure')
        }
        return
      }

      const previousMode = state.mode
      await execute(proposal, risk.decision)
      runtimeProposalCounter.inc({ status: 'executed' })
      if (previousMode === 'READY' && state.positions.length > 0) {
        await setMode('IN_TRADE', 'trade entry')
      } else if (state.mode === 'IN_TRADE') {
        await setMode('REBALANCE', 'rebalance')
      }

      state.lastUpdateAt = new Date().toISOString()
      state.cycle += 1
      state.pnlPct = Number((Math.sin(state.cycle / 5) * 5).toFixed(3))
      state.driftState = driftFrom(state)

      if (state.driftState === 'BREACH' && state.mode === 'IN_TRADE') {
        await setMode('SAFE_MODE', 'drift breach')
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
    } catch (error) {
      await setMode('SAFE_MODE', `runtime error: ${String(error)}`)
      await addAudit('runtime_error', 'runtime', envelopeId(), {
        message: String(error)
      })
      runtimeCycleErrorCounter.inc()
    } finally {
      endCycleTimer()
      loopRunning = false
    }
  }

  const execute = async (proposal: StrategyProposal, decision: RiskDecision): Promise<void> => {
    const action = proposal.actions[0]
    const created: OperatorOrder[] = []

    for (const leg of action.legs) {
      const tick = await marketAdapter.latest(leg.symbol)
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

    const snapshot = await adapter.snapshot()
    state.positions = snapshot.positions
    state.orders = snapshot.orders

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
    await bus.publish('hlp.audit.events', {
      type: 'RUNTIME_DECISION',
      stream: 'hlp.audit.events',
      source: 'runtime',
      correlationId,
      actorType: 'system',
      actorId: actor,
      payload: {
        id: ulid(),
        ts: new Date().toISOString(),
        actorType: 'system',
        actorId: actor,
        action,
        resource,
        correlationId,
        details: details as Record<string, unknown>
      }
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

      await setMode(state.mode === 'HALT' ? 'HALT' : 'READY', reason)
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: 'flatten executed' }
    }

    if (commandName === '/status') {
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: `state:${state.mode} pnl:${state.pnlPct}% cycle:${state.cycle}` }
    }

    if (commandName === '/simulate') {
      const mode = args[0] === 'off' ? 'OFF' : 'ON'
      runtimeCommandCounter.inc({ command, result: 'executed' })
      return { ok: true, message: `simulation mode ${mode}` }
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
    setInterval(async () => {
      const report = await adapter.reconcile()
      const mismatches = report.filter((r) => r.status === 'FAILED')
      if (mismatches.length > 0) {
        await setMode('SAFE_MODE', 'reconciliation mismatch')
        await addAudit('reconcile_mismatch', 'runtime', envelopeId(), {
          mismatches
        })
      }
    }, 30000)
  }

  const stop = async () => {
    stopped = true
    if (timer) {
      clearInterval(timer)
    }
    await pluginManager.stop()
    await marketAdapter.stop()
  }

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

function buildProposal(state: RuntimeState, targetNotional: number, basketSymbolsCsv: string): StrategyProposal {
  const basketSymbols = basketSymbolsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const baseLegs = [{ symbol: 'HYPE', side: 'BUY' as const, notionalUsd: targetNotional }]
  const perBasket = basketSymbols.length > 0 ? targetNotional / basketSymbols.length : 0
  const basketLegs = basketSymbols.map((symbol) => ({
    symbol,
    side: 'SELL' as const,
    notionalUsd: perBasket
  }))

  const actionType = state.mode === 'IN_TRADE' && state.positions.length > 0 ? 'REBALANCE' : 'ENTER'

  const proposalLegs =
    state.mode === 'IN_TRADE' && state.positions.length > 0
      ? state.positions.map((position) => ({
        symbol: position.symbol,
        side: position.side === 'LONG' ? ('SELL' as const) : ('BUY' as const),
        notionalUsd: Math.abs(position.notionalUsd)
      }))
      : [...baseLegs, ...basketLegs]

  return {
    proposalId: envelopeId(),
    cycleId: envelopeId(),
    summary: state.mode === 'READY' ? 'enter pair trade' : `rebalance cycle ${state.cycle}`,
    confidence: 0.75,
    requestedMode: 'SIM',
    createdBy: 'runtime',
    actions: [
      {
        type: actionType,
        rationale: 'systematic pair rebalance',
        notionalUsd: targetNotional,
        expectedSlippageBps: 3,
        legs: proposalLegs
      }
    ]
  }
}

function envelopeId() {
  return ulid()
}

async function createMarketAdapterLazy(env: RuntimeEnv, bus: EventBus): Promise<MarketDataAdapter> {
  const { createMarketAdapter } = await import('../services/market')
  return createMarketAdapter(env, bus)
}
