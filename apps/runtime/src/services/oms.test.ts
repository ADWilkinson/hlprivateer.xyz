import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimAdapter } from './oms'

const baseTick = {
  symbol: 'HYPE',
  px: 10,
  bid: 9.95,
  ask: 10.05,
  bidSize: 5000,
  askSize: 5000,
  updatedAt: new Date().toISOString(),
  source: 'sim'
}

describe('sim adapter', () => {
  const randomMock = vi.spyOn(Math, 'random')

  afterEach(() => {
    randomMock.mockRestore()
  })

  beforeEach(() => {
    randomMock.mockReturnValue(0.99)
  })

  it('applies idempotent placement keys', async () => {
    const adapter = createSimAdapter(0, 0)
    const first = await adapter.place({
      symbol: 'HYPE',
      side: 'BUY',
      notionalUsd: 1000,
      tick: baseTick,
      idempotencyKey: 'dup-key'
    })
    const second = await adapter.place({
      symbol: 'HYPE',
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
      symbol: 'HYPE',
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
    expect(symbols).toContain('HYPE')
    expect(symbols).toContain('ETH')
    expect(snapshot.positions.some((position) => position.side === 'LONG')).toBe(true)
    expect(snapshot.positions.some((position) => position.side === 'SHORT')).toBe(true)
  })

  it('rejects invalid modify input for resolved order', async () => {
    const adapter = createSimAdapter(0, 0)
    const placed = await adapter.place({
      symbol: 'HYPE',
      side: 'BUY',
      notionalUsd: 1000,
      tick: baseTick,
      idempotencyKey: 'modify-target'
    })

    await expect(adapter.modify(placed.orderId, -10)).rejects.toThrow()
    await expect(adapter.modify(placed.orderId, 1500)).rejects.toThrowError(/order cannot be modified/)
  })
})
