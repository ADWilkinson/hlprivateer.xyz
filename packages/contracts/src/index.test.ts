import { describe, expect, it } from 'vitest'
import {
  EventEnvelopeSchema,
  OutcomeMarketSchema,
  OutcomeProposalSchema,
  ProbabilityEstimateSchema,
  RiskConfigSchema,
  RiskDecisionSchema,
  SentimentSignalSchema
} from './index'

const ts = () => new Date().toISOString()

describe('contracts v2', () => {
  it('parses a valid OutcomeMarket', () => {
    const r = OutcomeMarketSchema.safeParse({
      id: 'mkt-1',
      question: 'Will X happen by EOY?',
      resolutionAt: '2026-12-31T23:59:59.000Z',
      status: 'trading',
      yesPrice: 0.42,
      bidYes: 0.41,
      askYes: 0.43,
      bookDepthYesUsd: 1500,
      bookDepthNoUsd: 1200,
      topicTags: ['macro', 'fed'],
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

  it('parses a SentimentSignal', () => {
    const r = SentimentSignalSchema.safeParse({
      id: 's-1',
      marketId: 'mkt-1',
      source: 'news',
      polarity: 0.6,
      confidence: 0.8,
      freshnessSec: 60,
      summary: 'positive Fed comments',
      ts: ts()
    })
    expect(r.success).toBe(true)
  })

  it('parses a ProbabilityEstimate with edge', () => {
    const r = ProbabilityEstimateSchema.safeParse({
      id: 'e-1',
      marketId: 'mkt-1',
      pHat: 0.55,
      marketYesPrice: 0.42,
      edge: 0.13,
      confidence: 0.7,
      basisSignalIds: ['s-1'],
      rationale: 'sentiment skew positive',
      ts: ts()
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
      edgeBps: 1300,
      kellyFraction: 0.1,
      expiresAt: ts(),
      estimateId: 'e-1',
      rationale: 'edge above threshold',
      ts: ts()
    })
    expect(r.success).toBe(true)
  })

  it('parses a RiskDecision (DENY with failures)', () => {
    const r = RiskDecisionSchema.safeParse({
      proposalId: 'p-1',
      decision: 'DENY',
      failures: [
        { code: 'STALE_SENTIMENT', reason: 'sentiment 1200s old > 900s', observed: 1200, threshold: 900 }
      ],
      evaluatedAt: ts()
    })
    expect(r.success).toBe(true)
  })

  it('applies RiskConfig defaults', () => {
    const cfg = RiskConfigSchema.parse({
      bankrollUsd: 10_000,
      maxStakePerMarketUsd: 500,
      maxGrossExposureUsd: 5000,
      maxCorrelatedClusterUsd: 1500
    })
    expect(cfg.maxSentimentAgeSec).toBe(900)
    expect(cfg.kellyCap).toBeCloseTo(0.25)
    expect(cfg.minEdgeBps).toBe(200)
    expect(cfg.haltAll).toBe(false)
  })

  it('parses an EventEnvelope', () => {
    const r = EventEnvelopeSchema.safeParse({
      id: 'evt-1',
      stream: 'hlpv2.proposals',
      type: 'proposal.emitted',
      ts: ts(),
      source: 'oracle',
      correlationId: 'corr-1',
      actorType: 'internal_agent',
      actorId: 'EXE',
      payload: {}
    })
    expect(r.success).toBe(true)
  })
})
