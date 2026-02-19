import { createHash } from 'node:crypto'
import {
  type FloorTapeLine,
  DEFAULT_TIER_CAPABILITIES,
  type Entitlement,
  type AuditEvent,
  type OperatorOrder,
  type OperatorPosition,
  type TierCapabilityMap,
  type TrajectoryPoint,
  PublicSnapshot,
  PublicPnlResponse,
  TradeState
} from '@hl/privateer-contracts'
import { createApiStore, type ApiPersistence } from './db/persistence'
import { env } from './config'

const PUBLIC_TAPE_HISTORY_LIMIT = 120
const TRAJECTORY_MAX_POINTS = 2880
const TRAJECTORY_SAMPLE_MS = 8000
const TRAJECTORY_PRUNE_INTERVAL_MS = 60 * 60 * 1000
const TRAJECTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

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

const logPersistenceWriteError = (() => {
  const log = createRateLimitedLogger(30_000)
  return (operation: string, error: unknown, meta?: Record<string, unknown>) => {
    log(
      `api.persistence.${operation}`,
      'error',
      `api: persistence write failed (${operation})`,
      {
        operation,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        ...(meta ?? {})
      }
    )
  }
})()
type ApiSnapshotUpdate = Partial<ApiSnapshot> & { message?: string; reason?: unknown }

export interface ApiRuntimeSnapshot {
  mode: TradeState
  pnlPct: number
  lastUpdateAt: string
  healthCode: 'GREEN' | 'YELLOW' | 'RED'
  driftState?: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'
  accountValueUsd?: number
  message?: string
  riskPolicy?: {
    maxLeverage?: number
    maxDrawdownPct?: number
    maxExposureUsd?: number
    maxSlippageBps?: number
    staleDataMs?: number
    liquidityBufferPct?: number
    notionalParityTolerance?: number
  }
}

type EntitlementUpdate = {
  entitlementId: string
  entitlement: Entitlement
}

export class ApiStore {
  public snapshot: ApiSnapshot = {
    mode: 'INIT',
    pnlPct: 0,
    healthCode: 'GREEN',
    driftState: 'IN_TOLERANCE',
    recentTape: [],
    openPositions: [],
    lastUpdateAt: new Date().toISOString()
  }
  public positions: OperatorPosition[] = []
  public orders: OperatorOrder[] = []
  public audits: AuditEvent[] = []
  public entitlements = new Map<string, Entitlement>()
  public abuses = new Map<string, number>()
  private tierCapabilities: TierCapabilityMap = DEFAULT_TIER_CAPABILITIES
  private auditTailHash = createHash('sha256').update('hlprivateer-audit-genesis').digest('hex')
  private trajectoryBuffer: TrajectoryPoint[] = []
  private lastTrajectorySampleAt = 0
  private pruneTimer: ReturnType<typeof setInterval> | undefined
  private persistence: ApiPersistence = {
    enabled: false,
    ready: false,
    initializeError: 'booting',
    health: async () => false,
    close: async () => undefined,
    getSystemState: async () => null,
    saveSystemState: async () => undefined,
    getPositions: async () => [],
    getOrders: async () => [],
    savePositions: async () => undefined,
    saveOrders: async () => undefined,
    saveAudit: async () => 'unavailable',
    listAudits: async () => [],
    queryAuditRange: async () => [],
    countAudits: async () => 0,
    getEntitlement: async () => null,
    saveEntitlement: async () => undefined,
    getTierCapabilities: async () => null,
    saveCommand: async () => undefined,
    recordPaymentAttempt: async () => undefined,
    saveTrajectoryPoint: async () => undefined,
    getTrajectory: async () => [],
    pruneTrajectory: async () => undefined
  }
  private initialization: Promise<void>

  constructor(databaseUrl = env.DATABASE_URL) {
    this.initialization = createApiStore(databaseUrl)
      .then(async (persistence) => {
        this.persistence = persistence
        await this.hydrateFromPersistence()
      })
      .catch((error) => {
        logPersistenceWriteError('initialize', error)
      })

    this.pruneTimer = setInterval(() => {
      const cutoff = new Date(Date.now() - TRAJECTORY_RETENTION_MS)
      void this.persistence.pruneTrajectory(cutoff).catch((error) => {
        logPersistenceWriteError('pruneTrajectory', error)
      })
    }, TRAJECTORY_PRUNE_INTERVAL_MS)
  }

  public async ready(): Promise<void> {
    await this.initialization
  }

