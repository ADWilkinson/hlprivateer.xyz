import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  ActorType,
  TierCapabilityMapSchema,
  EntitlementSchema,
  TradeStateSchema,
  type AuditEvent,
  type Entitlement,
  type TierCapabilityMap,
  type OperatorOrder,
  type OperatorPosition,
  type TradeState
} from '@hl/privateer-contracts'
import { audits, commands, entitlements, orders, payments, positions, systemState, tierCapabilities } from './schema'
import * as schema from './schema'

type AuditRow = typeof audits.$inferSelect
type EntitlementRow = typeof entitlements.$inferSelect
type OrderRow = typeof orders.$inferSelect
type PositionRow = typeof positions.$inferSelect
type SystemStateRow = typeof systemState.$inferSelect
type TierCapabilitiesRow = typeof tierCapabilities.$inferSelect

type ApiDbStore = {
  db: NodePgDatabase<typeof schema>
  pool: Pool
}

export interface ApiPersistence {
  enabled: boolean
  ready: boolean
  initializeError: string | null
  health(): Promise<boolean>
  close(): Promise<void>
  getSystemState(): Promise<{ state: TradeState; reason: string; updatedAt: string } | null>
  saveSystemState(state: TradeState, reason: string): Promise<void>
  getPositions(): Promise<OperatorPosition[]>
  getOrders(): Promise<OperatorOrder[]>
  savePositions(positionsToSave: readonly OperatorPosition[]): Promise<void>
  saveOrders(ordersToSave: readonly OperatorOrder[]): Promise<void>
  saveAudit(event: AuditEvent): Promise<string>
  listAudits(limit: number, cursor: number): Promise<AuditEvent[]>
  queryAuditRange(params: {
    fromTs: string
    toTs: string
    correlationId?: string
    resource?: string
    limit?: number
  }): Promise<AuditEvent[]>
  countAudits(): Promise<number>
  getEntitlement(entitlementId: string): Promise<Entitlement | null>
  saveEntitlement(entitlementId: string, entitlement: Entitlement): Promise<void>
  getTierCapabilities(): Promise<TierCapabilityMap | null>
  saveCommand(input: {
    command: string
    actorType: string
    actorId: string
    reason: string
    args: string[]
  }): Promise<void>
  recordPaymentAttempt(input: PaymentAttemptInput): Promise<void>
}

const MAX_LIMIT = 5000
const DEFAULT_LIMIT = 200
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001'
const DEFAULT_PAYMENT_PROVIDER = 'x402-mock'

type PaymentAttemptInput = {
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
}

function normalizeTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsed = new Date(value ?? '')
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }

  return parsed.toISOString()
}

function normalizeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function normalizeAmount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.max(0, Math.round(parsed))
}

function sanitizePaymentMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {}
  }

  if (Array.isArray(value)) {
    return { values: value.length }
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 32)
      .map(([key, entryValue]) => {
        const safeKey = String(key).slice(0, 64)
        if (typeof entryValue === 'string') {
          return [safeKey, entryValue.slice(0, 256)]
        }

        if (typeof entryValue === 'number' && Number.isFinite(entryValue)) {
          return [safeKey, entryValue]
        }

        if (typeof entryValue === 'boolean') {
          return [safeKey, entryValue]
        }

        return [safeKey, String(entryValue)]
      })
  )
}

function parseCursor(cursor?: number): number {
  if (!Number.isFinite(cursor as number) || (cursor as number) < 0) {
    return 0
  }

  return Math.floor(cursor as number)
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit as number) || (limit as number) <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.floor(limit as number))
}

