export function computeInfraAutoFlattenEligibility(params: {
  grossUsd: number
  accountValueUsd: number | null
  minGrossUsd: number
  minGrossPct: number
  minimumMeaningfulExposureUsd: number
}): {
  eligible: boolean
  grossPct: number | null
  effectiveMinGrossUsd: number
} {
  const grossUsd = Number.isFinite(params.grossUsd) ? Math.max(0, params.grossUsd) : 0
  const accountValueUsd = Number.isFinite(params.accountValueUsd) && (params.accountValueUsd ?? 0) > 0 ? (params.accountValueUsd as number) : null
  const minGrossUsd = Number.isFinite(params.minGrossUsd) ? Math.max(0, params.minGrossUsd) : 0
  const minGrossPct = Number.isFinite(params.minGrossPct) ? Math.max(0, Math.min(1, params.minGrossPct)) : 0
  const meaningfulFloorUsd = Number.isFinite(params.minimumMeaningfulExposureUsd) ? Math.max(0, params.minimumMeaningfulExposureUsd) : 0

  const effectiveMinGrossUsd = Math.max(meaningfulFloorUsd, minGrossUsd)
  const grossPct = accountValueUsd ? grossUsd / accountValueUsd : null
  const pctEligible = grossPct !== null && grossPct >= minGrossPct
  const usdEligible = grossUsd >= effectiveMinGrossUsd

  return {
    eligible: usdEligible || pctEligible,
    grossPct,
    effectiveMinGrossUsd
  }
}
