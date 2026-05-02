import type { SentimentSource } from '@hl/privateer-contracts'

export interface RawSentimentItem {
  marketId: string
  source: SentimentSource
  summary: string
  url?: string
  observedAt: string
}

export interface ScoredSentiment {
  polarity: number
  confidence: number
}

export interface SentimentScorer {
  score(item: RawSentimentItem, marketContext?: { question: string }): Promise<ScoredSentiment>
}

export type LlmCompleter = (prompt: string) => Promise<string>

export const DEFAULT_SYSTEM_PROMPT =
  `You are a sentiment scorer for binary outcome markets on Hyperliquid.\n` +
  `Output ONLY a JSON object: {"polarity": number in [-1,1], "confidence": number in [0,1]}.\n` +
  `Polarity is +1 if the item strongly implies YES (the event will occur),\n` +
  `-1 if NO. Confidence is the model's reliability for this datum.`

export class LlmScorer implements SentimentScorer {
  constructor(
    private readonly complete: LlmCompleter,
    private readonly systemPrompt: string = DEFAULT_SYSTEM_PROMPT
  ) {}

  async score(item: RawSentimentItem, ctx?: { question: string }): Promise<ScoredSentiment> {
    const userPart = [
      ctx?.question ? `Market question: ${ctx.question}` : '',
      `Source: ${item.source}`,
      `Item: ${item.summary}`
    ]
      .filter(Boolean)
      .join('\n')
    return parseScore(await this.complete(`${this.systemPrompt}\n\n${userPart}`))
  }
}

export function parseScore(text: string): ScoredSentiment {
  const match = text.match(/\{[^{}]*\}/)
  if (!match) return { polarity: 0, confidence: 0 }
  try {
    const obj = JSON.parse(match[0]) as { polarity?: number; confidence?: number }
    return {
      polarity: clamp(obj.polarity ?? 0, -1, 1),
      confidence: clamp(obj.confidence ?? 0, 0, 1)
    }
  } catch {
    return { polarity: 0, confidence: 0 }
  }
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo
  return Math.min(hi, Math.max(lo, x))
}
