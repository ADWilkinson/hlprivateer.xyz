import { describe, expect, it } from 'vitest'
import { computePriceFeaturePack } from './price-features'

function mockFetch() {
  const base = [
    { t: 1, T: 2, s: 'HYPE', i: '1m', o: '100', c: '100', h: '100', l: '100', v: '1', n: 1 },
    { t: 2, T: 3, s: 'HYPE', i: '1m', o: '100', c: '101', h: '101', l: '100', v: '1', n: 1 },
    { t: 3, T: 4, s: 'HYPE', i: '1m', o: '101', c: '102', h: '102', l: '101', v: '1', n: 1 },
    { t: 4, T: 5, s: 'HYPE', i: '1m', o: '102', c: '103', h: '103', l: '102', v: '1', n: 1 },
    { t: 5, T: 6, s: 'HYPE', i: '1m', o: '103', c: '104', h: '104', l: '103', v: '1', n: 1 }
  ]

  const sol = base.map((candle, idx) => ({
    ...candle,
    s: 'SOL',
    o: String(50 - idx),
    c: String(50 - idx)
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = async (_url: string, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (body?.type === 'candleSnapshot') {
      const coin = body?.req?.coin
      if (coin === 'HYPE') {
        return { ok: true, json: async () => base }
      }
      if (coin === 'SOL') {
        return { ok: true, json: async () => sol }
      }
    }

    return { ok: false, status: 500, json: async () => ({}) }
  }
}

describe('price features', () => {
  it('computes returns/vol/corr vs base', async () => {
    mockFetch()
    const pack = await computePriceFeaturePack({
      infoUrl: 'https://api.hyperliquid.xyz/info',
      baseSymbol: 'HYPE',
      symbols: ['SOL'],
      windowMin: 240,
      interval: '1m',
      timeoutMs: 1000,
      concurrency: 2
    })

    expect(pack.base).not.toBeNull()
    expect(pack.bySymbol.SOL).toBeTruthy()
    expect(pack.bySymbol.SOL?.retWindowPct).toBeLessThan(0)
    expect(pack.bySymbol.SOL?.corrToBase).not.toBeNull()
  })
})

