import { describe, expect, it } from 'vitest'
import {
  HttpReplayQuerySchema,
  ReplayRangeSchema,
  parseStrategyProposal,
  RiskDecisionResultSchema,
  StrategyActionSchema,
  StrategyProposalSchema,
  WsMessageSchema,
  WsServerMessageSchema
} from './index'

describe('contracts', () => {
  it('rejects unknown strategy fields', () => {
    const result = parseStrategyProposal({
      proposalId: 'p-1',
      cycleId: 'c-1',
      summary: 'test',
      confidence: 0.5,
      createdBy: 'agent',
      requestedMode: 'SIM',
      actions: [
        {
          type: 'ENTER',
          rationale: 'test',
          notionalUsd: 100,
          legs: [{ symbol: 'HYPE', side: 'BUY', notionalUsd: 100 }],
          unexpected: 'blocked'
        }
      ]
    } as any)

    if (result.ok) {
      throw new Error('expected validation failure')
    }

    expect(result.errors[0]?.code).toBe('SCHEMA_VALIDATION_ERROR')
  })

  it('supports strict strategy schema parsing', () => {
    const proposal = StrategyProposalSchema.parse({
      proposalId: 'p-2',
      cycleId: 'c-2',
      summary: 'pair',
      confidence: 0.9,
      createdBy: 'agent',
      requestedMode: 'SIM',
      actions: [
        {
          type: 'ENTER',
          rationale: 'market',
          notionalUsd: 1000,
          legs: [
            { symbol: 'HYPE', side: 'BUY', notionalUsd: 500 },
            { symbol: 'BTC', side: 'SELL', notionalUsd: 500 }
          ]
        }
      ]
    })

    expect(proposal.actions[0].notionalUsd).toBe(1000)
  })

  it('documents risk decision shape', () => {
    const parsed = RiskDecisionResultSchema.parse({
      decision: 'ALLOW',
      reasons: [],
      decisionId: 'dec-test',
      correlationId: 'abc',
      computedAt: new Date().toISOString(),
      computed: {
        grossExposureUsd: 0,
        netExposureUsd: 0,
        projectedDrawdownPct: 0
      }
    })

    expect(parsed.decision).toBe('ALLOW')
  })

  it('rejects unknown websocket client fields', () => {
    expect(() =>
      WsMessageSchema.parse({
        type: 'ping',
        unknown: 'blocked'
      })
    ).toThrowError()
  })

  it('rejects unknown websocket server fields', () => {
    expect(() =>
      WsServerMessageSchema.parse({
        type: 'pong',
        unknown: 'blocked'
      })
    ).toThrowError()
  })

  it('supports replay query ranges with optional resource', () => {
    const range = ReplayRangeSchema.parse({
      from: '2026-02-13T16:20:00.000Z',
      to: '2026-02-13T16:21:00.000Z',
      resource: 'hlp.audit.events',
      correlationId: 'corr-1'
    })

    expect(range.resource).toBe('hlp.audit.events')
    expect(range.correlationId).toBe('corr-1')
  })

  it('rejects malformed replay window order', () => {
    expect(() =>
      HttpReplayQuerySchema.parse({
        from: '2026-02-13T16:30:00.000Z',
        to: '2026-02-13T16:20:00.000Z',
        limit: 200
      })
    ).toThrowError()
  })
})
