import { describe, expect, it } from 'vitest'
import type { OperatorPosition } from '@hl/privateer-contracts'
import { buildFlatSignature, hasDustOnlyExposure, meaningfulPositions } from './exposure'

function makePosition(input: Pick<OperatorPosition, 'symbol' | 'side' | 'qty' | 'notionalUsd'>): OperatorPosition {
  return {
    symbol: input.symbol,
    side: input.side,
    qty: input.qty,
    notionalUsd: input.notionalUsd,
    avgEntryPx: 1,
    markPx: 1,
    pnlUsd: 0,
    updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString()
  }
}

describe('exposure utils', () => {
  it('treats positions below the threshold as flat', () => {
    const thresholdUsd = 50
    const positions = [makePosition({ symbol: 'HYPE', side: 'LONG', qty: 1, notionalUsd: 49 })]
    expect(meaningfulPositions(positions, thresholdUsd)).toEqual([])
    expect(buildFlatSignature(positions, thresholdUsd)).toBe('FLAT')
    expect(hasDustOnlyExposure(positions, thresholdUsd)).toBe(true)
  })

  it('includes positions at or above the threshold', () => {
    const thresholdUsd = 50
    const positions = [
      makePosition({ symbol: 'BTC', side: 'SHORT', qty: 1, notionalUsd: 50 }),
      makePosition({ symbol: 'HYPE', side: 'LONG', qty: 1, notionalUsd: 60 })
    ]
    expect(meaningfulPositions(positions, thresholdUsd).length).toBe(2)
    expect(buildFlatSignature(positions, thresholdUsd)).not.toBe('FLAT')
    expect(hasDustOnlyExposure(positions, thresholdUsd)).toBe(false)
  })
})

