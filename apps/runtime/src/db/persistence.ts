import { createHash } from 'node:crypto'
import { desc, asc, and, eq, gte, inArray, lte, type SQL } from 'drizzle-orm'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  ActorType,
  AuditEvent,
  OperatorOrder,
  OperatorPosition,
  TradeState,
  TradeStateSchema
} from '@hl/privateer-contracts'
import { audits, commands, orders, positions, systemState } from './schema'
import * as schema from './schema'

type AuditRow = typeof audits.$inferSelect
type OrderRow = typeof orders.$inferSelect
type PositionRow = typeof positions.$inferSelect
type SystemStateRow = typeof systemState.$inferSelect

type SaveCommandInput = {
  command: string
  actorType: string
  actorId: string
  reason: string
  args: string[]
}

export interface RuntimeStoreSnapshot {
  state: TradeState
  reason: string
  updatedAt: string
}

export interface AuditReplayParams {
  fromTs: string
  toTs: string
  correlationId?: string
  resource?: string
  limit?: number
}

export interface RuntimeStore {
  enabled: boolean
  ready: boolean
  initializeError: string | null
  health(): Promise<boolean>
  close(): Promise<void>
  getSystemState(): Promise<RuntimeStoreSnapshot | null>
  saveSystemState(state: TradeState, reason: string): Promise<void>
  getPositions(): Promise<OperatorPosition[]>
  savePositions(positionsToSave: readonly OperatorPosition[]): Promise<void>
  getOrders(): Promise<OperatorOrder[]>
  saveOrders(ordersToSave: readonly OperatorOrder[]): Promise<void>
  saveAudit(event: AuditEvent): Promise<string>
  saveCommand(input: SaveCommandInput): Promise<void>
  listAudits(limit: number, cursor: number): Promise<AuditEvent[]>
  queryAuditRange(params: AuditReplayParams): Promise<AuditEvent[]>
  countAudits(): Promise<number>
}

type RuntimeDbStore = {
  db: NodePgDatabase<typeof schema>
  pool: Pool
}

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001'
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 5000

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit as number) || (limit as number) <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.floor(limit as number))
}

function normalizeCursor(cursor?: number): number {
  if (!Number.isFinite(cursor as number) || (cursor as number) <= 0) {
    return 0
  }

  return Math.floor(cursor as number)
}

function parseTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsed = new Date(value ?? '')
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }

  return parsed.toISOString()
}

function clampToInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function toOperatorOrder(row: OrderRow): OperatorOrder {
  return {
    orderId: row.orderId,
    symbol: row.symbol,
    side: row.side === 'BUY' || row.side === 'SELL' ? row.side : 'BUY',
    status: row.status === 'NEW' || row.status === 'WORKING' || row.status === 'PARTIALLY_FILLED' || row.status === 'FILLED' || row.status === 'CANCELLED' || row.status === 'FAILED'
      ? row.status
      : 'NEW',
    notionalUsd: clampToInteger(row.notionalUsd),
    filledQty: clampToInteger(row.filledQty),
    avgFillPx: clampToInteger(row.avgFillPx),
    createdAt: parseTimestamp(row.createdAt),
    source: row.source === 'LIVE' ? 'LIVE' : 'SIM'
  }
}

function toOperatorPosition(row: PositionRow): OperatorPosition {
  return {
    symbol: row.symbol,
    side: row.side === 'LONG' || row.side === 'SHORT' ? row.side : 'LONG',
    qty: clampToInteger(row.qty),
    notionalUsd: clampToInteger(row.notionalUsd),
    avgEntryPx: clampToInteger(row.avgEntryPx),
    markPx: clampToInteger(row.markPx),
    pnlUsd: clampToInteger(row.pnlUsd),
    updatedAt: parseTimestamp(row.updatedAt)
  }
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    ts: parseTimestamp(row.ts),
    actorType: row.actorType as ActorType,
    actorId: row.actorId,
    action: row.action,
    resource: row.resource,
    correlationId: row.correlationId,
    details: row.details && typeof row.details === 'object' ? (row.details as Record<string, unknown>) : {},
    hash: row.hash ?? undefined
  }
}

