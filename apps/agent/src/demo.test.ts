import { describe, expect, it } from 'vitest'
import { createOrchestrator } from './orchestrator'
import { createDemoRuntime } from './demo'
import { RiskConfigSchema } from './contracts'

describe('demo runtime', () => {
  it('polls fixture sentiment and produces a privacy-safe local fill', async () => {
    const demo = createDemoRuntime()
    const orchestrator = createOrchestrator({
      agent: demo.agent,
      markets: demo.markets,
      router: demo.router,
      accountant: demo.accountant,
      riskConfig: RiskConfigSchema.parse({})
    })

    await orchestrator.start()
    const [item] = await demo.sources[0].poll()
    const result = await orchestrator.ingest(item)

    expect(item.marketId).toBe('demo-fed-pause-sep')
    expect(result.decision?.decision).toBe('ALLOW')
    expect(result.fill?.marketId).toBe(item.marketId)
    expect(result.proposal?.thesis).toContain('local demo')
    expect(await demo.accountant.openExposureUsd()).toBe(result.fill?.fillSizeUsd)
    expect(orchestrator.pHat(item.marketId)).not.toHaveProperty('thesis')
  })
})