  private async hydrateFromPersistence(): Promise<void> {
    const [systemState, persistedPositions, persistedOrders, audits, totalAudits, tierCapabilities, storedTrajectory] = await Promise.all([
      this.persistence.getSystemState(),
      this.persistence.getPositions(),
      this.persistence.getOrders(),
      this.persistence.listAudits(5000, 0),
      this.persistence.countAudits(),
      this.persistence.getTierCapabilities(),
      this.persistence.getTrajectory(TRAJECTORY_MAX_POINTS)
    ])

    if (systemState) {
      this.snapshot.mode = systemState.state
      this.snapshot.lastUpdateAt = systemState.updatedAt
    }

    this.positions = persistedPositions
    this.syncPublicOpenPositions(this.positions)
    this.orders = persistedOrders
    this.audits = audits
    if (tierCapabilities) {
      this.tierCapabilities = tierCapabilities
    }
    if (audits[0]?.hash) {
      this.auditTailHash = audits[0].hash
    }
    if (storedTrajectory.length > 0) {
      this.trajectoryBuffer = storedTrajectory.slice(-TRAJECTORY_MAX_POINTS)
      const last = this.trajectoryBuffer[this.trajectoryBuffer.length - 1]
      if (last) {
        this.lastTrajectorySampleAt = new Date(last.ts).getTime()
      }
    }
  }

  public getCapabilitiesForTier(tier: 'tier0' | 'tier1' | 'tier2' | 'tier3'): string[] {
    const fromDb = this.tierCapabilities[tier]
    if (Array.isArray(fromDb)) {
      return fromDb
    }

    return DEFAULT_TIER_CAPABILITIES[tier] ?? []
  }

  public getPublicPnl(): PublicPnlResponse {
    return {
      pnlPct: this.snapshot.pnlPct,
      mode: this.snapshot.mode,
      updatedAt: this.snapshot.lastUpdateAt
    }
  }

  public getPublicSnapshot(): PublicSnapshot {
    return {
      ...this.snapshot,
      maxLeverage: this.snapshot.riskPolicy?.maxLeverage
    }
  }

  public addPublicTapeLine(line: FloorTapeLine): void {
    const trimmed: FloorTapeLine = {
      ts: typeof line.ts === 'string' ? line.ts : new Date().toISOString(),
      role: line.role?.trim() || undefined,
      level: line.level ?? 'INFO',
      line: line.line.trim()
    }

    if (!trimmed.line) {
      return
    }

    this.snapshot.recentTape = [...this.snapshot.recentTape, trimmed].slice(-PUBLIC_TAPE_HISTORY_LIMIT)
  }

  public setSnapshot(snapshot: ApiSnapshotUpdate) {
    const hasOwn = (key: keyof ApiSnapshotUpdate) => Object.prototype.hasOwnProperty.call(snapshot, key)
    const nextAccountValueUsd =
      hasOwn('accountValueUsd') && typeof snapshot.accountValueUsd === 'number' && Number.isFinite(snapshot.accountValueUsd)
        ? snapshot.accountValueUsd
        : undefined

    this.snapshot = {
      ...this.snapshot,
      ...snapshot,
      openPositions: hasOwn('openPositions')
        ? (Array.isArray(snapshot.openPositions) ? snapshot.openPositions : [])
        : this.snapshot.openPositions,
      openPositionCount: hasOwn('openPositionCount') ? snapshot.openPositionCount : this.snapshot.openPositionCount,
      openPositionNotionalUsd: hasOwn('openPositionNotionalUsd') ? snapshot.openPositionNotionalUsd : this.snapshot.openPositionNotionalUsd,
      ...(nextAccountValueUsd !== undefined ? { accountValueUsd: nextAccountValueUsd } : {}),
      riskPolicy: hasOwn('riskPolicy') ? snapshot.riskPolicy : this.snapshot.riskPolicy,
      lastUpdateAt: snapshot.lastUpdateAt ?? new Date().toISOString()
    }

    this.sampleTrajectory()

    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : 'state update'
    void this.persistence
      .saveSystemState(this.snapshot.mode, reason)
      .catch((error) => logPersistenceWriteError('saveSystemState', error, { mode: this.snapshot.mode, reason }))
  }

  private sampleTrajectory(): void {
    const { pnlPct, accountValueUsd, mode } = this.snapshot
    if (mode === 'INIT' || mode === 'WARMUP') return
    if (!pnlPct || !Number.isFinite(pnlPct)) return
    const now = Date.now()
    if (now - this.lastTrajectorySampleAt < TRAJECTORY_SAMPLE_MS) return
    this.lastTrajectorySampleAt = now
    const point: TrajectoryPoint = {
      ts: new Date().toISOString(),
      pnlPct,
      ...(accountValueUsd !== undefined && Number.isFinite(accountValueUsd) && accountValueUsd > 0
        ? { accountValueUsd }
        : {})
    }
    this.trajectoryBuffer.push(point)
    if (this.trajectoryBuffer.length > TRAJECTORY_MAX_POINTS) {
      this.trajectoryBuffer = this.trajectoryBuffer.slice(-TRAJECTORY_MAX_POINTS)
    }
    void this.persistence.saveTrajectoryPoint(point).catch((error) => {
      logPersistenceWriteError('saveTrajectoryPoint', error)
    })
  }

