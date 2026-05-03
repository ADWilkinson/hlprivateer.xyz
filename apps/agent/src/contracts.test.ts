import { describe, expect, it } from 'vitest'
import {
  AgentProposalSchema,
  OutcomeMarketSchema,
  OutcomeProposalSchema,
  RiskConfigSchema,
  RiskDecisionSchema,
  SentimentItemSchema,
  StrategyConfigSchema
} from './contracts'

const ts = () => new Date().toISOString()

describe('contracts', () => {
  it('parses a valid OutcomeMarket', () => {
    const r = OutcomeMarketSchema.safeParse({
      id: 'mkt-1',
      question: 'Will X happen by EOY?',
      resolutionAt: '2026-12-31T23:59:59.000Z',
      status: 'trading',
      yesPrice: 0.42,
      bookDepthYesUsd: 1500,
      bookDepthNoUsd: 1200,
      topicTags: ['macro'],
      updatedAt: ts()
    })
    expect(r.success).toBe(true)
  })

  it('rejects probability out of [0,1]', () => {
    const r = OutcomeMarketSchema.safeParse({
      id: 'mkt-2',
      question: 'q',
      resolutionAt: ts(),
      status: 'trading',
      yesPrice: 1.5,
      updatedAt: ts()
    })
    expect(r.success).toBe(false)
  })

  it('parses a SentimentItem', () => {
    const r = SentimentItemSchema.safeParse({
      id: 's-1',
      marketId: 'mkt-1',
      source: 'news',
      summary: 'fed pauses rates',
      observedAt: ts()
    })
    expect(r.success).toBe(true)
  })

  it('parses an AgentProposal', () => {
    const r = AgentProposalSchema.safeParse({
      side: 'YES',
      pHat: 0.62,
      sizeUsd: 100,
      limitPrice: 0.55,
      thesis: 'positive macro skew',
      signalsConsideredAt: ts()
    })
    expect(r.success).toBe(true)
  })

  it('parses an OutcomeProposal', () => {
    const r = OutcomeProposalSchema.safeParse({
      id: 'p-1',
      marketId: 'mkt-1',
      side: 'YES',
      limitPrice: 0.5,
      sizeUsd: 100,
      pHat: 0.6,
      edgeBps: 1300,
      kellyFraction: 0.1,
      expiresAt: ts(),
      thesis: 'edge above threshold',
      signalsConsideredAt: ts(),
      ts: ts()
    })
    expect(r.success).toBe(true)
  })

  it('parses a RiskDecision', () => {
    const r = RiskDecisionSchema.safeParse({
      proposalId: 'p-1',
      decision: 'DENY',
      failures: [
        { code: 'STALE_SENTIMENT', reason: 'too old', observed: 1200, threshold: 900 }
      ],
      evaluatedAt: ts()
    })
    expect(r.success).toBe(true)
  })

  it('applies RiskConfig defaults', () => {
    const cfg = RiskConfigSchema.parse({})
    expect(cfg.maxSentimentAgeSec).toBe(900)
    expect(cfg.kellyCap).toBeCloseTo(0.25)
    expect(cfg.minEdgeBps).toBe(200)
    expect(cfg.haltAll).toBe(false)
    expect(cfg.proposalTtlSec).toBe(300)
  })

  it('applies StrategyConfig defaults', () => {
    const s = StrategyConfigSchema.parse({})
    expect(s.risk.bankrollUsd).toBe(1000)
    expect(s.prompts.strategist).toBeUndefined()
    expect(s.marketFilter.allowTags).toBeUndefined()
  })
})
