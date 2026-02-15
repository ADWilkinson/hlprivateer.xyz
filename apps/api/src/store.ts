import { createHash } from 'node:crypto'
import {
  type FloorTapeLine,
  DEFAULT_TIER_CAPABILITIES,
  type Entitlement,
  type AuditEvent,
  type OperatorOrder,
  type OperatorPosition,
  type TierCapabilityMap,
  PublicSnapshot,
  PublicPnlResponse,
  TradeState
} from '@hl/privateer-contracts'
import { createApiStore, type ApiPersistence } from './db/persistence'
import { env } from './config'

const PUBLIC_TAPE_HISTORY_LIMIT = 120
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
    recordPaymentAttempt: async () => undefined
  }
  private initialization: Promise<void>

  constructor(databaseUrl = env.DATABASE_URL) {
    this.initialization = createApiStore(databaseUrl)
      .then(async (persistence) => {
        this.persistence = persistence
        await this.hydrateFromPersistence()
      })
      .catch(() => undefined)
  }

  public async ready(): Promise<void> {
    await this.initialization
  }

  private async hydrateFromPersistence(): Promise<void> {
    const [systemState, persistedPositions, persistedOrders, audits, totalAudits, tierCapabilities] = await Promise.all([
      this.persistence.getSystemState(),
      this.persistence.getPositions(),
      this.persistence.getOrders(),
      this.persistence.listAudits(5000, 0),
      this.persistence.countAudits(),
      this.persistence.getTierCapabilities()
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

    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : 'state update'
    void this.persistence
      .saveSystemState(this.snapshot.mode, reason)
      .catch(() => undefined)
  }

  public setPositions(positions: OperatorPosition[]) {
    this.positions = positions
    this.syncPublicOpenPositions(positions)
    void this.persistence.savePositions(positions).catch(() => undefined)
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
    void this.persistence.saveOrders(orders).catch(() => undefined)
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

    void this.persistence.saveAudit(eventWithHash).catch(() => undefined)
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
    void this.persistence.saveEntitlement(entitlementId, entitlement).catch(() => undefined)
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
    void this.persistence.recordPaymentAttempt(input).catch(() => undefined)
  }

  public async persistCommand(input: {
    command: string
    actorType: string
    actorId: string
    reason: string
    args: string[]
  }): Promise<void> {
    void this.persistence.saveCommand(input).catch(() => undefined)
  }

  public async close(): Promise<void> {
    await this.persistence.close()
  }
}

interface ApiSnapshot extends PublicSnapshot {
  riskPolicy?: ApiRuntimeSnapshot['riskPolicy']
}
