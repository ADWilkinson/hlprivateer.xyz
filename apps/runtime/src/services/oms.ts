import { OperatorOrderSchema, OperatorOrder, OperatorPosition } from '@hl/privateer-contracts'
import { NormalizedTick } from '@hl/privateer-contracts'
import { createHash } from 'node:crypto'
import { ulid } from 'ulid'
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import { PrivateKeySigner } from '@nktkas/hyperliquid/signing'
import { SymbolConverter, formatPrice, formatSize } from '@nktkas/hyperliquid/utils'
import type { RuntimeEnv } from '../config'

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

export function createLiveAdapter(env: RuntimeEnv): ExecutionAdapter {
  const privateKey = env.HL_PRIVATE_KEY?.trim()
  if (!privateKey) {
    throw new Error('HL_PRIVATE_KEY is required for live OMS (set ENABLE_LIVE_OMS=false for SIM)')
  }

  const wallet = new PrivateKeySigner(privateKey)
  const transport = new HttpTransport({
    isTestnet: env.HL_IS_TESTNET,
    timeout: env.HL_REQUEST_TIMEOUT_MS,
    apiUrl: env.HL_API_URL
  })
  const exchange = new ExchangeClient({ transport, wallet })
  const info = new InfoClient({ transport })

  const idempotencyMap = new Map<string, string>() // idempotencyKey -> oid string
  let symbolConverterPromise: Promise<SymbolConverter> | null = null

  const realizedCache = {
    fetchedAtMs: 0,
    realizedPnlUsd: 0
  }

  async function ensureConverter(): Promise<SymbolConverter> {
    if (!symbolConverterPromise) {
      symbolConverterPromise = SymbolConverter.create({ transport })
    }
    return await symbolConverterPromise
  }

  async function place(input: OrderInput): Promise<PlacedOrder> {
    if (!Number.isFinite(input.notionalUsd) || input.notionalUsd <= 0) {
      throw new Error('invalid notional')
    }

    const nowIso = new Date().toISOString()
    const cloid = cloidFromIdempotencyKey(input.idempotencyKey)

    // Idempotency across restarts: check the exchange by cloid first.
    const existing = await info.orderStatus({ user: wallet.address, oid: cloid })
    if (existing.status === 'order') {
      const mapped = mapOrderStatusToPlaced(existing.order, nowIso)
      idempotencyMap.set(input.idempotencyKey, mapped.orderId)
      return mapped
    }

    const converter = await ensureConverter()
    const assetId = converter.getAssetId(input.symbol)
    const szDecimals = converter.getSzDecimals(input.symbol)
    if (typeof assetId !== 'number' || typeof szDecimals !== 'number') {
      throw new Error(`unknown symbol for live OMS: ${input.symbol}`)
    }

    const slippageBps = Number.isFinite(env.RISK_MAX_SLIPPAGE_BPS) ? env.RISK_MAX_SLIPPAGE_BPS : 0
    const slip = Math.min(0.5, Math.max(0, slippageBps) / 10000)

    const pxRaw = input.side === 'BUY'
      ? input.tick.ask * (1 + slip)
      : input.tick.bid * (1 - slip)
    const px = formatPrice(pxRaw, szDecimals, 'perp')
    const pxNum = Number(px)
    if (!Number.isFinite(pxNum) || pxNum <= 0) {
      throw new Error('invalid formatted price')
    }

    const sizeRaw = input.notionalUsd / pxNum
    const size = formatSize(sizeRaw, szDecimals)

    const result = await exchange.order({
      orders: [
        {
          a: assetId,
          b: input.side === 'BUY',
          p: px,
          s: size,
          r: false,
          t: { limit: { tif: 'Ioc' } },
          c: cloid
        }
      ],
      grouping: 'na'
    })

    const status = result?.response?.data?.statuses?.[0]
    if (!status) {
      throw new Error('order rejected: missing status')
    }

    if (typeof status === 'string') {
      // Some exchange responses are indirect; resolve by querying status via cloid.
      const resolved = await info.orderStatus({ user: wallet.address, oid: cloid })
      if (resolved.status === 'order') {
        const mapped = mapOrderStatusToPlaced(resolved.order, nowIso)
        idempotencyMap.set(input.idempotencyKey, mapped.orderId)
        return mapped
      }
      throw new Error(`order unresolved: ${status}`)
    }

    if ('error' in status) {
      throw new Error(String((status as any).error))
    }

    if ('filled' in status) {
      const filled = (status as any).filled as { oid: number; totalSz: string; avgPx: string }
      const filledQty = Number(filled.totalSz)
      const avgFillPx = Number(filled.avgPx)
      const notionalUsd = Number.isFinite(filledQty) && Number.isFinite(avgFillPx) ? filledQty * avgFillPx : input.notionalUsd
      const placed: PlacedOrder = {
        orderId: String(filled.oid),
        symbol: input.symbol,
        side: input.side,
        status: 'FILLED',
        notionalUsd,
        filledQty: Number.isFinite(filledQty) ? filledQty : 0,
        avgFillPx: Number.isFinite(avgFillPx) ? avgFillPx : pxNum,
        createdAt: nowIso,
        source: 'LIVE'
      }
      idempotencyMap.set(input.idempotencyKey, placed.orderId)
      return placed
    }

    if ('resting' in status) {
      const resting = (status as any).resting as { oid: number }
      const placed: PlacedOrder = {
        orderId: String(resting.oid),
        symbol: input.symbol,
        side: input.side,
        status: 'WORKING',
        notionalUsd: input.notionalUsd,
        filledQty: 0,
        avgFillPx: pxNum,
        createdAt: nowIso,
        source: 'LIVE'
      }
      idempotencyMap.set(input.idempotencyKey, placed.orderId)
      return placed
    }

    throw new Error('order rejected: unknown status variant')
  }

  async function cancel(orderId: string): Promise<void> {
    const oid = Number(orderId)
    if (!Number.isFinite(oid) || oid <= 0) {
      throw new Error('invalid orderId')
    }

    const status = await info.orderStatus({ user: wallet.address, oid })
    if (status.status !== 'order') {
      return
    }

    const hlStatus = status.order.status
    if (hlStatus === 'filled' || hlStatus === 'canceled') {
      return
    }

    const coin = status.order.order.coin
    const converter = await ensureConverter()
    const assetId = converter.getAssetId(coin)
    if (typeof assetId !== 'number') {
      throw new Error(`unknown symbol for cancel: ${coin}`)
    }

    await exchange.cancel({ cancels: [{ a: assetId, o: oid }] })
  }

  async function modify(orderId: string, notionalUsd: number): Promise<PlacedOrder> {
    const oid = Number(orderId)
    if (!Number.isFinite(oid) || oid <= 0) {
      throw new Error('invalid orderId')
    }

    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
      throw new Error('invalid notional')
    }

    const status = await info.orderStatus({ user: wallet.address, oid })
    if (status.status !== 'order') {
      throw new Error('order not found')
    }

    if (status.order.status !== 'open' && status.order.status !== 'triggered') {
      throw new Error('order cannot be modified')
    }

    const coin = status.order.order.coin
    const side = status.order.order.side === 'B' ? ('BUY' as const) : ('SELL' as const)
    const limitPxNum = Number(status.order.order.limitPx)
    if (!Number.isFinite(limitPxNum) || limitPxNum <= 0) {
      throw new Error('invalid limit price for modify')
    }

    const converter = await ensureConverter()
    const assetId = converter.getAssetId(coin)
    const szDecimals = converter.getSzDecimals(coin)
    if (typeof assetId !== 'number' || typeof szDecimals !== 'number') {
      throw new Error(`unknown symbol for modify: ${coin}`)
    }

    const px = formatPrice(limitPxNum, szDecimals, 'perp')
    const pxNum = Number(px)
    const size = formatSize(notionalUsd / pxNum, szDecimals)

    await exchange.modify({
      oid,
      order: {
        a: assetId,
        b: side === 'BUY',
        p: px,
        s: size,
        r: Boolean(status.order.order.reduceOnly),
        t: { limit: { tif: (status.order.order.tif ?? 'Gtc') as any } },
        c: status.order.order.cloid ?? undefined
      }
    })

    const nowIso = new Date().toISOString()
    return {
      orderId: String(oid),
      symbol: coin,
      side,
      status: 'WORKING',
      notionalUsd,
      filledQty: 0,
      avgFillPx: pxNum,
      createdAt: nowIso,
      source: 'LIVE'
    }
  }

  async function reconcile(): Promise<Array<{ orderId: string; status: OrderState; filledQty: number; avgFillPx: number }>> {
    const now = Date.now()
    const open = await info.openOrders({ user: wallet.address })

    return open.map((order) => {
      const origSz = Number(order.origSz)
      const remainingSz = Number(order.sz)
      const filledQty = Number.isFinite(origSz) && Number.isFinite(remainingSz) ? Math.max(0, origSz - remainingSz) : 0
      const avgFillPx = Number(order.limitPx)
      const ageMs = now - Number(order.timestamp)
      const tooOld = Number.isFinite(ageMs) && ageMs > env.LIVE_RECONCILE_OPEN_ORDER_MAX_AGE_MS

      const baseStatus: OrderState = filledQty > 0 ? 'PARTIALLY_FILLED' : 'WORKING'
      return {
        orderId: String(order.oid),
        status: tooOld ? 'FAILED' : baseStatus,
        filledQty,
        avgFillPx: Number.isFinite(avgFillPx) ? avgFillPx : 0
      }
    })
  }

  async function snapshot(): Promise<{ orders: PlacedOrder[]; positions: OperatorPosition[]; realizedPnlUsd: number }> {
    const [openOrders, clearinghouse] = await Promise.all([
      info.openOrders({ user: wallet.address }),
      info.clearinghouseState({ user: wallet.address })
    ])

    const orders: PlacedOrder[] = openOrders.map((order) => {
      const limitPx = Number(order.limitPx)
      const origSz = Number(order.origSz)
      const remainingSz = Number(order.sz)
      const filledQty = Number.isFinite(origSz) && Number.isFinite(remainingSz) ? Math.max(0, origSz - remainingSz) : 0
      const avgFillPx = Number.isFinite(limitPx) ? limitPx : 0
      const sz = Number.isFinite(origSz) ? origSz : Number(order.sz)
      const notionalUsd = Number.isFinite(sz) && Number.isFinite(limitPx) ? Math.abs(sz * limitPx) : 0
      const status: OrderState = filledQty > 0 ? 'PARTIALLY_FILLED' : 'WORKING'

      return {
        orderId: String(order.oid),
        symbol: order.coin,
        side: order.side === 'B' ? 'BUY' : 'SELL',
        status,
        notionalUsd,
        filledQty,
        avgFillPx,
        createdAt: new Date(Number(order.timestamp)).toISOString(),
        source: 'LIVE'
      }
    })

    const updatedAt = new Date(Number(clearinghouse.time)).toISOString()
    const positions: OperatorPosition[] = clearinghouse.assetPositions
      .map((entry) => entry.position)
      .map((position) => {
        const signedQty = Number(position.szi)
        if (!Number.isFinite(signedQty) || signedQty === 0) {
          return null
        }
        const qty = Math.abs(signedQty)
        const entryPx = Number(position.entryPx)
        const positionValue = Number(position.positionValue)
        const markPx = qty > 0 && Number.isFinite(positionValue) ? Math.abs(positionValue) / qty : entryPx
        const unrealizedPnl = Number(position.unrealizedPnl)
        const pnlUsd = Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0

        return {
          symbol: position.coin,
          side: signedQty >= 0 ? 'LONG' : 'SHORT',
          qty,
          notionalUsd: qty * (Number.isFinite(markPx) ? markPx : entryPx),
          avgEntryPx: Number.isFinite(entryPx) ? entryPx : 0,
          markPx: Number.isFinite(markPx) ? markPx : 0,
          pnlUsd,
          updatedAt
        }
      })
      .filter((position): position is OperatorPosition => Boolean(position))

    const realizedPnlUsd = await realizedPnlFromFillsCached(info, wallet.address, realizedCache)

    return {
      orders: orders.map((order) => OperatorOrderSchema.parse(order)),
      positions: positions.map((position) => position),
      realizedPnlUsd
    }
  }

  return { place, cancel, modify, reconcile, snapshot }
}

