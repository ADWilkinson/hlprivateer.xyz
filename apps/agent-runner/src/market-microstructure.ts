import { fetchCandleSnapshot, type HyperliquidCandle } from './hyperliquid'

// --- Types ---

export interface HourlyTrend {
  symbol: string
  /** Count of successive higher swing highs in 24h window */
  higherHighs: number
  /** Count of successive lower swing lows in 24h window */
  lowerLows: number
  /** Net direction: higherHighs - lowerLows. Positive = bullish structure, negative = bearish. */
  delta: number
  computedAt: string
}

export interface BtcMacroContext {
  /** BTC 4h swing structure (same fields as HourlyTrend) */
  btc4h: { higherHighs: number; lowerLows: number; delta: number }
  /** BTC 1h swing structure */
  btc1h: { higherHighs: number; lowerLows: number; delta: number }
  computedAt: string
}

export interface VolumeProfile {
  symbol: string
  currentVolume: number
  avg20: number
  /** Current volume / 20-bar average. >2 = surge, <0.5 = drying up. */
  ratio: number
}

export interface OiDelta {
  symbol: string
  currentOiUsd: number
  previousOiUsd: number | null
  /** Percent change from previous cycle. Null on first cycle. */
  deltaPct: number | null
}

export interface FundingSnapshot {
  symbol: string
  /** Raw 8h funding rate */
  currentRate: number
  /** Annualized funding rate (%) */
  annualizedPct: number
}

export interface CompositeSignalPack {
  hourlyTrends: Record<string, HourlyTrend>
  btcMacro: BtcMacroContext | null
  volumeProfiles: Record<string, VolumeProfile>
  oiDeltas: Record<string, OiDelta>
  fundingSnapshots: Record<string, FundingSnapshot>
  computedAt: string
}

// --- Swing analysis ---

/**
 * Compute swing structure from candle closes.
 * Identifies pivot highs/lows, then counts higher-highs and lower-lows.
 * Returns raw counts — interpretation is left to the agent.
 */
export function computeSwingStructure(closes: number[]): { higherHighs: number; lowerLows: number; delta: number } {
  if (closes.length < 6) return { higherHighs: 0, lowerLows: 0, delta: 0 }

  const swingHighs: number[] = []
  const swingLows: number[] = []

  for (let i = 1; i < closes.length - 1; i++) {
    if (closes[i] > closes[i - 1] && closes[i] > closes[i + 1]) {
      swingHighs.push(closes[i])
    }
    if (closes[i] < closes[i - 1] && closes[i] < closes[i + 1]) {
      swingLows.push(closes[i])
    }
  }

  let higherHighs = 0
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i] > swingHighs[i - 1]) higherHighs++
  }

  let lowerLows = 0
  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i] < swingLows[i - 1]) lowerLows++
  }

  return { higherHighs, lowerLows, delta: higherHighs - lowerLows }
}

// --- BTC macro context ---

export async function computeBtcMacroContext(params: {
  postInfo: <T>(body: unknown) => Promise<T>
}): Promise<BtcMacroContext> {
  const now = Date.now()

  const [candles4h, candles1h] = await Promise.all([
    fetchCandleSnapshot({
      postInfo: params.postInfo,
      coin: 'BTC',
      interval: '4h',
      startTime: now - 32 * 60 * 60_000,
      endTime: now
    }),
    fetchCandleSnapshot({
      postInfo: params.postInfo,
      coin: 'BTC',
      interval: '1h',
      startTime: now - 25 * 60 * 60_000,
      endTime: now
    })
  ])

  const closes4h = candles4h.map((c) => Number(c.c)).filter((v) => Number.isFinite(v) && v > 0)
  const closes1h = candles1h.map((c) => Number(c.c)).filter((v) => Number.isFinite(v) && v > 0)

  return {
    btc4h: computeSwingStructure(closes4h),
    btc1h: computeSwingStructure(closes1h),
    computedAt: new Date().toISOString()
  }
}

// --- Volume profile ---

