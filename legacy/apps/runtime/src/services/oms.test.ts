import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimAdapter } from './oms'

const baseTick = {
  symbol: 'BTC',
  px: 10,
  bid: 9.95,
  ask: 10.05,
  bidSize: 5000,
  askSize: 5000,
  updatedAt: new Date().toISOString(),
  source: 'sim'
}

describe('sim adapter', () => {
  let randomMock: ReturnType<typeof vi.spyOn> | null = null

  afterEach(() => {
    randomMock?.mockRestore()
    randomMock = null
  })

  beforeEach(() => {
    randomMock = vi.spyOn(Math, 'random').mockReturnValue(0.99)
  })

  it('applies idempotent placement keys', async () => {
    const adapter = createSimAdapter(0, 0)
    const first = await adapter.place({
      symbol: 'BTC',
      side: 'BUY',
      notionalUsd: 1000,
      tick: baseTick,
      idempotencyKey: 'dup-key'
    })
    const second = await adapter.place({
      symbol: 'BTC',
      side: 'BUY',
      notionalUsd: 1000,
      tick: baseTick,
      idempotencyKey: 'dup-key'
    })

    expect(second.orderId).toBe(first.orderId)
    expect(second.status).toBe(first.status)
  })

  it('builds long and short positions from fills', async () => {
    const adapter = createSimAdapter(0, 0)

    await adapter.place({
      symbol: 'BTC',
      side: 'BUY',
      notionalUsd: 200,
      tick: baseTick,
      idempotencyKey: 'long'
    })

    await adapter.place({
      symbol: 'ETH',
      side: 'SELL',
      notionalUsd: 300,
      tick: { ...baseTick, symbol: 'ETH', bid: 2000, ask: 2000 },
      idempotencyKey: 'short'
    })

    const snapshot = await adapter.snapshot()
    const symbols = snapshot.positions.map((position) => position.symbol)
    expect(symbols).toContain('BTC')
    expect(symbols).toContain('ETH')
    expect(snapshot.positions.some((position) => position.side === 'LONG')).toBe(true)
    expect(snapshot.positions.some((position) => position.side === 'SHORT')).toBe(true)
  })

  it('rejects invalid modify input for resolved order', async () => {
    const adapter = createSimAdapter(0, 0)
    const placed = await adapter.place({
      symbol: 'BTC',
      side: 'BUY',
      notionalUsd: 1000,
      tick: baseTick,
      idempotencyKey: 'modify-target'
    })

    await expect(adapter.modify(placed.orderId, -10)).rejects.toThrow()
    await expect(adapter.modify(placed.orderId, 1500)).rejects.toThrowError(/order cannot be modified/)
  })

  it('nets positions and realizes pnl when reducing exposure', async () => {
    const adapter = createSimAdapter(0, 0)

    await adapter.place({
      symbol: 'BTC',
      side: 'BUY',
      notionalUsd: 100,
      tick: { ...baseTick, bid: 10, ask: 10 },
      idempotencyKey: 'open-long'
    })

    await adapter.place({
      symbol: 'BTC',
      side: 'SELL',
      notionalUsd: 60,
      tick: { ...baseTick, bid: 12, ask: 12, px: 12 },
      idempotencyKey: 'reduce-long'
    })

    const snapshot = await adapter.snapshot()
    expect(snapshot.positions.length).toBe(1)
    expect(snapshot.positions[0]?.symbol).toBe('BTC')
    expect(snapshot.positions[0]?.side).toBe('LONG')
    expect(snapshot.positions[0]?.qty).toBeGreaterThan(0)
    expect(snapshot.realizedPnlUsd).toBeGreaterThan(0)
  })
})
