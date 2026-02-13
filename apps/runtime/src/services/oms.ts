import { OperatorOrderSchema, OperatorOrder, OperatorPosition } from '@hl/privateer-contracts'
import { NormalizedTick } from '@hl/privateer-contracts'
import { ulid } from 'ulid'

export type OrderState = 'NEW' | 'WORKING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'FAILED'

export interface OrderInput {
  symbol: string
  side: 'BUY' | 'SELL'
  notionalUsd: number
  tick: NormalizedTick
  idempotencyKey: string
}

export interface PlacedOrder {
  orderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  status: OrderState
  notionalUsd: number
  filledQty: number
  avgFillPx: number
  createdAt: string
  source: 'SIM' | 'LIVE'
}

export interface ExecutionAdapter {
  place(input: OrderInput): Promise<PlacedOrder>
  cancel(orderId: string, reason: string): Promise<void>
  modify(orderId: string, notionalUsd: number): Promise<PlacedOrder>
  reconcile(): Promise<Array<{ orderId: string; status: OrderState; filledQty: number; avgFillPx: number }>>
  snapshot(): Promise<{ orders: PlacedOrder[]; positions: OperatorPosition[]; realizedPnlUsd: number }>
}

interface InternalOrder extends PlacedOrder {
  createdByTickTs: string
  lastUpdatedAt: string
}

type TransitionError = {
  expected?: OrderState[]
}

function assertTransition(current: OrderState, next: OrderState): void {
  const transitions: Record<OrderState, TransitionError['expected']> = {
    NEW: ['WORKING', 'FAILED'],
    WORKING: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED'],
    PARTIALLY_FILLED: ['WORKING', 'FILLED', 'CANCELLED'],
    FILLED: [],
    CANCELLED: [],
    FAILED: ['NEW']
  }

  const allowed = transitions[current] ?? []
  if (!allowed.includes(next)) {
    const err = new Error(`invalid order transition ${current} -> ${next}`) as Error & TransitionError
    err.expected = allowed
    throw err
  }
}

function transitionOrder(order: InternalOrder, status: OrderState): void {
  assertTransition(order.status, status)
  order.status = status
  order.lastUpdatedAt = new Date().toISOString()
}

function clampFilled(qty: number, targetQty: number): number {
  return Math.max(0, Math.min(qty, targetQty))
}

