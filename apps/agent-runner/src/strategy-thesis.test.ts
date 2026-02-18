import { describe, expect, it } from 'vitest'
import { buildProposalThesis, classifyThesisHorizon } from './strategy-thesis'

describe('strategy thesis builder', () => {
  it('classifies CORE horizon from long-duration language', () => {
    const horizon = classifyThesisHorizon('position trade over multiple months', 30 * 60_000)
    expect(horizon.horizonClass).toBe('CORE')
    expect(horizon.timeframeMin).toBe(30 * 24 * 60)
  })

  it('classifies SWING horizon from multi-day language', () => {
    const horizon = classifyThesisHorizon('expect a swing over the next week', 30 * 60_000)
    expect(horizon.horizonClass).toBe('SWING')
    expect(horizon.timeframeMin).toBe(7 * 24 * 60)
  })

  it('defaults to DAY horizon and scales stop/tp by confidence', () => {
    const now = new Date('2026-02-18T00:00:00.000Z')
    const thesis = buildProposalThesis({
      rationale: 'short-term directional setup',
      confidence: 0.9,
      pipelineBaseMs: 30 * 60_000,
      now,
      makeThesisId: () => 'thesis_fixed'
    })

    expect(thesis).toMatchObject({
      thesisId: 'thesis_fixed',
      horizonClass: 'DAY',
      timeframeMin: 120,
      createdAt: now.toISOString()
    })
    expect(thesis.stopLossPct).toBeGreaterThan(1.6)
    expect(thesis.stopLossPct).toBeLessThan(2.8)
    expect(thesis.takeProfitPct).toBeGreaterThan(thesis.stopLossPct)
  })
})