function computeAuditHash(event: AuditEvent, previousHash: string | null): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        previousHash,
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

function toSystemStateRow(row: RuntimeStoreSnapshot): { state: TradeState; reason: string; updatedAt: Date } {
  return {
    state: row.state,
    reason: row.reason,
    updatedAt: new Date(row.updatedAt)
  }
}

function fromSystemStateRow(row: SystemStateRow): RuntimeStoreSnapshot | null {
  const parsedState = TradeStateSchema.safeParse(row.state)
  if (!parsedState.success) {
    return null
  }

  return {
    state: parsedState.data,
    reason: row.reason,
    updatedAt: parseTimestamp(row.updatedAt)
  }
}

function createDisabledStore(reason: string): RuntimeStore {
  return {
    enabled: false,
    ready: false,
    initializeError: reason,
    health: async () => false,
    close: async () => undefined,
    getSystemState: async () => null,
    saveSystemState: async () => undefined,
    getPositions: async () => [],
    savePositions: async () => undefined,
    getOrders: async () => [],
    saveOrders: async () => undefined,
    saveAudit: async () => 'unavailable',
    saveCommand: async () => undefined,
    listAudits: async () => [],
    queryAuditRange: async () => [],
    countAudits: async () => 0
  }
}

function buildAuditWhereClause(
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

function buildWhere<T>(params: AuditReplayParams): SQL<unknown> | undefined {
  return buildAuditWhereClause(params.fromTs, params.toTs, params.correlationId, params.resource)
}

async function createPostgresStore(databaseUrl: string): Promise<RuntimeStore> {
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  try {
    await pool.query('SELECT 1')
  } catch (error) {
    await pool.end().catch(() => undefined)
    return createDisabledStore(String(error))
  }

  const store: RuntimeDbStore = { db, pool }

  return {
    enabled: true,
    ready: true,
    initializeError: null,
  health: async () => {
      try {
        await store.pool.query('SELECT 1')
        return true
      } catch (error) {
        console.warn('[runtime-store.health] pool health check failed', error) // eslint-disable-line no-console
        return false
      }
    },
    close: async () => {
      await store.pool.end().catch(() => undefined)
    },
    getSystemState: async () => {
      const rows = await store.db
        .select()
        .from(systemState)
        .orderBy(desc(systemState.updatedAt))
        .limit(1)

      if (rows.length === 0) {
        return null
      }

      return fromSystemStateRow(rows[0]) ?? null
    },
    saveSystemState: async (state, reason) => {
      TradeStateSchema.parse(state)
      await store.db.insert(systemState).values(
        toSystemStateRow({
          state,
          reason,
          updatedAt: new Date().toISOString()
        })
      )
    },
    getPositions: async () => {
      const rows = await store.db
        .select()
        .from(positions)
        .where(eq(positions.userId, SYSTEM_USER_ID))
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
    saveCommand: async (input) => {
      await store.db.insert(commands).values({
        command: input.command,
        actorType: input.actorType,
        actorId: input.actorId,
        reason: input.reason,
        args: input.args
      })
    },
    listAudits: async (limit, cursor) => {
      const rows = await store.db
        .select()
        .from(audits)
        .orderBy(desc(audits.ts))
        .limit(normalizeLimit(limit))
        .offset(normalizeCursor(cursor))

      return rows.map(toAuditEvent)
    },
    queryAuditRange: async (params) => {
      const rows = await store.db
        .select()
        .from(audits)
        .where(buildWhere(params))
        .orderBy(desc(audits.ts))
        .limit(normalizeLimit(params.limit))

      return rows.map(toAuditEvent)
    },
    countAudits: async () => {
      const rows = await store.db.select().from(audits)
      return rows.length
    }
  }
}

export async function createRuntimeStore(databaseUrl?: string): Promise<RuntimeStore> {
  if (!databaseUrl) {
    return createDisabledStore('DATABASE_URL missing')
  }

  return createPostgresStore(databaseUrl)
}
