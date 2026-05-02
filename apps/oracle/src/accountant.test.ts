import { describe, expect, it } from 'vitest'
import type { OutcomeMarket } from '@hl/privateer-contracts'
import type { ClearinghouseState } from '@hl/privateer-hl-client'
import {
  HyperliquidAccountant,
  LocalAccountant,
  positionsFromClearinghouse
} from './accountant'

const market = (over: Partial<OutcomeMarket> = {}): OutcomeMarket => ({
  id: 'mkt-1',
  question: 'q',
  resolutionAt: new Date().toISOString(),
  challengeWindowSec: 0,
  status: 'trading',
  yesPrice: 0.5,
  bookDepthYesUsd: 0,
  bookDepthNoUsd: 0,
  topicTags: [],
  updatedAt: new Date().toISOString(),
  ...over
})

describe('LocalAccountant', () => {
  it('accumulates fills on the same side', async () => {
    const a = new LocalAccountant()
    a.notifyLocalFill({ id: 'f1', proposalId: 'p1', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    a.notifyLocalFill({ id: 'f2', proposalId: 'p2', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 50, feeUsd: 0, ts: '' })
    expect(await a.openExposureUsd()).toBe(150)
    expect(await a.openMarketCount()).toBe(1)
  })

  it('reduces on opposite side and flips when crossed', async () => {
    const a = new LocalAccountant()
    a.notifyLocalFill({ id: 'f1', proposalId: 'p1', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    a.notifyLocalFill({ id: 'f2', proposalId: 'p2', marketId: 'a', side: 'NO', fillPrice: 0.6, fillSizeUsd: 30, feeUsd: 0, ts: '' })
    expect(await a.openExposureUsd()).toBe(70)
    a.notifyLocalFill({ id: 'f3', proposalId: 'p3', marketId: 'a', side: 'NO', fillPrice: 0.6, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    expect(await a.openExposureUsd()).toBe(30)
    expect((await a.positions())[0].side).toBe('NO')
  })

  it('removes a market when crossed exactly', async () => {
    const a = new LocalAccountant()
    a.notifyLocalFill({ id: 'f1', proposalId: 'p1', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    a.notifyLocalFill({ id: 'f2', proposalId: 'p2', marketId: 'a', side: 'NO', fillPrice: 0.6, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    expect(await a.openMarketCount()).toBe(0)
  })

  it('computes cluster exposure across shared topic tags', async () => {
    const a = new LocalAccountant()
    a.recordMarket(market({ id: 'a', topicTags: ['fed', 'macro'] }))
    a.recordMarket(market({ id: 'b', topicTags: ['fed'] }))
    a.recordMarket(market({ id: 'c', topicTags: ['eth'] }))
    a.notifyLocalFill({ id: 'f1', proposalId: 'p1', marketId: 'b', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    a.notifyLocalFill({ id: 'f2', proposalId: 'p2', marketId: 'c', side: 'YES', fillPrice: 0.4, fillSizeUsd: 200, feeUsd: 0, ts: '' })
    expect(await a.clusterExposureUsd(market({ id: 'a', topicTags: ['fed', 'macro'] }))).toBe(100)
  })

  it('local equity is unknown', async () => {
    expect(await new LocalAccountant().equityUsd()).toBeNull()
  })
})

describe('positionsFromClearinghouse', () => {
  it('maps szi sign → side and positionValue → sizeUsd', () => {
    const state: ClearinghouseState = {
      marginSummary: {
        accountValue: '12345.67',
        totalNtlPos: '0',
        totalRawUsd: '0',
        totalMarginUsed: '0'
      },
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
      marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
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
      } as never,
      calls
    }
  }

  it('reads positions and equity from HL clearinghouseState', async () => {
    const { hl } = fakeHl({
      marginSummary: { accountValue: '5000', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
      crossMarginSummary: { accountValue: '5000', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
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
      marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
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
      marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
      assetPositions: []
    })
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 60_000 })
    await a.openExposureUsd()
    await a.warmup()
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('degrades gracefully when HL throws (returns last known)', async () => {
    let throwNext = false
    const hl = {
      postInfo: async <T>(_body: unknown): Promise<T> => {
        if (throwNext) throw new Error('HL down')
        return {
          marginSummary: { accountValue: '100', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
          assetPositions: []
        } as unknown as T
      }
    } as never
    const a = new HyperliquidAccountant({ hl, user: '0xdead', ttlMs: 0 })
    expect(await a.equityUsd()).toBe(100)
    throwNext = true
    // Even with HL throwing, we still return the last known value (100).
    expect(await a.equityUsd()).toBe(100)
  })
})
