import { describe, expect, it } from 'vitest'
import { createCoinGeckoClient } from './coingecko'

function mockFetch() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = async (urlRaw: string) => {
    const url = new URL(urlRaw)
    if (url.pathname.endsWith('/search')) {
      const query = url.searchParams.get('query')
      if (query === 'SOL') {
        return {
          ok: true,
          json: async () => ({
            coins: [
              { id: 'solana', name: 'Solana', symbol: 'sol', market_cap_rank: 5 },
              { id: 'some-other', name: 'Other', symbol: 'zzz', market_cap_rank: 999 }
            ]
          })
        }
      }
      return { ok: true, json: async () => ({ coins: [] }) }
    }

    if (url.pathname.endsWith('/coins/markets')) {
      const ids = url.searchParams.get('ids')
      if (ids?.includes('solana')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'solana',
              symbol: 'sol',
              name: 'Solana',
              market_cap: 123,
              total_volume: 456,
              market_cap_rank: 5,
              price_change_percentage_24h_in_currency: -1.23,
              price_change_percentage_7d_in_currency: -4.56,
              price_change_percentage_30d_in_currency: 7.89
            }
          ]
        }
      }
      return { ok: true, json: async () => [] }
    }

    if (url.pathname.endsWith('/coins/categories')) {
      return {
        ok: true,
        json: async () => [
          { id: 'layer-1', name: 'Layer 1 (L1)', market_cap_change_24h: -2.5 },
          { id: 'defi', name: 'DeFi', market_cap_change_24h: 1.25 }
        ]
      }
    }

    if (url.pathname.endsWith('/coins/solana')) {
      return {
        ok: true,
        json: async () => ({
          categories: ['Layer 1 (L1)']
        })
      }
    }

    return { ok: false, status: 404, json: async () => ({}) }
  }
}

describe('coingecko client', () => {
  it('resolves ids and fetches market snapshots', async () => {
    mockFetch()
    const client = createCoinGeckoClient({ apiKey: 'test', baseUrl: 'https://cg.test/api/v3', timeoutMs: 1000 })
    const id = await client.getCoinIdForSymbol('SOL')
    expect(id).toBe('solana')

    const markets = await client.fetchMarkets(['solana'])
    expect(markets.length).toBe(1)
    expect(markets[0]?.id).toBe('solana')
    expect(markets[0]?.marketCapUsd).toBe(123)
  })

  it('fetches categories', async () => {
    mockFetch()
    const client = createCoinGeckoClient({ apiKey: 'test', baseUrl: 'https://cg.test/api/v3', timeoutMs: 1000 })
    const categories = await client.fetchCoinCategories('solana')
    expect(categories).toEqual(['Layer 1 (L1)'])

    const sectors = await client.fetchCategories()
    expect(sectors.length).toBeGreaterThan(0)
  })
})

