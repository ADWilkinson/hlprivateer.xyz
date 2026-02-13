import { describe, expect, it } from 'vitest'
import funding from './funding'
import correlation from './correlation'
import volatility from './volatility'
import type { PluginContext } from '@hl/privateer-plugin-sdk'

function mockContext(): PluginContext {
  return {
    pluginId: 'test',
    eventBusPublish: async () => 'test',
    getConfig: () => undefined,
    logger: () => undefined
  }
}

function mockFetch() {
  const candles = [
    { t: 1, T: 2, s: 'HYPE', i: '1m', o: '100', c: '100', h: '100', l: '100', v: '1', n: 1 },
    { t: 2, T: 3, s: 'HYPE', i: '1m', o: '100', c: '101', h: '101', l: '100', v: '1', n: 1 },
    { t: 3, T: 4, s: 'HYPE', i: '1m', o: '101', c: '99', h: '101', l: '99', v: '1', n: 1 },
    { t: 4, T: 5, s: 'HYPE', i: '1m', o: '99', c: '100', h: '100', l: '99', v: '1', n: 1 },
    { t: 5, T: 6, s: 'HYPE', i: '1m', o: '100', c: '102', h: '102', l: '100', v: '1', n: 1 },
    { t: 6, T: 7, s: 'HYPE', i: '1m', o: '102', c: '101', h: '102', l: '101', v: '1', n: 1 },
    { t: 7, T: 8, s: 'HYPE', i: '1m', o: '101', c: '103', h: '103', l: '101', v: '1', n: 1 }
  ]

  const fundingHistory = [
    { coin: 'HYPE', fundingRate: '0.00001234', premium: '0', time: 1 },
    { coin: 'HYPE', fundingRate: '0.00002345', premium: '0', time: 2 }
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = async (_url: string, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (body?.type === 'fundingHistory') {
      return { ok: true, json: async () => fundingHistory }
    }
    if (body?.type === 'candleSnapshot') {
      // Return a "valid enough" shape; we don't need full real candles here.
      return { ok: true, json: async () => candles.map((c) => ({ ...c, s: body?.req?.coin ?? c.s })) }
    }

    return { ok: false, status: 500, json: async () => ({}) }
  }
}

describe('runtime plugins', () => {
  it('funding plugin emits funding signal', async () => {
    mockFetch()
    await funding.initialize(mockContext())
    const signals = await funding.poll()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]?.signalType).toBe('funding')
    expect(Number.isFinite(signals[0]?.value)).toBe(true)
  })

  it('correlation plugin emits correlation signal', async () => {
    mockFetch()
    await correlation.initialize(mockContext())
    const signals = await correlation.poll()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]?.signalType).toBe('correlation')
    expect(Number.isFinite(signals[0]?.value)).toBe(true)
  })

  it('volatility plugin emits volatility signal', async () => {
    mockFetch()
    await volatility.initialize(mockContext())
    const signals = await volatility.poll()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]?.signalType).toBe('volatility')
    expect(Number.isFinite(signals[0]?.value)).toBe(true)
  })
})
