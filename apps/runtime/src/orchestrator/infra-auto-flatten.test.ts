import { describe, expect, it } from 'vitest'
import { computeInfraAutoFlattenEligibility } from './infra-auto-flatten'

describe('infra auto-flatten eligibility', () => {
  it('uses meaningful exposure floor when no account value is available', () => {
    const result = computeInfraAutoFlattenEligibility({
      grossUsd: 120,
      accountValueUsd: null,
      minGrossUsd: 0,
      minGrossPct: 0.35,
      minimumMeaningfulExposureUsd: 100
    })

    expect(result.eligible).toBe(true)
    expect(result.grossPct).toBeNull()
    expect(result.effectiveMinGrossUsd).toBe(100)
  })

  it('blocks flatten when exposure is below both usd and pct gates', () => {
    const result = computeInfraAutoFlattenEligibility({
      grossUsd: 400,
      accountValueUsd: 4000,
      minGrossUsd: 500,
      minGrossPct: 0.25,
      minimumMeaningfulExposureUsd: 100
    })

    expect(result.eligible).toBe(false)
    expect(result.grossPct).toBeCloseTo(0.1, 5)
    expect(result.effectiveMinGrossUsd).toBe(500)
  })

  it('allows flatten when pct gate is breached even with higher usd threshold', () => {
    const result = computeInfraAutoFlattenEligibility({
      grossUsd: 900,
      accountValueUsd: 2000,
      minGrossUsd: 1500,
      minGrossPct: 0.35,
      minimumMeaningfulExposureUsd: 100
    })

    expect(result.eligible).toBe(true)
    expect(result.grossPct).toBeCloseTo(0.45, 5)
  })
})
