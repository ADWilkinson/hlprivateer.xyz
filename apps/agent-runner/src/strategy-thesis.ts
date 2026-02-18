import { ulid } from 'ulid'

export type ThesisHorizonClass = 'DAY' | 'SWING' | 'CORE'

export type ProposalThesis = {
  thesisId: string
  horizonClass: ThesisHorizonClass
  timeframeMin: number
  stopLossPct: number
  takeProfitPct: number
  invalidation: string
  createdAt: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function classifyThesisHorizon(rationale: string, pipelineBaseMs: number): {
  horizonClass: ThesisHorizonClass
  timeframeMin: number
} {
  const normalizedRationale = rationale.toLowerCase()
  let horizonClass: ThesisHorizonClass = 'DAY'
  let timeframeMin = Math.max(60, Math.round(pipelineBaseMs / 60_000) * 4)

  if (/\b(core|months?|position trade|investment)\b/.test(normalizedRationale)) {
    horizonClass = 'CORE'
    timeframeMin = 30 * 24 * 60
  } else if (/\b(swing|multi-day|days?|week|weeks?)\b/.test(normalizedRationale)) {
    horizonClass = 'SWING'
    timeframeMin = 7 * 24 * 60
  }

  return { horizonClass, timeframeMin }
}

export function buildProposalThesis(params: {
  rationale: string
  confidence: number
  pipelineBaseMs: number
  now?: Date
  makeThesisId?: () => string
}): ProposalThesis {
  const clampedConfidence = clamp(params.confidence, 0, 1)
  const { horizonClass, timeframeMin } = classifyThesisHorizon(params.rationale, params.pipelineBaseMs)
  const stopBase = horizonClass === 'DAY' ? 1.6 : horizonClass === 'SWING' ? 2.8 : 4.5
  const tpMult = horizonClass === 'DAY' ? 1.7 : horizonClass === 'SWING' ? 2.0 : 2.4
  const stopLossPct = Number((stopBase + (1 - clampedConfidence) * (horizonClass === 'CORE' ? 1.8 : 1.2)).toFixed(2))
  const takeProfitPct = Number((stopLossPct * tpMult).toFixed(2))
  const makeThesisId = params.makeThesisId ?? (() => `thesis_${ulid()}`)

  return {
    thesisId: makeThesisId(),
    horizonClass,
    timeframeMin,
    stopLossPct,
    takeProfitPct,
    invalidation: params.rationale.slice(0, 500),
    createdAt: (params.now ?? new Date()).toISOString()
  }
}