export function mapToOperatorOrder(order: PlacedOrder): OperatorOrder {
  return OperatorOrderSchema.parse(order)
}

function cloidFromIdempotencyKey(idempotencyKey: string): `0x${string}` {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex')
  return `0x${digest.slice(0, 32)}` as `0x${string}`
}

function mapOrderStatusToPlaced(
  status: {
    order: {
      coin: string
      side: 'B' | 'A'
      limitPx: string
      sz: string
      timestamp: number
      origSz: string
      oid: number
    }
    status: string
    statusTimestamp: number
  },
  nowIso: string
): PlacedOrder {
  const oid = String(status.order.oid)
  const origSz = Number(status.order.origSz)
  const remainingSz = Number(status.order.sz)
  const filledQty = Number.isFinite(origSz) && Number.isFinite(remainingSz) ? Math.max(0, origSz - remainingSz) : 0
  const limitPx = Number(status.order.limitPx)
  const avgFillPx = Number.isFinite(limitPx) ? limitPx : 0
  const notionalUsd = Number.isFinite(origSz) && Number.isFinite(limitPx) ? Math.abs(origSz * limitPx) : 0

  const mappedStatus = mapHlOrderStatus(status.status, filledQty)
  const createdAt = Number.isFinite(status.order.timestamp) ? new Date(status.order.timestamp).toISOString() : nowIso
  return {
    orderId: oid,
    symbol: status.order.coin,
    side: status.order.side === 'B' ? 'BUY' : 'SELL',
    status: mappedStatus,
    notionalUsd,
    filledQty,
    avgFillPx,
    createdAt,
    source: 'LIVE'
  }
}