function toOperatorOrder(row: OrderRow): OperatorOrder {
  return {
    orderId: row.orderId,
    symbol: row.symbol,
    side: row.side === 'BUY' || row.side === 'SELL' ? row.side : 'BUY',
    status: row.status === 'NEW' || row.status === 'WORKING' || row.status === 'PARTIALLY_FILLED' || row.status === 'FILLED' || row.status === 'CANCELLED' || row.status === 'FAILED'
      ? row.status
      : 'NEW',
    notionalUsd: normalizeInteger(row.notionalUsd),
    filledQty: normalizeInteger(row.filledQty),
    avgFillPx: normalizeInteger(row.avgFillPx),
    createdAt: normalizeTimestamp(row.createdAt),
    source: row.source === 'LIVE' ? 'LIVE' : 'SIM'
  }
}

function toOperatorPosition(row: PositionRow): OperatorPosition {
  return {
    symbol: row.symbol,
    side: row.side === 'LONG' || row.side === 'SHORT' ? row.side : 'LONG',
    qty: normalizeInteger(row.qty),
    notionalUsd: normalizeInteger(row.notionalUsd),
    avgEntryPx: normalizeInteger(row.avgEntryPx),
    markPx: normalizeInteger(row.markPx),
    pnlUsd: normalizeInteger(row.pnlUsd),
    updatedAt: normalizeTimestamp(row.updatedAt)
  }
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    ts: normalizeTimestamp(row.ts),
    actorType: row.actorType as ActorType,
    actorId: row.actorId,
    action: row.action,
    resource: row.resource,
    correlationId: row.correlationId,
    details: row.details && typeof row.details === 'object' ? (row.details as Record<string, unknown>) : {},
    hash: row.hash ?? undefined
  }
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return {
    agentId: row.agentId,
    tier: row.tier as Entitlement['tier'],
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    expiresAt: normalizeTimestamp(row.expiresAt),
    quotaRemaining: normalizeInteger(row.quotaRemaining),
    rateLimitPerMinute: 30
  }
}

function toTierCapabilityRecord(rows: TierCapabilitiesRow[]): TierCapabilityMap | null {
  if (rows.length === 0) {
    return null
  }

  const candidate = rows.reduce<Record<string, string[]>>((acc, row) => {
    if (Array.isArray(row.capabilities)) {
      acc[row.tier] = row.capabilities.filter((entry): entry is string => typeof entry === 'string')
    }
    return acc
  }, {})

  const parsed = TierCapabilityMapSchema.safeParse(candidate)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}

function computeAuditHash(event: AuditEvent, previousHash: string | null): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        previousHash,
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
}

function toSystemState(state: TradeState, reason: string): { state: TradeState; reason: string; updatedAt: string } {
  return { state, reason, updatedAt: new Date().toISOString() }
}

function fromSystemState(row: SystemStateRow): { state: TradeState; reason: string; updatedAt: string } | null {
  const parsed = TradeStateSchema.safeParse(row.state)
  if (!parsed.success) {
    return null
  }

  return {
    state: parsed.data,
    reason: row.reason,
    updatedAt: normalizeTimestamp(row.updatedAt)
  }
}

