import type {
  OutcomeMarket,
  OutcomeProposal,
  OutcomeSide,
  ProbabilityEstimate,
  RiskConfig,
  SentimentSignal,
  SentimentSource
} from '@hl/privateer-contracts'

export const DEFAULT_SOURCE_TRUST: Record<SentimentSource, number> = {
  news: 0.85,
  polymarket: 0.9,
  kalshi: 0.9,
  x: 0.45,
  farcaster: 0.5,
  reddit: 0.4,
  manual: 1
}

export interface AggregateOpts {
  halfLifeSec?: number
  sourceTrust?: Partial<Record<SentimentSource, number>>
  nowMs?: number
}

export interface AggregatedSentiment {
  polarity: number
  confidence: number
  evidenceMass: number
  basisSignalIds: string[]
}

// Decay is computed from each signal's `ts` at evaluation time, not from the
// publish-time `freshnessSec` snapshot — otherwise signals freeze at the
// freshness they had when first scored and never decay in the buffer.
export function aggregateSentiment(
  signals: readonly SentimentSignal[],
  opts: AggregateOpts = {}
): AggregatedSentiment {
  if (signals.length === 0) {
    return { polarity: 0, confidence: 0, evidenceMass: 0, basisSignalIds: [] }
  }

  const halfLife = opts.halfLifeSec ?? 1800
  const now = opts.nowMs ?? Date.now()
  const trust = { ...DEFAULT_SOURCE_TRUST, ...(opts.sourceTrust ?? {}) }

  let weightedPolaritySum = 0
  let weightSum = 0
  const weighted: Array<{ id: string; w: number }> = []

  for (const s of signals) {
    const decay = Math.pow(0.5, signalAgeSec(s, now) / halfLife)
    const w = clamp01(s.confidence) * decay * (trust[s.source] ?? 0.5)
    if (w <= 0) continue
    weightedPolaritySum += w * clamp(s.polarity, -1, 1)
    weightSum += w
    weighted.push({ id: s.id, w })
  }

  if (weightSum === 0) {
    return { polarity: 0, confidence: 0, evidenceMass: 0, basisSignalIds: [] }
  }

  const polarity = weightedPolaritySum / weightSum
  const confidence = clamp01(1 - Math.exp(-weightSum / 3))
  const basisSignalIds = weighted.sort((a, b) => b.w - a.w).map((x) => x.id)
  return { polarity, confidence, evidenceMass: weightSum, basisSignalIds }
}

export function signalAgeSec(signal: SentimentSignal, nowMs: number = Date.now()): number {
  const tsMs = Date.parse(signal.ts)
  if (Number.isNaN(tsMs)) return Math.max(0, signal.freshnessSec)
  return Math.max(0, Math.floor((nowMs - tsMs) / 1000))
}

export interface EstimateInput {
  marketYesPrice: number
  sentiment: AggregatedSentiment
  prior?: number
  evidenceWeight?: number
}

export interface EstimateOutput {
  pHat: number
  edge: number
  confidence: number
  basisSignalIds: string[]
  rationale: string
}

export function estimateProbability(input: EstimateInput): EstimateOutput {
  const prior = clamp01(input.prior ?? input.marketYesPrice)
  const w = clamp01(input.evidenceWeight ?? 0.4)
  const polarity = clamp(input.sentiment.polarity, -1, 1)
  const evidenceTarget = 0.5 + 0.5 * polarity
  const pull = w * input.sentiment.confidence * Math.tanh(input.sentiment.evidenceMass / 2)
  const pHat = clamp01(prior * (1 - pull) + evidenceTarget * pull)
  const edge = pHat - input.marketYesPrice
  const rationale =
    `prior=${prior.toFixed(3)} polarity=${polarity.toFixed(2)} ` +
    `mass=${input.sentiment.evidenceMass.toFixed(2)} pull=${pull.toFixed(3)} ` +
    `→ pHat=${pHat.toFixed(3)} edge=${(edge * 100).toFixed(2)}pp`
  return {
    pHat,
    edge,
    confidence: input.sentiment.confidence,
    basisSignalIds: input.sentiment.basisSignalIds,
    rationale
  }
}

export interface EdgeInput {
  pHat: number
  marketYesPrice: number
  side: OutcomeSide
}

export interface EdgeOutput {
  edge: number
  edgeBps: number
}

export function computeEdge({ pHat, marketYesPrice, side }: EdgeInput): EdgeOutput {
  const yesEdge = pHat - marketYesPrice
  const edge = side === 'YES' ? yesEdge : -yesEdge
  return { edge, edgeBps: Math.round(edge * 10_000) }
}

export interface KellyInput {
  pHat: number
  marketYesPrice: number
  side: OutcomeSide
  kellyCap?: number
}

// Binary Kelly: f* = (q - p) / (1 - p), where p is the buy price for the
// chosen side and q is the model probability for that side. Symmetric for NO.
export function kellyFraction({ pHat, marketYesPrice, side, kellyCap }: KellyInput): number {
  const cap = clamp01(kellyCap ?? 0.25)
  const p = clamp01(side === 'YES' ? marketYesPrice : 1 - marketYesPrice)
  const q = clamp01(side === 'YES' ? pHat : 1 - pHat)
  if (p <= 0 || p >= 1) return 0
  const f = (q - p) / (1 - p)
  if (!Number.isFinite(f) || f <= 0) return 0
  return Math.min(cap, f)
}

export interface ProposeInput {
  market: OutcomeMarket
  estimate: ProbabilityEstimate
  riskConfig: RiskConfig
  openExposureUsd: number
  ttlSec?: number
  nowIso?: string
  idFn?: () => string
}

export function proposeOrder(input: ProposeInput): OutcomeProposal | null {
  const { market, estimate, riskConfig } = input
  if (market.status !== 'trading') return null

  const side: OutcomeSide = estimate.pHat >= market.yesPrice ? 'YES' : 'NO'
  const { edgeBps, edge } = computeEdge({
    pHat: estimate.pHat,
    marketYesPrice: market.yesPrice,
    side
  })
  if (edgeBps < riskConfig.minEdgeBps) return null

  const f = kellyFraction({
    pHat: estimate.pHat,
    marketYesPrice: market.yesPrice,
    side,
    kellyCap: riskConfig.kellyCap
  })
  if (f <= 0) return null

  const remainingExposure = Math.max(0, riskConfig.maxGrossExposureUsd - input.openExposureUsd)
  const sizeUsd = Math.min(
    riskConfig.bankrollUsd * f,
    riskConfig.maxStakePerMarketUsd,
    remainingExposure
  )
  if (sizeUsd <= 0) return null

  const limitPrice = side === 'YES' ? market.yesPrice : 1 - market.yesPrice
  const ts = input.nowIso ?? new Date().toISOString()
  const expiresAt = new Date(Date.parse(ts) + (input.ttlSec ?? 300) * 1000).toISOString()

  return {
    id: (input.idFn ?? defaultId)(),
    marketId: market.id,
    side,
    limitPrice,
    sizeUsd,
    edgeBps,
    kellyFraction: f,
    expiresAt,
    estimateId: estimate.id,
    rationale:
      `edge=${(edge * 100).toFixed(2)}pp size=$${sizeUsd.toFixed(0)} ` +
      `kelly=${(f * 100).toFixed(1)}% (cap=${(riskConfig.kellyCap * 100).toFixed(0)}%)`,
    ts
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

function defaultId(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}
