import { describe, expect, it } from 'vitest'
import { evaluateRisk } from './index.ts'

const baseConfig = {
  maxLeverage: 2,
  maxDrawdownPct: 5,
  maxExposureUsd: 50000,
  maxSlippageBps: 25,
  staleDataMs: 3000,
  liquidityBufferPct: 1,
  notionalParityTolerance: 0.015,
  failClosedOnDependencyError: true
}

describe('risk-engine', () => {
  it('allows a valid proposal with equal notional', () => {
    const decision = evaluateRisk(baseConfig, {
      state: 'READY',
      actorType: 'internal_agent',
      accountValueUsd: 10000,
      dependenciesHealthy: true,
      openPositions: [],
      ticks: {
        HYPE: {
          symbol: 'HYPE',
          px: 100,
          bid: 100,
          ask: 100,
          bidSize: 100,
          askSize: 100,
          updatedAt: new Date().toISOString()
        },
        ETH: {
          symbol: 'ETH',
          px: 2000,
          bid: 2000,
          ask: 2000,
          bidSize: 100,
          askSize: 100,
          updatedAt: new Date().toISOString()
        }
      },
      proposal: {
        proposalId: 'p1',
        cycleId: 'c1',
        summary: 'pair trade',
        confidence: 0.8,
        requestedMode: 'SIM',
        createdBy: 'agent',
        actions: [
          {
            type: 'ENTER',
            rationale: 'test',
            notionalUsd: 2000,
            expectedSlippageBps: 2,
            legs: [
              { symbol: 'HYPE', side: 'BUY', notionalUsd: 1000 },
              { symbol: 'ETH', side: 'SELL', notionalUsd: 1000 }
            ]
          }
        ]
      }
    })

    expect(decision.decision).toBe('ALLOW')
    expect(decision.reasons).toHaveLength(0)
  })

  it('denies proposals with stale data', () => {
    const decision = evaluateRisk(baseConfig, {
      state: 'READY',
      actorType: 'internal_agent',
      accountValueUsd: 10000,
      dependenciesHealthy: true,
      openPositions: [],
      ticks: {
        HYPE: {
          symbol: 'HYPE',
          px: 100,
          bid: 100,
          ask: 100,
          bidSize: 100,
          askSize: 100,
          updatedAt: new Date(Date.now() - 100000).toISOString()
        },
        ETH: {
          symbol: 'ETH',
          px: 2000,
          bid: 2000,
          ask: 2000,
          bidSize: 100,
          askSize: 100,
          updatedAt: new Date(Date.now() - 100000).toISOString()
        }
      },
      proposal: {
        proposalId: 'p2',
        cycleId: 'c1',
        summary: 'pair trade',
        confidence: 0.8,
        requestedMode: 'SIM',
        createdBy: 'agent',
        actions: [
          {
            type: 'ENTER',
            rationale: 'test',
            notionalUsd: 2000,
            expectedSlippageBps: 2,
            legs: [
              { symbol: 'HYPE', side: 'BUY', notionalUsd: 1000 },
              { symbol: 'ETH', side: 'SELL', notionalUsd: 1000 }
            ]
          }
        ]
      }
    })

    expect(decision.decision).toBe('DENY')
    expect(decision.reasons.some((reason) => reason.code === 'STALE_DATA')).toBe(true)
  })

  it('denies notional imbalance', () => {
    const decision = evaluateRisk(baseConfig, {
      state: 'READY',
      actorType: 'internal_agent',
      accountValueUsd: 10000,
      dependenciesHealthy: true,
      openPositions: [],
      ticks: {
        HYPE: {
          symbol: 'HYPE',
          px: 100,
          bid: 100,
          ask: 100,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        },
        ETH: {
          symbol: 'ETH',
          px: 2000,
          bid: 2000,
          ask: 2000,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        }
      },
      proposal: {
        proposalId: 'p3',
        cycleId: 'c1',
        summary: 'pair trade',
        confidence: 0.8,
        requestedMode: 'SIM',
        createdBy: 'agent',
        actions: [
          {
            type: 'ENTER',
            rationale: 'test',
            notionalUsd: 2000,
            expectedSlippageBps: 2,
            legs: [
              { symbol: 'HYPE', side: 'BUY', notionalUsd: 1100 },
              { symbol: 'ETH', side: 'SELL', notionalUsd: 1000 }
            ]
          }
        ]
      }
    })

    expect(decision.decision).toBe('DENY')
    expect(decision.reasons.some((reason) => reason.code === 'NOTIONAL_PARITY')).toBe(true)
  })

  it('denies SAFE_MODE proposals that increase gross notional', () => {
    const decision = evaluateRisk(baseConfig, {
      state: 'SAFE_MODE',
      actorType: 'human',
      accountValueUsd: 10000,
      dependenciesHealthy: true,
      openPositions: [
        {
          symbol: 'HYPE',
          side: 'LONG',
          qty: 10,
          notionalUsd: 1000
        },
        {
          symbol: 'ETH',
          side: 'SHORT',
          qty: 10,
          notionalUsd: 1000
        }
      ],
      ticks: {
        HYPE: {
          symbol: 'HYPE',
          px: 100,
          bid: 100,
          ask: 100,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        },
        ETH: {
          symbol: 'ETH',
          px: 2000,
          bid: 2000,
          ask: 2000,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        }
      },
      proposal: {
        proposalId: 'p4',
        cycleId: 'c1',
        summary: 'safe grow',
        confidence: 0.8,
        requestedMode: 'SIM',
        createdBy: 'agent',
        actions: [
          {
            type: 'ENTER',
            rationale: 'add risk',
            notionalUsd: 100,
            expectedSlippageBps: 2,
            legs: [
              { symbol: 'HYPE', side: 'BUY', notionalUsd: 50 },
              { symbol: 'ETH', side: 'SELL', notionalUsd: 50 }
            ]
          }
        ]
      }
    })

    expect(decision.decision).toBe('DENY')
    expect(decision.reasons.some((reason) => reason.code === 'SAFE_MODE')).toBe(true)
  })

  it('allows SAFE_MODE reduce-only proposals with reduce posture', () => {
    const decision = evaluateRisk(baseConfig, {
      state: 'SAFE_MODE',
      actorType: 'human',
      accountValueUsd: 10000,
      dependenciesHealthy: true,
      openPositions: [
        {
          symbol: 'HYPE',
          side: 'LONG',
          qty: 10,
          notionalUsd: 1000
        },
        {
          symbol: 'ETH',
          side: 'SHORT',
          qty: 10,
          notionalUsd: 1000
        }
      ],
      ticks: {
        HYPE: {
          symbol: 'HYPE',
          px: 100,
          bid: 100,
          ask: 100,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        },
        ETH: {
          symbol: 'ETH',
          px: 2000,
          bid: 2000,
          ask: 2000,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        }
      },
      proposal: {
        proposalId: 'p5',
        cycleId: 'c1',
        summary: 'safe reduce',
        confidence: 0.8,
        requestedMode: 'SIM',
        createdBy: 'agent',
        actions: [
          {
            type: 'REBALANCE',
            rationale: 'reduce risk',
            notionalUsd: 250,
            expectedSlippageBps: 2,
            legs: [
              { symbol: 'HYPE', side: 'SELL', notionalUsd: 150 },
              { symbol: 'ETH', side: 'BUY', notionalUsd: 150 },
              { symbol: 'HYPE', side: 'BUY', notionalUsd: 75 },
              { symbol: 'ETH', side: 'SELL', notionalUsd: 75 }
            ]
          }
        ]
      }
    })

    expect(decision.decision).toBe('ALLOW_REDUCE_ONLY')
    expect(decision.reasons.every((reason) => reason.code !== 'SAFE_MODE')).toBe(true)
  })

  it('denies external agents from direct execution path', () => {
    const decision = evaluateRisk(baseConfig, {
      state: 'READY',
      actorType: 'external_agent',
      accountValueUsd: 10000,
      dependenciesHealthy: true,
      openPositions: [],
      ticks: {
        HYPE: {
          symbol: 'HYPE',
          px: 100,
          bid: 100,
          ask: 100,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        },
        ETH: {
          symbol: 'ETH',
          px: 2000,
          bid: 2000,
          ask: 2000,
          bidSize: 1000,
          askSize: 1000,
          updatedAt: new Date().toISOString()
        }
      },
      proposal: {
        proposalId: 'p6',
        cycleId: 'c1',
        summary: 'external proposal',
        confidence: 0.6,
        requestedMode: 'SIM',
        createdBy: 'agent',
        actions: [
          {
            type: 'ENTER',
            rationale: 'agent proposal',
            notionalUsd: 2000,
            expectedSlippageBps: 2,
            legs: [
              { symbol: 'HYPE', side: 'BUY', notionalUsd: 1000 },
              { symbol: 'ETH', side: 'SELL', notionalUsd: 1000 }
            ]
          }
        ]
      }
    })

    expect(decision.decision).toBe('DENY')
    expect(decision.reasons.some((reason) => reason.code === 'ACTOR_NOT_ALLOWED')).toBe(true)
  })
})
