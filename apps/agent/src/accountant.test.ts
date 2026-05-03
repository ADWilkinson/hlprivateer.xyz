import { describe, expect, it } from 'vitest'
import { HyperliquidAccountant, positionsFromClearinghouse } from './accountant'
import type { ClearinghouseState } from './hl'

describe('positionsFromClearinghouse', () => {
  it('maps szi sign → side and positionValue → sizeUsd', () => {
    const state: ClearinghouseState = {
      marginSummary: { accountValue: '12345.67' },
      assetPositions: [
        { type: 'oneWay', position: { coin: 'mkt-A', szi: '5', positionValue: '250.5' } },
        { type: 'oneWay', position: { coin: 'mkt-B', szi: '-3', positionValue: '180' } },
        { type: 'oneWay', position: { coin: 'mkt-flat', szi: '0', positionValue: '0' } }
      ]
    }
    const positions = positionsFromClearinghouse(state)
    expect(positions.size).toBe(2)
    expect(positions.get('mkt-A')).toEqual({ marketId: 'mkt-A', side: 'YES', sizeUsd: 250.5 })
    expect(positions.get('mkt-B')).toEqual({ marketId: 'mkt-B', side: 'NO', sizeUsd: 180 })
  })

  it('skips malformed positions safely', () => {
    const state: ClearinghouseState = {
      marginSummary: { accountValue: '0' },
      assetPositions: [
        { type: 'oneWay', position: { coin: 'bad', szi: 'NaN' } as never }
      ]
    }
    expect(positionsFromClearinghouse(state).size).toBe(0)
  })
})

describe('HyperliquidAccountant', () => {
  function fakeHl(state: ClearinghouseState) {
    const calls: unknown[] = []
    return {
      hl: {
        postInfo: async <T>(body: unknown): Promise<T> => {
          calls.push(body)
          return state as unknown as T
        }
      },
      calls
    }
  }

  it('reads positions and equity from clearinghouseState', async () => {
    const { hl } = fakeHl({
      marginSummary: { accountValue: '5000' },
      crossMarginSummary: { accountValue: '5000' },
      assetPositions: [
        { type: 'oneWay', position: { coin: 'mkt-1', szi: '10', positionValue: '400' } }
      ]
    })
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 100 })
    expect(await a.openExposureUsd()).toBe(400)
    expect(await a.openMarketCount()).toBe(1)
    expect(await a.equityUsd()).toBe(5000)
  })

  it('caches within ttlMs (no second fetch)', async () => {
    const { hl, calls } = fakeHl({
      marginSummary: { accountValue: '0' },
      assetPositions: []
    })
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 60_000 })
    await a.openExposureUsd()
    await a.equityUsd()
    await a.openMarketCount()
    expect(calls).toHaveLength(1)
  })

  it('warmup forces a fresh fetch even when cache is hot', async () => {
    const { hl, calls } = fakeHl({
      marginSummary: { accountValue: '0' },
      assetPositions: []
    })
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 60_000 })
    await a.openExposureUsd()
    await a.warmup()
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('throws when HL throws (no graceful degradation)', async () => {
    const hl = {
      postInfo: async (): Promise<never> => {
        throw new Error('HL down')
      }
    }
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 0 })
    await expect(a.equityUsd()).rejects.toThrow('HL down')
  })

  it('throws when accountValue is non-finite', async () => {
    const { hl } = fakeHl({
      marginSummary: { accountValue: 'not-a-number' },
      assetPositions: []
    })
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 0 })
    await expect(a.equityUsd()).rejects.toThrow(/non-finite/)
  })
})
