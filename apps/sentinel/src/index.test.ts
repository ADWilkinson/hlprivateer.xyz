import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '@hl/privateer-event-bus'
import {
  createSentinel,
  HeuristicScorer,
  InMemorySource,
  parseScore
} from './index'

describe('HeuristicScorer', () => {
  it('returns neutral on empty lexicon hits', async () => {
    const r = await new HeuristicScorer().score({
      marketId: 'm',
      source: 'news',
      summary: 'unrelated lorem ipsum',
      observedAt: new Date().toISOString()
    })
    expect(r.polarity).toBe(0)
  })

  it('returns positive polarity on bullish lexicon', async () => {
    const r = await new HeuristicScorer().score({
      marketId: 'm',
      source: 'news',
      summary: 'Fed approves expansion. Strong gains.',
      observedAt: new Date().toISOString()
    })
    expect(r.polarity).toBeGreaterThan(0)
    expect(r.confidence).toBeGreaterThan(0.3)
  })

  it('returns negative polarity on bearish lexicon', async () => {
    const r = await new HeuristicScorer().score({
      marketId: 'm',
      source: 'news',
      summary: 'Sanctions and lawsuit; recession concerns.',
      observedAt: new Date().toISOString()
    })
    expect(r.polarity).toBeLessThan(0)
  })
})

describe('parseScore', () => {
  it('extracts JSON from messy text', () => {
    const r = parseScore('Sure, here:\n{"polarity": 0.6, "confidence": 0.8}')
    expect(r.polarity).toBeCloseTo(0.6)
    expect(r.confidence).toBeCloseTo(0.8)
  })
  it('clamps out-of-range values', () => {
    const r = parseScore('{"polarity": 5, "confidence": -1}')
    expect(r.polarity).toBe(1)
    expect(r.confidence).toBe(0)
  })
  it('returns zero on garbage', () => {
    expect(parseScore('not json').polarity).toBe(0)
  })
})

describe('createSentinel.tick', () => {
  it('publishes a SentimentSignal envelope per source item', async () => {
    const bus = new InMemoryEventBus()
    const source = new InMemorySource()
    source.push({
      marketId: 'mkt-1',
      source: 'news',
      summary: 'Strong gains and approved deal',
      observedAt: new Date(Date.now() - 60_000).toISOString()
    })

    const sentinel = createSentinel({
      bus,
      sources: [source],
      scorer: new HeuristicScorer()
    })

    const emitted = await sentinel.tick()
    expect(emitted).toBe(1)

    const batch = await bus.readBatch('hlpv2.sentiment', '0-0', 10)
    expect(batch).toHaveLength(1)
    expect(batch[0].envelope.type).toBe('sentiment.signal')
    const payload = batch[0].envelope.payload as { polarity: number; freshnessSec: number }
    expect(payload.polarity).toBeGreaterThan(0)
    expect(payload.freshnessSec).toBeGreaterThanOrEqual(60)
  })
})