  public getTrajectory(): TrajectoryPoint[] {
    return this.trajectoryBuffer
  }

  public setPositions(positions: OperatorPosition[]) {
    this.positions = positions
    this.syncPublicOpenPositions(positions)
    void this.persistence
      .savePositions(positions)
      .catch((error) => logPersistenceWriteError('savePositions', error, { count: positions.length }))
  }

  private syncPublicOpenPositions(positions: OperatorPosition[]): void {
    const normalizedOpenPositions = positions.map((position) => ({
      symbol: position.symbol,
      side: position.side,
      size: position.qty,
      entryPrice: position.avgEntryPx,
      markPrice: position.markPx,
      pnlUsd: position.pnlUsd,
      notionalUsd: position.notionalUsd
    }))

    this.snapshot.openPositions = normalizedOpenPositions
    this.snapshot.openPositionCount = normalizedOpenPositions.length
    this.snapshot.openPositionNotionalUsd = normalizedOpenPositions
      .reduce((sum, position) => sum + (position.notionalUsd ?? 0), 0)
      .valueOf()
    this.snapshot.lastUpdateAt = new Date().toISOString()
  }

  public setOrders(orders: OperatorOrder[]) {
    this.orders = orders
    void this.persistence
      .saveOrders(orders)
      .catch((error) => logPersistenceWriteError('saveOrders', error, { count: orders.length }))
  }

  public addAudit(event: AuditEvent) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          previousHash: this.auditTailHash,
          eventId: event.id,
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          resource: event.resource,
          correlationId: event.correlationId,
          details: event.details
        })
      )
      .digest('hex')

    const eventWithHash: AuditEvent = {
      ...event,
      hash,
      details: {
        ...event.details,
        previousHash: this.auditTailHash
      }
    }

    this.auditTailHash = hash
    this.audits.unshift(eventWithHash)
    this.audits = this.audits.slice(0, 5000)

    void this.persistence
      .saveAudit(eventWithHash)
      .catch((error) => logPersistenceWriteError('saveAudit', error, { eventId: eventWithHash.id, action: eventWithHash.action }))
  }

  public getAudit(limit: number, cursor?: number): AuditEvent[] {
    const offset = cursor ?? 0
    return this.audits.slice(offset, offset + limit)
  }

  public async getAuditTotalCount(): Promise<number> {
    return this.persistence.countAudits()
  }

  public async getAuditFromPersistence(
    fromTs: string,
    toTs: string,
    correlationId?: string,
    resource?: string,
    limit?: number
  ): Promise<AuditEvent[]> {
    if (!this.persistence.enabled) {
      return []
    }

    return this.persistence.queryAuditRange({ fromTs, toTs, correlationId, resource, limit })
  }

  public async setEntitlement({ entitlementId, entitlement }: EntitlementUpdate): Promise<void> {
    this.entitlements.set(entitlementId, entitlement)
    void this.persistence
      .saveEntitlement(entitlementId, entitlement)
      .catch((error) => logPersistenceWriteError('saveEntitlement', error, { entitlementId }))
  }

  public async getEntitlement(entitlementId: string): Promise<Entitlement | undefined> {
    const cached = this.entitlements.get(entitlementId)
    if (cached) {
      return cached
    }

    const persisted = await this.persistence.getEntitlement(entitlementId)
    if (!persisted) {
      return undefined
    }

    this.entitlements.set(entitlementId, persisted)
    return persisted
  }

  public async recordPaymentAttempt(input: {
    agentId: string
    entitlementId?: string
    challengeId: string
    status: string
    provider?: string
    amountUsd: number
    txRef?: string
    verificationPayload?: Record<string, unknown>
    verifiedAt?: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    void this.persistence
      .recordPaymentAttempt(input)
      .catch((error) => logPersistenceWriteError('recordPaymentAttempt', error, { paymentId: (input as any)?.id }))
  }

  public async persistCommand(input: {
    command: string
    actorType: string
    actorId: string
    reason: string
    args: string[]
  }): Promise<void> {
    void this.persistence
      .saveCommand(input)
      .catch((error) => logPersistenceWriteError('saveCommand', error, { commandId: (input as any)?.id, type: (input as any)?.type }))
  }

  public async close(): Promise<void> {
    if (this.pruneTimer !== undefined) {
      clearInterval(this.pruneTimer)
    }
    await this.persistence.close()
  }
}

interface ApiSnapshot extends PublicSnapshot {
  riskPolicy?: ApiRuntimeSnapshot['riskPolicy']
}