function buildWhereClause(
  fromTs: string,
  toTs: string,
  correlationId?: string,
  resource?: string
): SQL<unknown> | undefined {
  const conditions: SQL<unknown>[] = []
  const from = Date.parse(fromTs)
  const to = Date.parse(toTs)

  if (Number.isFinite(from)) {
    conditions.push(gte(audits.ts, new Date(from)))
  }

  if (Number.isFinite(to)) {
    conditions.push(lte(audits.ts, new Date(to)))
  }

  if (correlationId?.trim()) {
    conditions.push(eq(audits.correlationId, correlationId))
  }

  if (resource?.trim()) {
    conditions.push(eq(audits.resource, resource))
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

function createDisabledStore(reason: string): ApiPersistence {
  return {
    enabled: false,
    ready: false,
    initializeError: reason,
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
}

  async function createPostgresStore(databaseUrl: string): Promise<ApiPersistence> {
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  try {
    await pool.query('SELECT 1')
  } catch (error) {
    await pool.end().catch(() => undefined)
    return createDisabledStore(String(error))
  }

  const store: ApiDbStore = { db, pool }

  return {
    enabled: true,
    ready: true,
    initializeError: null,
    health: async () => {
      try {
        await store.pool.query('SELECT 1')
        return true
      } catch (error) {
        console.warn('[api-store.health] pool health check failed', error) // eslint-disable-line no-console
        return false
      }
    },
    close: async () => {
      await store.pool.end().catch(() => undefined)
    },
    getSystemState: async () => {
      const rows = await store.db.select().from(systemState).orderBy(desc(systemState.updatedAt)).limit(1)
      if (rows.length === 0) {
        return null
      }

      return fromSystemState(rows[0])
    },
    saveSystemState: async (state, reason) => {
      TradeStateSchema.parse(state)
      const payload = toSystemState(state, reason)
      await store.db.insert(systemState).values({
        state: payload.state,
        reason: payload.reason,
        updatedAt: new Date(payload.updatedAt)
      })
    },
    getPositions: async () => {
      const rows = await store.db
        .select()
        .from(positions)
        .orderBy(asc(positions.updatedAt))
      return rows.map(toOperatorPosition)
    },
    savePositions: async (positionsToSave) => {
      await store.db.transaction(async (tx) => {
        await tx.delete(positions).where(eq(positions.userId, SYSTEM_USER_ID))

        if (positionsToSave.length === 0) {
          return
        }

        await tx.insert(positions).values(
          positionsToSave.map((position) => ({
            symbol: position.symbol,
            side: position.side,
            qty: Math.round(position.qty),
            notionalUsd: Math.round(position.notionalUsd),
            avgEntryPx: Math.round(position.avgEntryPx),
            markPx: Math.round(position.markPx),
            pnlUsd: Math.round(position.pnlUsd),
            userId: SYSTEM_USER_ID,
            updatedAt: new Date(position.updatedAt),
            createdAt: new Date(position.updatedAt)
          }))
        )
      })
    },
    getOrders: async () => {
      const rows = await store.db.select().from(orders).orderBy(desc(orders.updatedAt))
      return rows.map(toOperatorOrder)
    },
    saveOrders: async (ordersToSave) => {
      const sources = Array.from(new Set(ordersToSave.map((entry) => entry.source)))

      await store.db.transaction(async (tx) => {
        if (sources.length > 0) {
          await tx.delete(orders).where(inArray(orders.source, sources))
        } else {
          await tx.delete(orders).where(eq(orders.source, 'SIM'))
          await tx.delete(orders).where(eq(orders.source, 'LIVE'))
        }

        if (ordersToSave.length === 0) {
          return
        }

        await tx.insert(orders).values(
          ordersToSave.map((order) => ({
            orderId: order.orderId,
            symbol: order.symbol,
            side: order.side,
            status: order.status,
            idempotencyKey: `${order.source}:${order.orderId}`,
            notionalUsd: Math.round(order.notionalUsd),
            filledQty: Math.round(order.filledQty),
            avgFillPx: Math.round(order.avgFillPx),
            exchangeOrderId: null,
            source: order.source,
            createdAt: new Date(order.createdAt),
            updatedAt: new Date()
          }))
        )
      })
    },
    saveAudit: async (event) => {
      const previousRows = await store.db
        .select({ hash: audits.hash })
        .from(audits)
        .orderBy(desc(audits.ts))
        .limit(1)

      const previousHash = previousRows[0]?.hash ?? null
      const hash = computeAuditHash(event, previousHash)

      const inserted = await store.db
        .insert(audits)
        .values({
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          resource: event.resource,
          correlationId: event.correlationId,
          ts: new Date(event.ts),
          details: {
            ...(event.details ?? {}),
            previousHash
          },
          hash
        })
        .returning({ id: audits.id })

      return inserted[0]?.id ?? 'unavailable'
    },
    listAudits: async (limit, cursor) => {
      const rows = await store.db
        .select()
        .from(audits)
        .orderBy(desc(audits.ts))
        .limit(normalizeLimit(limit))
        .offset(parseCursor(cursor))

      return rows.map(toAuditEvent)
    },
    queryAuditRange: async ({ fromTs, toTs, correlationId, resource, limit }) => {
      const rows = await store.db
        .select()
        .from(audits)
        .where(buildWhereClause(fromTs, toTs, correlationId, resource))
        .orderBy(desc(audits.ts))
        .limit(normalizeLimit(limit))

      return rows.map(toAuditEvent)
    },
    countAudits: async () => {
      const rows = await store.db.select().from(audits)
      return rows.length
    },
    getEntitlement: async (entitlementId) => {
      const rows = await store.db
        .select()
        .from(entitlements)
        .where(eq(entitlements.agentId, entitlementId))
        .orderBy(desc(entitlements.createdAt))
        .limit(1)

      if (rows.length === 0) {
        return null
      }

      const entitlement = toEntitlement(rows[0])
      if (new Date(entitlement.expiresAt) < new Date()) {
        return null
      }

      return entitlement
    },
    saveEntitlement: async (entitlementId, entitlement) => {
      EntitlementSchema.parse(entitlement)
      await store.db
        .insert(entitlements)
        .values({
          agentId: entitlementId,
          tier: entitlement.tier,
          capabilities: entitlement.capabilities,
          quotaRemaining: entitlement.quotaRemaining,
          expiresAt: new Date(entitlement.expiresAt)
        })
        .onConflictDoUpdate({
          target: entitlements.agentId,
          set: {
            tier: entitlement.tier,
            capabilities: entitlement.capabilities,
            quotaRemaining: entitlement.quotaRemaining,
            expiresAt: new Date(entitlement.expiresAt)
          }
        })
    },
    getTierCapabilities: async () => {
      try {
        const rows = await store.db
          .select()
          .from(tierCapabilities)
          .orderBy(asc(tierCapabilities.tier))

        return toTierCapabilityRecord(rows)
      } catch (error) {
        console.warn('[api-store] failed to load tier capabilities', error) // eslint-disable-line no-console
        return null
      }
    },
    saveCommand: async (input) => {
      await store.db.insert(commands).values({
        command: input.command,
        actorType: input.actorType,
        actorId: input.actorId,
        reason: input.reason,
        args: input.args
      })
    },
    recordPaymentAttempt: async (input) => {
      const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt) : null
      const payload = sanitizePaymentMetadata(input.verificationPayload)
      const metadata = sanitizePaymentMetadata(input.metadata)
      await store.db
        .insert(payments)
        .values({
          agentId: input.agentId,
          entitlementId: null,
          challengeId: input.challengeId,
          status: input.status,
          provider: input.provider ?? DEFAULT_PAYMENT_PROVIDER,
          amountUsd: normalizeAmount(input.amountUsd),
          txRef: input.txRef ?? null,
          verificationPayload: payload,
          verifiedAt,
          createdAt: new Date(),
          metadata: {
            ...metadata,
            entitlementId: input.entitlementId
          }
        })
        .onConflictDoUpdate({
          target: payments.challengeId,
          set: {
            status: input.status,
            provider: input.provider ?? DEFAULT_PAYMENT_PROVIDER,
            amountUsd: normalizeAmount(input.amountUsd),
            txRef: input.txRef ?? null,
            verificationPayload: payload,
            verifiedAt,
            metadata: {
              ...metadata,
              entitlementId: input.entitlementId
            }
          }
        })
    }
  }
}

export async function createApiStore(databaseUrl?: string): Promise<ApiPersistence> {
  if (!databaseUrl) {
    return createDisabledStore('DATABASE_URL missing')
  }

  return createPostgresStore(databaseUrl)
}

export { EntitlementSchema } from '@hl/privateer-contracts'
