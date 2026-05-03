import { describe, expect, it } from 'vitest'
import { clipSize, edgeBps, kellyFraction } from './math'

describe('edgeBps', () => {
  it('YES edge is pHat - market', () => {
    expect(edgeBps({ pHat: 0.6, marketYesPrice: 0.5, side: 'YES' })).toBe(1000)
  })
  it('NO edge is the mirror', () => {
    expect(edgeBps({ pHat: 0.4, marketYesPrice: 0.5, side: 'NO' })).toBe(1000)
  })
  it('negative edge for the wrong side', () => {
    expect(edgeBps({ pHat: 0.4, marketYesPrice: 0.5, side: 'YES' })).toBe(-1000)
  })
})

describe('kellyFraction', () => {
  it('returns 0 with no edge', () => {
    expect(kellyFraction({ pHat: 0.5, marketYesPrice: 0.5, side: 'YES' })).toBe(0)
  })
  it('returns 0 for negative edge', () => {
    expect(kellyFraction({ pHat: 0.4, marketYesPrice: 0.5, side: 'YES' })).toBe(0)
  })
  it('caps at kellyCap', () => {
    const f = kellyFraction({ pHat: 0.95, marketYesPrice: 0.1, side: 'YES', kellyCap: 0.25 })
    expect(f).toBeCloseTo(0.25)
  })
  it('returns a positive fractional bet for moderate edge', () => {
    const f = kellyFraction({ pHat: 0.6, marketYesPrice: 0.5, side: 'YES', kellyCap: 0.5 })
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(0.5)
  })
})

describe('clipSize', () => {
  it('clips by Kelly cap when agent over-sizes', () => {
    const r = clipSize({
      agentSizeUsd: 100_000,
      pHat: 0.6,
      marketYesPrice: 0.5,
      side: 'YES',
      bankrollUsd: 1000,
      kellyCap: 0.1,
      maxStakePerMarketUsd: 10_000,
      remainingExposureUsd: 10_000
    })
    expect(r.sizeUsd).toBeLessThanOrEqual(1000 * 0.1)
    expect(r.kellyFraction).toBeGreaterThan(0)
  })
  it('respects maxStakePerMarketUsd', () => {
    const r = clipSize({
      agentSizeUsd: 100_000,
      pHat: 0.95,
      marketYesPrice: 0.1,
      side: 'YES',
      bankrollUsd: 1_000_000,
      kellyCap: 1,
      maxStakePerMarketUsd: 25,
      remainingExposureUsd: 10_000
    })
    expect(r.sizeUsd).toBe(25)
  })
  it('respects remaining gross exposure', () => {
    const r = clipSize({
      agentSizeUsd: 1000,
      pHat: 0.95,
      marketYesPrice: 0.1,
      side: 'YES',
      bankrollUsd: 1000,
      kellyCap: 1,
      maxStakePerMarketUsd: 1000,
      remainingExposureUsd: 50
    })
    expect(r.sizeUsd).toBe(50)
  })
  it('returns 0 when no edge', () => {
    const r = clipSize({
      agentSizeUsd: 100,
      pHat: 0.5,
      marketYesPrice: 0.5,
      side: 'YES',
      bankrollUsd: 1000,
      kellyCap: 0.25,
      maxStakePerMarketUsd: 100,
      remainingExposureUsd: 1000
    })
    expect(r.sizeUsd).toBe(0)
  })
})
