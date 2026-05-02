import type {
  OutcomeMarket,
  OutcomeProposal,
  OutcomeSide,
  ProbabilityEstimate,
  RiskConfig,
  SentimentSignal,
  SentimentSource
} from '@hl/privateer-contracts'

// ────────────────────────────────────────────────────────────────────────────
// Source trust priors. Tuned by hand; all in [0,1]. Caller can override.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SOURCE_TRUST: Record<SentimentSource, number> = {
  news: 0.85,
  polymarket: 0.9,
  kalshi: 0.9,
  x: 0.45,
  farcaster: 0.5,
  reddit: 0.4,
  manual: 1
}

// ────────────────────────────────────────────────────────────────────────────
// Sentiment aggregation
// ────────────────────────────────────────────────────────────────────────────

export interface AggregateOpts {
  /** Half-life in seconds for freshness weighting. Default 30m. */
  halfLifeSec?: number
  /** Per-source trust override (0..1). */
  sourceTrust?: Partial<Record<SentimentSource, number>>
}

export interface AggregatedSentiment {
  /** Weighted polarity in [-1, 1]. 0 if no signals. */
  polarity: number
  /** Aggregated confidence in [0, 1]. Saturates with N signals. */
  confidence: number
  /** Sum of effective weights — used as evidence mass for the Bayesian update. */
  evidenceMass: number
  /** IDs of contributing signals, ordered by weight desc. */
  basisSignalIds: string[]
}

export function aggregateSentiment(
  signals: readonly SentimentSignal[],
  opts: AggregateOpts = {}
): AggregatedSentiment {
  if (signals.length === 0) {
    return { polarity: 0, confidence: 0, evidenceMass: 0, basisSignalIds: [] }
  }

  const halfLife = opts.halfLifeSec ?? 1800
  const trust = { ...DEFAULT_SOURCE_TRUST, ...(opts.sourceTrust ?? {}) }

  let weightedPolaritySum = 0
  let weightSum = 0
  const weighted: Array<{ id: string; w: number }> = []

  for (const s of signals) {
    const decay = Math.pow(0.5, s.freshnessSec / halfLife)
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
  // Confidence saturates at ~0.95 around 6 effective signals.
  const confidence = clamp01(1 - Math.exp(-weightSum / 3))
  const basisSignalIds = weighted.sort((a, b) => b.w - a.w).map((x) => x.id)
  return { polarity, confidence, evidenceMass: weightSum, basisSignalIds }
}

// ────────────────────────────────────────────────────────────────────────────
// Probability estimate
// Bayesian-style: take market price as prior, shift toward sentiment polarity
// proportional to evidence mass. evidenceMass=0 → no shift.
// ────────────────────────────────────────────────────────────────────────────

export interface EstimateInput {
  marketYesPrice: number
  sentiment: AggregatedSentiment
  /** Optional explicit prior in [0,1]. Default = marketYesPrice. */
  prior?: number
  /** How aggressively evidence pulls from prior. 0..1. Default 0.4. */
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
  // Evidence target in [0,1]: polarity +1 → 1, -1 → 0, 0 → prior.
  const polarity = clamp(input.sentiment.polarity, -1, 1)
  const evidenceTarget = 0.5 + 0.5 * polarity
  // Effective pull strength = w × confidence × tanh(evidenceMass / 2)
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

// ────────────────────────────────────────────────────────────────────────────
// Edge + Kelly
// ────────────────────────────────────────────────────────────────────────────

export interface EdgeInput {
  pHat: number
  marketYesPrice: number
  side: OutcomeSide
}

export interface EdgeOutput {
  edge: number       // signed, in probability units
  edgeBps: number    // in basis points (10000 = 100%)
}

export function computeEdge({ pHat, marketYesPrice, side }: EdgeInput): EdgeOutput {
  // YES at price p wins (1-p) if YES; NO at price (1-p) wins p if NO.
  const yesEdge = pHat - marketYesPrice
  const edge = side === 'YES' ? yesEdge : -yesEdge
  return { edge, edgeBps: Math.round(edge * 10_000) }
}

export interface KellyInput {
  pHat: number
  marketYesPrice: number
  side: OutcomeSide
  /** Cap on Kelly fraction in [0,1]. Default 0.25 (quarter-Kelly). */
  kellyCap?: number
}

/**
 * Binary Kelly. Bet on YES at price p costs p, pays 1; net profit per $1 staked
 * is (1-p)/p on win, -1 on loss. Optimal Kelly for win prob q at odds b:
 *   f* = (q*b - (1-q)) / b  with b = (1-p)/p  ⇒  f* = (q - p) / (1 - p)
 * Symmetric for NO with q' = 1 - pHat, p' = 1 - marketYesPrice.
 * Returns 0 when there is no positive edge.
 */
export function kellyFraction({ pHat, marketYesPrice, side, kellyCap }: KellyInput): number {
  const cap = clamp01(kellyCap ?? 0.25)
  const p = clamp01(side === 'YES' ? marketYesPrice : 1 - marketYesPrice)
  const q = clamp01(side === 'YES' ? pHat : 1 - pHat)
  if (p <= 0 || p >= 1) return 0
  const f = (q - p) / (1 - p)
  if (!Number.isFinite(f) || f <= 0) return 0
  return Math.min(cap, f)
}

// ────────────────────────────────────────────────────────────────────────────
// Proposal construction
// ────────────────────────────────────────────────────────────────────────────

export interface ProposeInput {
  market: OutcomeMarket
  estimate: ProbabilityEstimate
  riskConfig: RiskConfig
  /** Sum of currently-open exposure across all markets (USD). */
  openExposureUsd: number
  /** How long the limit order is valid for. Default 5m. */
  ttlSec?: number
  /** ISO timestamp for the proposal. Default now(). */
  nowIso?: string
  /** ID generator. Default Math.random hex. */
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
  const sizeUsd = Math.max(
    0,
    Math.min(riskConfig.bankrollUsd * f, riskConfig.maxStakePerMarketUsd, remainingExposure)
  )
  if (sizeUsd <= 0) return null

  // Limit at the market — agents are price-takers in this scaffold; the gates
  // and downstream OMS are responsible for slippage and book-walk caps.
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

// ────────────────────────────────────────────────────────────────────────────
// internal
// ────────────────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

function defaultId(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}