function mapHlOrderStatus(hlStatus: string, filledQty: number): OrderState {
  if (hlStatus === 'filled') {
    return 'FILLED'
  }
  if (hlStatus === 'open' || hlStatus === 'triggered') {
    return filledQty > 0 ? 'PARTIALLY_FILLED' : 'WORKING'
  }
  if (hlStatus === 'canceled' || hlStatus.endsWith('Canceled') || hlStatus === 'scheduledCancel') {
    return 'CANCELLED'
  }
  if (hlStatus === 'rejected' || hlStatus.endsWith('Rejected')) {
    return 'FAILED'
  }
  return filledQty > 0 ? 'PARTIALLY_FILLED' : 'WORKING'
}

async function realizedPnlFromFillsCached(
  info: InfoClient,
  user: `0x${string}`,
  cache: { fetchedAtMs: number; realizedPnlUsd: number }
): Promise<number> {
  const now = Date.now()
  if (now - cache.fetchedAtMs < 60_000) {
    return cache.realizedPnlUsd
  }

  const fills = await info.userFills({ user, aggregateByTime: true })
  let realized = 0
  for (const fill of fills) {
    const closed = Number((fill as any).closedPnl)
    const fee = Number((fill as any).fee)
    const builderFee = (fill as any).builderFee ? Number((fill as any).builderFee) : 0
    if (Number.isFinite(closed)) {
      realized += closed
    }
    if (Number.isFinite(fee)) {
      realized -= fee
    }
    if (Number.isFinite(builderFee)) {
      realized -= builderFee
    }
  }

  cache.fetchedAtMs = now
  cache.realizedPnlUsd = realized
  return realized
}
