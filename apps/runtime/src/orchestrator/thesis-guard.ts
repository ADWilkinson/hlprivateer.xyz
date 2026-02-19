import type { StrategyProposal } from '@hl/privateer-contracts'

export type ActiveThesisState = {
  thesisId: string
  symbols: string[]
}

export function shouldSuppressDiscretionaryExit(_params: {
  proposal: StrategyProposal
  activeThesis: ActiveThesisState | null
  pnlPct: number
  nowMs?: number
}): { suppress: boolean; reason?: string } {
  return { suppress: false }
}
