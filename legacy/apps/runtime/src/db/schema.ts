import { boolean, doublePrecision, integer, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const systemState = pgTable('system_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: text('state').notNull(),
  reason: text('reason').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    role: text('role').notNull(),
    externalId: text('external_id').notNull(),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    usernameIdx: index('idx_users_username').on(table.username),
    externalIdIdx: index('idx_users_external_id').on(table.externalId)
  })
)

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: text('order_id').notNull().unique(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    status: text('status').notNull(),
    idempotencyKey: text('idempotency_key').unique(),
    notionalUsd: doublePrecision('notional_usd').notNull(),
    filledQty: doublePrecision('filled_qty').notNull(),
    avgFillPx: doublePrecision('avg_fill_px').notNull(),
    exchangeOrderId: text('exchange_order_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    symbolIdx: index('idx_orders_symbol').on(table.symbol),
    statusIdx: index('idx_orders_status').on(table.status),
    sourceIdx: index('idx_orders_source').on(table.source),
    createdAtIdx: index('idx_orders_created_at').on(table.createdAt),
    idempotencyIdx: index('idx_orders_idempotency').on(table.idempotencyKey)
  })
)

export const fills = pgTable(
  'fills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: text('order_id').notNull(),
    exchangeOrderId: text('exchange_order_id'),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    filledQty: doublePrecision('filled_qty').notNull(),
    avgFillPx: doublePrecision('avg_fill_px').notNull(),
    notionalUsd: doublePrecision('notional_usd').notNull(),
    source: text('source').notNull(),
    rawEventId: text('raw_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    orderIdx: index('idx_fills_order_id').on(table.orderId),
    symbolIdx: index('idx_fills_symbol').on(table.symbol),
    createdAtIdx: index('idx_fills_created_at').on(table.createdAt),
    sourceIdx: index('idx_fills_source').on(table.source)
  })
)

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    qty: doublePrecision('qty').notNull(),
    notionalUsd: doublePrecision('notional_usd').notNull(),
    avgEntryPx: doublePrecision('avg_entry_px').notNull(),
    markPx: doublePrecision('mark_px').notNull(),
    pnlUsd: doublePrecision('pnl_usd').notNull(),
    userId: uuid('user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    symbolSideIdx: index('idx_positions_symbol_side').on(table.symbol, table.side),
    userIdx: index('idx_positions_user').on(table.userId),
    pnlIdx: index('idx_positions_pnl').on(table.pnlUsd)
  })
)

export const audits = pgTable(
  'audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    correlationId: text('correlation_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    hash: text('hash')
  },
  (table) => ({
    correlationIdx: index('idx_audits_correlation').on(table.correlationId),
    actionIdx: index('idx_audits_action').on(table.action),
    actorIdx: index('idx_audits_actor').on(table.actorType, table.actorId),
    tsIdx: index('idx_audits_ts').on(table.ts)
  })
)

export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id').notNull().unique(),
    tier: text('tier').notNull(),
    capabilities: jsonb('capabilities').notNull().$type<string[]>(),
    quotaRemaining: integer('quota_remaining').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    expiresIdx: index('idx_entitlements_expires').on(table.expiresAt),
    tierIdx: index('idx_entitlements_tier').on(table.tier)
  })
)

export const tierCapabilities = pgTable(
  'tier_capabilities',
  {
    tier: text('tier').primaryKey(),
    capabilities: jsonb('capabilities').notNull().$type<string[]>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    updatedAtIdx: index('idx_tier_capabilities_updated_at').on(table.updatedAt)
  })
)

export const commands = pgTable(
  'commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    command: text('command').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    args: jsonb('args').notNull().$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    commandIdx: index('idx_commands_command').on(table.command),
    createdAtIdx: index('idx_commands_created_at').on(table.createdAt)
  })
)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id').notNull(),
    entitlementId: uuid('entitlement_id'),
    challengeId: text('challenge_id').notNull().unique(),
    status: text('status').notNull(),
    provider: text('provider').notNull(),
    amountUsd: integer('amount_usd').notNull(),
    txRef: text('tx_ref'),
    verificationPayload: jsonb('verification_payload').notNull().$type<Record<string, unknown>>(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>()
  },
  (table) => ({
    agentIdx: index('idx_payments_agent').on(table.agentId),
    statusIdx: index('idx_payments_status').on(table.status),
    createdAtIdx: index('idx_payments_created_at').on(table.createdAt),
    entitlementIdx: index('idx_payments_entitlement').on(table.entitlementId)
  })
)