export function createSimAdapter(slippageBps = 5, latencyMs = 100): ExecutionAdapter {
  const orders = new Map<string, InternalOrder>()
  const idempotencyMap = new Map<string, string>()
  const positions = new Map<string, InternalPosition>()
  let realizedPnlUsd = 0

  async function place(input: OrderInput): Promise<PlacedOrder> {
    const existing = idempotencyMap.get(input.idempotencyKey)
    if (existing) {
      return orders.get(existing) ?? existingOrderFromId(input)
    }

    const id = input.idempotencyKey
    const slip = 1 + (Math.random() * slippageBps) / 10000
    const fillPx = input.side === 'BUY' ? input.tick.ask * slip : input.tick.bid * (2 - slip)
    const grossQty = Math.abs(input.notionalUsd / fillPx)

    const now = new Date().toISOString()
    const order: InternalOrder = {
      orderId: id,
      symbol: input.symbol,
      side: input.side,
      status: 'NEW',
      notionalUsd: input.notionalUsd,
      filledQty: 0,
      avgFillPx: fillPx,
      createdAt: now,
      source: 'SIM',
      createdByTickTs: input.tick.updatedAt,
      lastUpdatedAt: now
    }

    orders.set(order.orderId, order)
    idempotencyMap.set(input.idempotencyKey, order.orderId)

    transitionOrder(order, 'WORKING')

    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs))
    }

    const partialFill = Math.random() < 0.15
    const targetQty = grossQty
    if (partialFill) {
      order.filledQty = clampFilled(targetQty * (0.1 + Math.random() * 0.6), targetQty)
      transitionOrder(order, 'PARTIALLY_FILLED')
    } else {
      order.filledQty = targetQty
      transitionOrder(order, 'FILLED')
    }

    upsertPosition(order)
    return order
  }

  async function cancel(orderId: string): Promise<void> {
    const existing = orders.get(orderId)
    if (!existing) {
      return
    }

    if (['FILLED', 'CANCELLED', 'FAILED'].includes(existing.status)) {
      return
    }

    transitionOrder(existing, 'CANCELLED')
  }

  async function modify(orderId: string, notionalUsd: number): Promise<PlacedOrder> {
    const existing = orders.get(orderId)
    if (!existing) {
      throw new Error(`order ${orderId} not found`)
    }

    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
      throw new Error('invalid notional')
    }

    if (existing.status !== 'NEW' && existing.status !== 'WORKING') {
      throw new Error('order cannot be modified')
    }

    existing.notionalUsd = notionalUsd
    existing.lastUpdatedAt = new Date().toISOString()

    return existing
  }

  async function reconcile() {
    return [...orders.values()].map((order) => ({
      orderId: order.orderId,
      status: order.status,
      filledQty: order.filledQty,
      avgFillPx: order.avgFillPx
    }))
  }

  async function snapshot() {
    return {
      orders: [...orders.values()].map((order) => OperatorOrderSchema.parse(order)),
      positions: [...positions.values()].map(toOperatorPosition),
      realizedPnlUsd
    }
  }

  function toOperatorPosition(position: InternalPosition): OperatorPosition {
    const side: OperatorPosition['side'] = position.qtySigned >= 0 ? 'LONG' : 'SHORT'
    const qty = Math.abs(position.qtySigned)
    return {
      symbol: position.symbol,
      side,
      qty,
      notionalUsd: qty * position.markPx,
      avgEntryPx: position.avgEntryPx,
      markPx: position.markPx,
      pnlUsd: 0,
      updatedAt: position.updatedAt
    }
  }

  function upsertPosition(order: InternalOrder) {
    const fillSignedQty = (order.side === 'BUY' ? 1 : -1) * order.filledQty
    const fillPx = order.avgFillPx
    const key = order.symbol

    const prior = positions.get(key)
    const priorQty = prior?.qtySigned ?? 0
    const priorAvg = prior?.avgEntryPx ?? fillPx

    // Realize PnL only when we trade against an existing position.
    if (priorQty !== 0 && Math.sign(priorQty) !== Math.sign(fillSignedQty)) {
      const closingQty = Math.min(Math.abs(priorQty), Math.abs(fillSignedQty))
      // Long: (sellPx - entryPx) * qty
      // Short: (entryPx - buyPx) * qty  == (fillPx - entryPx) * qty * sign(priorQty)
      realizedPnlUsd += (fillPx - priorAvg) * closingQty * Math.sign(priorQty)
    }

    const nextQty = priorQty + fillSignedQty
    if (nextQty === 0) {
      positions.delete(key)
      return
    }

    const sameDirectionFill = priorQty === 0 || Math.sign(priorQty) === Math.sign(fillSignedQty)
    const flipped = priorQty !== 0 && Math.sign(priorQty) !== Math.sign(nextQty)

    let avgEntryPx = priorAvg
    if (priorQty === 0 || flipped) {
      avgEntryPx = fillPx
    } else if (sameDirectionFill && Math.sign(priorQty) === Math.sign(nextQty)) {
      // Weighted average entry when increasing exposure in the same direction.
      avgEntryPx = (Math.abs(priorQty) * priorAvg + Math.abs(fillSignedQty) * fillPx) / Math.abs(nextQty)
    } else {
      // Reducing but not flipping: keep entry price for remaining exposure.
      avgEntryPx = priorAvg
    }

    const now = new Date().toISOString()
    positions.set(key, {
      symbol: order.symbol,
      qtySigned: nextQty,
      avgEntryPx,
      markPx: fillPx,
      updatedAt: now
    })
  }

  function existingOrderFromId(input: OrderInput): PlacedOrder {
    const orderId = idempotencyMap.get(input.idempotencyKey)
    const order = orderId ? orders.get(orderId) : null
    if (!order) {
      throw new Error(`idempotent order ${input.idempotencyKey} missing`)
    }

    return order
  }

  return { place, cancel, modify, reconcile, snapshot }
}

interface InternalPosition {
  symbol: string
  qtySigned: number
  avgEntryPx: number
  markPx: number
  updatedAt: string
}

export function createLiveAdapter(): ExecutionAdapter {
  throw new Error('live OMS adapter not implemented (set ENABLE_LIVE_OMS=false for SIM)')
}

export function mapToOperatorOrder(order: PlacedOrder): OperatorOrder {
  return OperatorOrderSchema.parse(order)
}