export function computeVolumeProfile(symbol: string, candles: HyperliquidCandle[]): VolumeProfile | null {
  if (candles.length < 21) return null

  const volumes = candles.map((c) => Number(c.v)).filter(Number.isFinite)
  if (volumes.length < 21) return null

  const current = volumes[volumes.length - 1]
  const avg20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20
  if (avg20 <= 0) return null

  return {
    symbol,
    currentVolume: current,
    avg20,
    ratio: Number((current / avg20).toFixed(2))
  }
}

// --- OI delta ---

export function computeOiDelta(params: {
  symbol: string
  currentOiUsd: number
  previousOiUsd: number | null
}): OiDelta {
  const deltaPct = params.previousOiUsd != null && params.previousOiUsd > 0
    ? Number((((params.currentOiUsd - params.previousOiUsd) / params.previousOiUsd) * 100).toFixed(2))
    : null

  return {
    symbol: params.symbol,
    currentOiUsd: params.currentOiUsd,
    previousOiUsd: params.previousOiUsd,
    deltaPct
  }
}

// --- Funding snapshot ---

export function computeFundingSnapshot(params: {
  symbol: string
  currentFunding: number
}): FundingSnapshot {
  return {
    symbol: params.symbol,
    currentRate: params.currentFunding,
    annualizedPct: Number((params.currentFunding * 3 * 365 * 100).toFixed(2))
  }
}

// --- Top-level orchestrator ---

export async function computeCompositeSignals(params: {
  symbols: string[]
  postInfo: <T>(body: unknown) => Promise<T>
  previousOiBySymbol: Record<string, number>
  fundingBySymbol: Record<string, number>
  oiBySymbol: Record<string, number>
  concurrency?: number
}): Promise<CompositeSignalPack> {
  const concurrency = params.concurrency ?? 4
  const now = Date.now()

  // 1. BTC macro context (2 API calls)
  let btcMacro: BtcMacroContext | null = null
  try {
    btcMacro = await computeBtcMacroContext({ postInfo: params.postInfo })
  } catch {
    // non-critical
  }

  // 2. Fetch hourly candles for all symbols → swing structure + volume profile
  const hourlyTrends: Record<string, HourlyTrend> = {}
  const volumeProfiles: Record<string, VolumeProfile> = {}

  const work = params.symbols.map((symbol) => async () => {
    try {
      const candles = await fetchCandleSnapshot({
        postInfo: params.postInfo,
        coin: symbol,
        interval: '1h',
        startTime: now - 25 * 60 * 60_000,
        endTime: now
      })

      const closes = candles.map((c) => Number(c.c)).filter((v) => Number.isFinite(v) && v > 0)
      const swing = computeSwingStructure(closes)
      hourlyTrends[symbol] = {
        symbol,
        ...swing,
        computedAt: new Date().toISOString()
      }

      const profile = computeVolumeProfile(symbol, candles)
      if (profile) volumeProfiles[symbol] = profile
    } catch {
      // skip symbol on error
    }
  })

  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (idx < work.length) {
      const current = idx++
      if (current < work.length) await work[current]()
    }
  })
  await Promise.all(workers)

  // 3. OI deltas (no API calls)
  const oiDeltas: Record<string, OiDelta> = {}
  for (const symbol of params.symbols) {
    const currentOiUsd = params.oiBySymbol[symbol] ?? 0
    if (currentOiUsd <= 0) continue
    oiDeltas[symbol] = computeOiDelta({
      symbol,
      currentOiUsd,
      previousOiUsd: params.previousOiBySymbol[symbol] ?? null
    })
  }

  // 4. Funding snapshots (no API calls)
  const fundingSnapshots: Record<string, FundingSnapshot> = {}
  for (const symbol of params.symbols) {
    const funding = params.fundingBySymbol[symbol]
    if (funding == null) continue
    fundingSnapshots[symbol] = computeFundingSnapshot({ symbol, currentFunding: funding })
  }

  return {
    hourlyTrends,
    btcMacro,
    volumeProfiles,
    oiDeltas,
    fundingSnapshots,
    computedAt: new Date().toISOString()
  }
}
