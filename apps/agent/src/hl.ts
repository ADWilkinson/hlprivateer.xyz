// Minimal Hyperliquid info client. The accountant is the only consumer
// today; it reads `clearinghouseState` and TTL-caches the response itself,
// so we don't need the rate limiter / response cache / throttled transport
// machinery v2 used to ship.

const DEFAULT_INFO_URL = 'https://api.hyperliquid.xyz/info'
const DEFAULT_TESTNET_INFO_URL = 'https://api.hyperliquid-testnet.xyz/info'

export interface HlClient {
  postInfo: <T>(body: unknown) => Promise<T>
}

export interface HlClientConfig {
  isTestnet?: boolean
  infoUrl?: string
  timeoutMs?: number
}

export function createHlClient(config: HlClientConfig = {}): HlClient {
  const infoUrl =
    config.infoUrl ?? (config.isTestnet ? DEFAULT_TESTNET_INFO_URL : DEFAULT_INFO_URL)
  const timeoutMs = config.timeoutMs ?? 10_000

  async function postInfo<T>(body: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(infoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`hyperliquid info http ${res.status}`)
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  return { postInfo }
}

export interface ClearinghouseState {
  marginSummary: { accountValue: string }
  crossMarginSummary?: { accountValue: string }
  assetPositions: Array<{
    type: string
    position: {
      coin: string
      szi: string
      positionValue?: string
    }
  }>
}

export async function clearinghouseState(hl: HlClient, user: string): Promise<ClearinghouseState> {
  return hl.postInfo<ClearinghouseState>({ type: 'clearinghouseState', user })
}

export function accountValueUsd(state: ClearinghouseState): number {
  const raw = state.crossMarginSummary?.accountValue ?? state.marginSummary?.accountValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number.NaN
}
