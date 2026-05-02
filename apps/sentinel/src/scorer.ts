import type { SentimentSource } from '@hl/privateer-contracts'

export interface RawSentimentItem {
  marketId: string
  source: SentimentSource
  summary: string
  url?: string
  observedAt: string
}

export interface ScoredSentiment {
  polarity: number     // [-1, 1]
  confidence: number   // [0, 1]
}

export interface SentimentScorer {
  score(item: RawSentimentItem, marketContext?: { question: string }): Promise<ScoredSentiment>
}

// ────────────────────────────────────────────────────────────────────────────
// Heuristic scorer
//
// Lexicon-based polarity. Deterministic, no I/O, used as the test/dev default
// and as the fallback when no LLM is configured. The production stack swaps
// this for an LLM adapter (see `LlmScorer` below).
// ────────────────────────────────────────────────────────────────────────────

const POSITIVE = [
  'beat', 'beats', 'rally', 'surge', 'jump', 'gain', 'gains', 'positive', 'bull',
  'bullish', 'win', 'approved', 'approve', 'pass', 'passed', 'green', 'rise',
  'strong', 'expand', 'growth', 'optimistic', 'breakthrough', 'agreement', 'deal'
]

const NEGATIVE = [
  'miss', 'misses', 'fall', 'drop', 'plunge', 'crash', 'loss', 'losses',
  'negative', 'bear', 'bearish', 'reject', 'rejected', 'fail', 'failed',
  'red', 'weak', 'shrink', 'recession', 'pessimistic', 'concern', 'concerns',
  'protest', 'sanction', 'sanctions', 'fine', 'fined', 'lawsuit', 'arrest'
]

export class HeuristicScorer implements SentimentScorer {
  async score(item: RawSentimentItem): Promise<ScoredSentiment> {
    const text = item.summary.toLowerCase()
    const tokens = text.split(/[^a-z]+/).filter(Boolean)
    let pos = 0
    let neg = 0
    for (const t of tokens) {
      if (POSITIVE.includes(t)) pos++
      if (NEGATIVE.includes(t)) neg++
    }
    const total = pos + neg
    if (total === 0) {
      return { polarity: 0, confidence: 0.1 }
    }
    const polarity = (pos - neg) / total
    // Confidence rises with hit count, saturates fast.
    const confidence = Math.min(0.9, 0.3 + total * 0.1)
    return { polarity, confidence }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LLM scorer adapter
//
// Wired to a caller-supplied `complete()` so this package stays I/O-free in
// tests. The `LlmCompleter` shape matches what Claude/Codex CLIs already
// produce in v1's agent-runner; ports forward unchanged.
// ────────────────────────────────────────────────────────────────────────────

export interface LlmCompletion {
  text: string
}

export interface LlmCompleter {
  (prompt: string): Promise<LlmCompletion>
}

const LLM_PROMPT = (item: RawSentimentItem, q?: string) =>
  [
    `You are a sentiment scorer for binary outcome markets on Hyperliquid.`,
    `Output ONLY a JSON object: {"polarity": number in [-1,1], "confidence": number in [0,1]}.`,
    `Polarity is +1 if the item strongly implies YES (the event will occur),`,
    `-1 if NO. Confidence is the model's reliability for this datum.`,
    q ? `Market question: ${q}` : '',
    `Source: ${item.source}`,
    `Item: ${item.summary}`
  ]
    .filter(Boolean)
    .join('\n')

export class LlmScorer implements SentimentScorer {
  constructor(private readonly complete: LlmCompleter) {}

  async score(item: RawSentimentItem, ctx?: { question: string }): Promise<ScoredSentiment> {
    const { text } = await this.complete(LLM_PROMPT(item, ctx?.question))
    return parseScore(text)
  }
}

export function parseScore(text: string): ScoredSentiment {
  const match = text.match(/\{[^{}]*\}/)
  if (!match) return { polarity: 0, confidence: 0 }
  try {
    const obj = JSON.parse(match[0]) as { polarity?: number; confidence?: number }
    const polarity = clamp(obj.polarity ?? 0, -1, 1)
    const confidence = clamp(obj.confidence ?? 0, 0, 1)
    return { polarity, confidence }
  } catch {
    return { polarity: 0, confidence: 0 }
  }
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo
  return Math.min(hi, Math.max(lo, x))
}
