import type { StrategyProposal } from '@hl/privateer-contracts'

export type ActiveThesisState = {
  thesisId: string
  horizonClass: 'DAY' | 'SWING' | 'CORE'
  startedAtMs: number
  timeframeMin: number
  stopLossPct: number
  takeProfitPct: number
  invalidation?: string
  symbols: string[]
}

export function shouldSuppressDiscretionaryExit(params: {
  proposal: StrategyProposal
  activeThesis: ActiveThesisState | null
  pnlPct: number
  nowMs?: number
}): { suppress: boolean; reason?: string } {
  const { proposal, activeThesis } = params

  if (proposal.actions.length === 0 || proposal.actions[0]?.type !== 'EXIT') {
    return { suppress: false }
  }
  if ((proposal.exitReason ?? 'DISCRETIONARY') !== 'DISCRETIONARY') {
    return { suppress: false }
  }
  if (!activeThesis) {
    return { suppress: false }
  }

  const nowMs = params.nowMs ?? Date.now()
  const holdingMs = Math.max(0, nowMs - activeThesis.startedAtMs)
  const thesisExpired = holdingMs >= activeThesis.timeframeMin * 60_000
  const pnlPct = Number.isFinite(params.pnlPct) ? params.pnlPct : 0
  const stopHit = pnlPct <= -Math.abs(activeThesis.stopLossPct)
  const takeProfitHit = pnlPct >= Math.abs(activeThesis.takeProfitPct)

  if (thesisExpired || stopHit || takeProfitHit) {
    return { suppress: false }
  }

  return {
    suppress: true,
    reason: `thesis ${activeThesis.thesisId}/${activeThesis.horizonClass} still valid (holding=${Math.round(holdingMs / 60_000)}m pnl=${pnlPct.toFixed(2)}% stop=${activeThesis.stopLossPct}% tp=${activeThesis.takeProfitPct}% horizon=${activeThesis.timeframeMin}m)`
  }
}
