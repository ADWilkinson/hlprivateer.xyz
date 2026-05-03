import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STRATEGIST_PROMPT,
  LlmStrategyAgent,
  parseAgentProposal,
  renderPrompt
} from './strategy'

const ts = () => new Date().toISOString()

const ctx = () => ({
  market: {
    id: 'mkt-1',
    question: 'Will the Fed pause rate hikes?',
    resolutionAt: ts(),
    challengeWindowSec: 0,
    status: 'trading' as const,
    yesPrice: 0.5,
    bookDepthYesUsd: 1000,
    bookDepthNoUsd: 1000,
    topicTags: ['macro'],
    updatedAt: ts()
  },
  signals: [
    {
      id: 's-1',
      marketId: 'mkt-1',
      source: 'news' as const,
      summary: 'Fed signals patience',
      observedAt: ts()
    }
  ],
  exposureUsd: 0,
  openMarketCount: 0,
  clusterExposureUsd: 0,
  riskConfig: {
    maxSentimentAgeSec: 900,
    minSecondsToResolution: 3600,
    maxSecondsToResolution: 60 * 24 * 3600,
    challengeWindowBufferSec: 0,
    bankrollUsd: 1000,
    maxStakePerMarketUsd: 25,
    maxConcurrentMarkets: 10,
    maxGrossExposureUsd: 250,
    maxCorrelatedClusterUsd: 100,
    minEdgeBps: 200,
    minBookDepthUsd: 500,
    kellyCap: 0.25,
    proposalTtlSec: 300,
    haltAll: false
  }
})

describe('parseAgentProposal', () => {
  it('returns null for skip action', () => {
    const r = parseAgentProposal('{"action": "skip", "reason": "weak signal"}')
    expect(r).toBeNull()
  })

  it('parses a trade proposal embedded in chatter', () => {
    const text = `Sure, here's my call:
{"action": "trade", "side": "YES", "pHat": 0.62, "sizeUsd": 50, "limitPrice": 0.55, "thesis": "macro skew", "signalsConsideredAt": "${ts()}"}`
    const r = parseAgentProposal(text)
    expect(r).not.toBeNull()
    expect(r!.side).toBe('YES')
    expect(r!.pHat).toBeCloseTo(0.62)
    expect(r!.sizeUsd).toBe(50)
  })

  it('clamps out-of-range probabilities', () => {
    const r = parseAgentProposal(
      `{"action": "trade", "side": "NO", "pHat": 1.5, "sizeUsd": 10, "limitPrice": 0.5, "thesis": "x", "signalsConsideredAt": "${ts()}"}`
    )
    expect(r!.pHat).toBe(1)
  })

  it('returns null on garbage', () => {
    expect(parseAgentProposal('not json')).toBeNull()
    expect(parseAgentProposal('')).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    const r = parseAgentProposal('{"action": "trade", "side": "YES"}')
    expect(r).toBeNull()
  })
})

describe('renderPrompt', () => {
  it('includes the system prompt and market context', () => {
    const prompt = renderPrompt(DEFAULT_STRATEGIST_PROMPT, ctx())
    expect(prompt).toContain('outcome-market trading strategist')
    expect(prompt).toContain('mkt-1')
    expect(prompt).toContain('Fed pause rate hikes')
    expect(prompt).toContain('Fed signals patience')
  })

  it('uses a custom prompt when provided', () => {
    const prompt = renderPrompt('CUSTOM PROMPT MARKER', ctx())
    expect(prompt).toContain('CUSTOM PROMPT MARKER')
  })
})

describe('LlmStrategyAgent', () => {
  it('passes the rendered prompt to the completer and parses the response', async () => {
    let capturedPrompt = ''
    const completer = async (p: string) => {
      capturedPrompt = p
      return `{"action": "trade", "side": "YES", "pHat": 0.6, "sizeUsd": 25, "limitPrice": 0.55, "thesis": "x", "signalsConsideredAt": "${ts()}"}`
    }
    const agent = new LlmStrategyAgent(completer, 'CUSTOM-X')
    const proposal = await agent.propose(ctx())
    expect(capturedPrompt).toContain('CUSTOM-X')
    expect(proposal).not.toBeNull()
    expect(proposal!.side).toBe('YES')
  })

  it('returns null when the completer says skip', async () => {
    const completer = async () => '{"action": "skip", "reason": "weak"}'
    const agent = new LlmStrategyAgent(completer)
    expect(await agent.propose(ctx())).toBeNull()
  })
})
