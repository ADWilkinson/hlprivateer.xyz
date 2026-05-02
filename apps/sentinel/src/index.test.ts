import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '@hl/privateer-event-bus'
import {
  createSentinel,
  InMemorySource,
  LlmScorer,
  parseScore,
  type SentimentScorer
} from './index'

// Test-only: a deterministic scorer that maps a lexicon hit to a polarity.
// Production wires LlmScorer + a real shell-out completer.
class StubScorer implements SentimentScorer {
  async score(item: { summary: string }): Promise<{ polarity: number; confidence: number }> {
    if (item.summary.toLowerCase().includes('strong')) return { polarity: 0.7, confidence: 0.8 }
    if (item.summary.toLowerCase().includes('crash')) return { polarity: -0.7, confidence: 0.8 }
    return { polarity: 0, confidence: 0.1 }
  }
}

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

describe('LlmScorer', () => {
  it('passes the system prompt through to the completer', async () => {
    let prompt = ''
    const scorer = new LlmScorer(async (p) => {
      prompt = p
      return '{"polarity": 0.1, "confidence": 0.5}'
    }, 'CUSTOM PROMPT MARKER')
    await scorer.score({
      marketId: 'm',
      source: 'news',
      summary: 'x',
      observedAt: new Date().toISOString()
    })
    expect(prompt).toContain('CUSTOM PROMPT MARKER')
    expect(prompt).toContain('Source: news')
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
      scorer: new StubScorer()
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
