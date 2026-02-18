import { describe, expect, it } from 'vitest'
import type { StrategyProposal } from '@hl/privateer-contracts'
import { shouldSuppressDiscretionaryExit, type ActiveThesisState } from './thesis-guard'

function makeExitProposal(exitReason: StrategyProposal['exitReason'] = 'DISCRETIONARY'): StrategyProposal {
  return {
    proposalId: 'proposal_1',
    cycleId: 'cycle_1',
    summary: 'exit',
    confidence: 0.8,
    createdBy: 'strategist',
    requestedMode: 'SIM',
    exitReason,
    actions: [
      {
        type: 'EXIT',
        rationale: 'trim risk',
        notionalUsd: 1000,
        expectedSlippageBps: 5,
        maxSlippageBps: 10,
        legs: [{ symbol: 'BTC', side: 'SELL', notionalUsd: 1000 }]
      }
    ]
  }
}

const activeThesis: ActiveThesisState = {
  thesisId: 'thesis_1',
  horizonClass: 'SWING',
  startedAtMs: Date.parse('2026-02-18T00:00:00.000Z'),
  timeframeMin: 7 * 24 * 60,
  stopLossPct: 3,
  takeProfitPct: 6,
  symbols: ['BTC']
}

describe('thesis exit suppression guard', () => {
  it('suppresses discretionary exits while thesis is still valid', () => {
    const guard = shouldSuppressDiscretionaryExit({
      proposal: makeExitProposal('DISCRETIONARY'),
      activeThesis,
      pnlPct: 1.2,
      nowMs: Date.parse('2026-02-18T06:00:00.000Z')
    })

    expect(guard.suppress).toBe(true)
    expect(guard.reason).toContain('thesis thesis_1/SWING still valid')
  })

  it('does not suppress risk-off exits', () => {
    const guard = shouldSuppressDiscretionaryExit({
      proposal: makeExitProposal('RISK_OFF'),
      activeThesis,
      pnlPct: 1.2,
      nowMs: Date.parse('2026-02-18T06:00:00.000Z')
    })

    expect(guard.suppress).toBe(false)
  })

  it('does not suppress when stop-loss is hit', () => {
    const guard = shouldSuppressDiscretionaryExit({
      proposal: makeExitProposal('DISCRETIONARY'),
      activeThesis,
      pnlPct: -4,
      nowMs: Date.parse('2026-02-18T06:00:00.000Z')
    })

    expect(guard.suppress).toBe(false)
  })
})
