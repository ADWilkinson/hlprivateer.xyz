import { describe, expect, it } from 'vitest'
import { LlmScorer, parseScore } from './scorer'

describe('LlmScorer', () => {
  it('uses the supplied completer and parses JSON', async () => {
    const scorer = new LlmScorer(async () => 'Reasoning omitted. {"polarity": -0.3, "confidence": 0.4}')
    const r = await scorer.score({
      marketId: 'm',
      source: 'news',
      summary: 's',
      observedAt: new Date().toISOString()
    })
    expect(r.polarity).toBeCloseTo(-0.3)
    expect(r.confidence).toBeCloseTo(0.4)
  })

  it('returns zero polarity when LLM emits garbage', async () => {
    const scorer = new LlmScorer(async () => 'no idea')
    const r = await scorer.score({
      marketId: 'm',
      source: 'news',
      summary: 's',
      observedAt: new Date().toISOString()
    })
    expect(r.polarity).toBe(0)
  })

  it('parseScore handles missing fields', () => {
    expect(parseScore('{"polarity": 0.2}')).toEqual({ polarity: 0.2, confidence: 0 })
  })
})
