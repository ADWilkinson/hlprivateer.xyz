import { describe, expect, it } from 'vitest'
import { ExposureLedger } from './exposure'
import type { OutcomeMarket } from '@hl/privateer-contracts'

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

describe('ExposureLedger', () => {
  it('accumulates fills on the same side', () => {
    const l = new ExposureLedger()
    l.applyFill({ id: 'f1', proposalId: 'p1', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    l.applyFill({ id: 'f2', proposalId: 'p2', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 50, feeUsd: 0, ts: '' })
    expect(l.openExposureUsd()).toBe(150)
    expect(l.openMarketCount()).toBe(1)
  })

  it('reduces on opposite side and flips when crossed', () => {
    const l = new ExposureLedger()
    l.applyFill({ id: 'f1', proposalId: 'p1', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    l.applyFill({ id: 'f2', proposalId: 'p2', marketId: 'a', side: 'NO', fillPrice: 0.6, fillSizeUsd: 30, feeUsd: 0, ts: '' })
    expect(l.openExposureUsd()).toBe(70)
    l.applyFill({ id: 'f3', proposalId: 'p3', marketId: 'a', side: 'NO', fillPrice: 0.6, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    expect(l.openExposureUsd()).toBe(30)
    expect(l.positions()[0].side).toBe('NO')
  })

  it('removes a market when crossed exactly', () => {
    const l = new ExposureLedger()
    l.applyFill({ id: 'f1', proposalId: 'p1', marketId: 'a', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    l.applyFill({ id: 'f2', proposalId: 'p2', marketId: 'a', side: 'NO', fillPrice: 0.6, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    expect(l.openMarketCount()).toBe(0)
  })

  it('computes cluster exposure across shared topic tags', () => {
    const l = new ExposureLedger()
    l.recordMarket(market({ id: 'a', topicTags: ['fed', 'macro'] }))
    l.recordMarket(market({ id: 'b', topicTags: ['fed'] }))
    l.recordMarket(market({ id: 'c', topicTags: ['eth'] }))
    l.applyFill({ id: 'f1', proposalId: 'p1', marketId: 'b', side: 'YES', fillPrice: 0.4, fillSizeUsd: 100, feeUsd: 0, ts: '' })
    l.applyFill({ id: 'f2', proposalId: 'p2', marketId: 'c', side: 'YES', fillPrice: 0.4, fillSizeUsd: 200, feeUsd: 0, ts: '' })
    expect(l.clusterExposureUsd(market({ id: 'a', topicTags: ['fed', 'macro'] }))).toBe(100)
  })
})
