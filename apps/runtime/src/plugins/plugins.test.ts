import { describe, expect, it } from 'vitest'
import funding from './funding'
import correlation from './correlation'
import volatility from './volatility'

describe('runtime plugins', () => {
  it('funding plugin emits funding signal', async () => {
    const signals = await funding.poll()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]?.signalType).toBe('funding')
  })

  it('correlation plugin emits correlation signal', async () => {
    const signals = await correlation.poll()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]?.signalType).toBe('correlation')
  })

  it('volatility plugin emits volatility signal', async () => {
    const signals = await volatility.poll()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]?.signalType).toBe('volatility')
  })
})
