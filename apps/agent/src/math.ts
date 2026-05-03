import type { OutcomeSide } from './contracts'

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

export interface EdgeInput {
  pHat: number
  marketYesPrice: number
  side: OutcomeSide
}

export function edgeBps({ pHat, marketYesPrice, side }: EdgeInput): number {
  const yes = pHat - marketYesPrice
  return Math.round((side === 'YES' ? yes : -yes) * 10_000)
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

export interface SizeClipInput {
  agentSizeUsd: number
  pHat: number
  marketYesPrice: number
  side: OutcomeSide
  bankrollUsd: number
  kellyCap: number
  maxStakePerMarketUsd: number
  remainingExposureUsd: number
}

// The agent suggests a size; the deterministic clip caps it by Kelly,
// per-market stake, and remaining gross exposure. The risk gates still
// re-validate; this is an early trim so a confident agent doesn't waste
// the per-eval mutex on an obviously over-sized proposal.
export function clipSize(input: SizeClipInput): { sizeUsd: number; kellyFraction: number } {
  const f = kellyFraction({
    pHat: input.pHat,
    marketYesPrice: input.marketYesPrice,
    side: input.side,
    kellyCap: input.kellyCap
  })
  const kellyCapUsd = input.bankrollUsd * f
  const sizeUsd = Math.max(
    0,
    Math.min(
      input.agentSizeUsd,
      kellyCapUsd,
      input.maxStakePerMarketUsd,
      Math.max(0, input.remainingExposureUsd)
    )
  )
  return { sizeUsd, kellyFraction: f }
}
