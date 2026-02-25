import { fetchCandleSnapshot, type HyperliquidCandle } from './hyperliquid'
import type { TechnicalSignalPack } from './technical-signals'

// --- Types ---

export type HourlyTrendClassification = 'UP' | 'DOWN' | 'NEUTRAL'

export interface HourlyTrend {
  symbol: string
  classification: HourlyTrendClassification
  higherHighs: number
  lowerLows: number
  computedAt: string
}

export interface BtcMacroContext {
  btcTrend4h: HourlyTrendClassification
  btcTrend1h: HourlyTrendClassification
  /** -20 to +20 modifier for alt scoring. Negative = headwind for longs. */
  altLongModifier: number
  computedAt: string
}

export interface VolumeSurge {
  symbol: string
  currentVolume: number
  avg20: number
  ratio: number
  isSurge: boolean
}

export interface OiVelocity {
  symbol: string
  currentOiUsd: number
  previousOiUsd: number | null
  deltaPct: number | null
  velocity: 'EXPANDING' | 'CONTRACTING' | 'STABLE'
}

export interface FundingRegime {
  symbol: string
  currentRate: number
  annualizedPct: number
  /** Which side this funding regime favors */
  favorsSide: 'LONG' | 'SHORT' | 'NEUTRAL'
  /** -20 to +40 score. Higher = better for proposed side. */
  score: number
}

export interface PillarScores {
  /** Market microstructure: OI velocity, volume surge, BTC macro alignment (0-100) */
  marketStructure: number
  /** Technical: hourly trend, RSI, ATR (0-100) */
  technicals: number
  /** Funding regime favorability (0-100) */
  funding: number
  /** Composite of all three (0-300) */
  composite: number
}

export interface CompositeSignalPack {
  hourlyTrends: Record<string, HourlyTrend>
  btcMacro: BtcMacroContext | null
  volumeSurges: Record<string, VolumeSurge>
  oiVelocity: Record<string, OiVelocity>
  fundingRegimes: Record<string, FundingRegime>
  pillarScores: Record<string, PillarScores>
  computedAt: string
}

// --- Hourly trend classification ---

/**
 * Classify trend from hourly closes using swing high/low analysis.
 * Identifies pivot points (local highs and lows) then counts
 * higher-highs vs lower-lows over the window.
 */
export function classifyHourlyTrend(closes: number[]): { classification: HourlyTrendClassification; higherHighs: number; lowerLows: number } {
  if (closes.length < 6) return { classification: 'NEUTRAL', higherHighs: 0, lowerLows: 0 }

  // Identify swing highs and lows (local extremes with 1-bar lookback/forward)
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

  // Count higher-highs and lower-lows
  let higherHighs = 0
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i] > swingHighs[i - 1]) higherHighs++
  }

  let lowerLows = 0
  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i] < swingLows[i - 1]) lowerLows++
  }

  const delta = higherHighs - lowerLows
  if (delta >= 2) return { classification: 'UP', higherHighs, lowerLows }
  if (delta <= -2) return { classification: 'DOWN', higherHighs, lowerLows }
  return { classification: 'NEUTRAL', higherHighs, lowerLows }
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
      startTime: now - 32 * 60 * 60_000, // 8 bars of 4h
      endTime: now
    }),
    fetchCandleSnapshot({
      postInfo: params.postInfo,
      coin: 'BTC',
      interval: '1h',
      startTime: now - 25 * 60 * 60_000, // 24 bars of 1h
      endTime: now
    })
  ])

  const closes4h = candles4h.map((c) => Number(c.c)).filter((v) => Number.isFinite(v) && v > 0)
  const closes1h = candles1h.map((c) => Number(c.c)).filter((v) => Number.isFinite(v) && v > 0)

  const btcTrend4h = classifyHourlyTrend(closes4h).classification
  const btcTrend1h = classifyHourlyTrend(closes1h).classification

  // Compute alt long modifier: negative = headwind for alt longs
  let altLongModifier = 0
  if (btcTrend4h === 'UP' && btcTrend1h === 'UP') altLongModifier = 20
  else if (btcTrend4h === 'UP' && btcTrend1h === 'NEUTRAL') altLongModifier = 10
  else if (btcTrend4h === 'DOWN' && btcTrend1h === 'DOWN') altLongModifier = -20
  else if (btcTrend4h === 'DOWN' && btcTrend1h === 'NEUTRAL') altLongModifier = -10
  else if (btcTrend4h === 'NEUTRAL' && btcTrend1h === 'UP') altLongModifier = 5
  else if (btcTrend4h === 'NEUTRAL' && btcTrend1h === 'DOWN') altLongModifier = -5

  return {
    btcTrend4h,
    btcTrend1h,
    altLongModifier,
    computedAt: new Date().toISOString()
  }
}

// --- Volume surge detection ---

export function detectVolumeSurge(candles: HyperliquidCandle[]): VolumeSurge | null {
  if (candles.length < 21) return null

  const volumes = candles.map((c) => Number(c.v)).filter(Number.isFinite)
  if (volumes.length < 21) return null

  const current = volumes[volumes.length - 1]
  const avg20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20
  if (avg20 <= 0) return null

  const ratio = current / avg20
  return {
    symbol: candles[0]?.s ?? '',
    currentVolume: current,
    avg20,
    ratio: Number(ratio.toFixed(2)),
    isSurge: ratio >= 2.0
  }
}

// --- OI velocity ---

export function computeOiVelocity(params: {
  symbol: string
  currentOiUsd: number
  previousOiUsd: number | null
}): OiVelocity {
  if (params.previousOiUsd == null || params.previousOiUsd <= 0) {
    return {
      symbol: params.symbol,
      currentOiUsd: params.currentOiUsd,
      previousOiUsd: null,
      deltaPct: null,
      velocity: 'STABLE'
    }
  }

  const deltaPct = ((params.currentOiUsd - params.previousOiUsd) / params.previousOiUsd) * 100
  let velocity: OiVelocity['velocity'] = 'STABLE'
  if (deltaPct > 5) velocity = 'EXPANDING'
  else if (deltaPct < -5) velocity = 'CONTRACTING'

  return {
    symbol: params.symbol,
    currentOiUsd: params.currentOiUsd,
    previousOiUsd: params.previousOiUsd,
    deltaPct: Number(deltaPct.toFixed(2)),
    velocity
  }
}

// --- Funding regime scoring ---

/**
 * Score funding regime from -20 to +40.
 * Neutral funding (near zero) is best for either direction.
 * Extreme funding favors the counter-side.
 */
export function scoreFundingRegime(params: {
  symbol: string
  currentFunding: number
}): FundingRegime {
  const rate = params.currentFunding
  // Annualize: 8h funding rate × 3 × 365
  const annualizedPct = rate * 3 * 365 * 100

  let favorsSide: FundingRegime['favorsSide'] = 'NEUTRAL'
  let score = 0

  const absAnn = Math.abs(annualizedPct)

  if (absAnn < 5) {
    // Neutral — good for both directions
    favorsSide = 'NEUTRAL'
    score = 40
  } else if (absAnn < 15) {
    // Mild — slight edge for counter-side
    favorsSide = annualizedPct > 0 ? 'SHORT' : 'LONG'
    score = 25
  } else if (absAnn < 50) {
    // Moderate — clear edge for counter-side
    favorsSide = annualizedPct > 0 ? 'SHORT' : 'LONG'
    score = 10
  } else {
    // Extreme — strong edge for counter-side, penalty for same-side
    favorsSide = annualizedPct > 0 ? 'SHORT' : 'LONG'
    score = -20
  }

  return {
    symbol: params.symbol,
    currentRate: rate,
    annualizedPct: Number(annualizedPct.toFixed(2)),
    favorsSide,
    score
  }
}

// --- Multi-pillar scoring ---

export function computePillarScores(params: {
  hourlyTrend: HourlyTrend | null
  technicalSignal: { rsi14: number | null; atrPct: number | null; volumeRatio: number | null } | null
  fundingRegime: FundingRegime | null
  volumeSurge: VolumeSurge | null
  oiVelocity: OiVelocity | null
  btcMacro: BtcMacroContext | null
}): PillarScores {
  // Market Structure (0-100): OI velocity (40) + volume surge (30) + BTC macro (30)
  let marketStructure = 50 // baseline
  if (params.oiVelocity) {
    if (params.oiVelocity.velocity === 'EXPANDING') marketStructure += 20
    else if (params.oiVelocity.velocity === 'CONTRACTING') marketStructure -= 15
  }
  if (params.volumeSurge) {
    if (params.volumeSurge.isSurge) marketStructure += 15
    else if (params.volumeSurge.ratio > 1.5) marketStructure += 8
    else if (params.volumeSurge.ratio < 0.5) marketStructure -= 10
  }
  if (params.btcMacro) {
    marketStructure += Math.round(params.btcMacro.altLongModifier * 0.75) // scale 75% of BTC modifier
  }
  marketStructure = clamp(marketStructure, 0, 100)

  // Technicals (0-100): hourly trend (40) + RSI positioning (30) + ATR context (30)
  let technicals = 50
  if (params.hourlyTrend) {
    if (params.hourlyTrend.classification === 'UP') technicals += 20
    else if (params.hourlyTrend.classification === 'DOWN') technicals -= 20
  }
  if (params.technicalSignal?.rsi14 != null) {
    const rsi = params.technicalSignal.rsi14
    if (rsi >= 30 && rsi <= 70) technicals += 10 // healthy range
    else if (rsi < 25 || rsi > 75) technicals -= 10 // extreme
  }
  if (params.technicalSignal?.atrPct != null) {
    const atr = params.technicalSignal.atrPct
    if (atr > 1 && atr < 5) technicals += 10 // good volatility for entries
    else if (atr > 8) technicals -= 10 // excessive volatility
  }
  technicals = clamp(technicals, 0, 100)

  // Funding (0-100): normalized from regime score (-20 to +40 → 0 to 100)
  let funding = 50
  if (params.fundingRegime) {
    // Map score range [-20, +40] to [0, 100]
    funding = Math.round(((params.fundingRegime.score + 20) / 60) * 100)
  }
  funding = clamp(funding, 0, 100)

  return {
    marketStructure,
    technicals,
    funding,
    composite: marketStructure + technicals + funding
  }
}

// --- Top-level orchestrator ---

export async function computeCompositeSignals(params: {
  symbols: string[]
  postInfo: <T>(body: unknown) => Promise<T>
  previousOiBySymbol: Record<string, number>
  technicalSignals: TechnicalSignalPack | null
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

  // 2. Fetch hourly candles for all symbols + compute volume surges
  const hourlyTrends: Record<string, HourlyTrend> = {}
  const volumeSurges: Record<string, VolumeSurge> = {}

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
      const trend = classifyHourlyTrend(closes)
      hourlyTrends[symbol] = {
        symbol,
        classification: trend.classification,
        higherHighs: trend.higherHighs,
        lowerLows: trend.lowerLows,
        computedAt: new Date().toISOString()
      }

      const surge = detectVolumeSurge(candles)
      if (surge) {
        surge.symbol = symbol
        volumeSurges[symbol] = surge
      }
    } catch {
      // skip symbol on error
    }
  })

  // Run with concurrency limit
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (idx < work.length) {
      const current = idx++
      if (current < work.length) await work[current]()
    }
  })
  await Promise.all(workers)

  // 3. OI velocity (no API calls, uses cached universe data)
  const oiVelocity: Record<string, OiVelocity> = {}
  for (const symbol of params.symbols) {
    const currentOiUsd = params.oiBySymbol[symbol] ?? 0
    if (currentOiUsd <= 0) continue
    oiVelocity[symbol] = computeOiVelocity({
      symbol,
      currentOiUsd,
      previousOiUsd: params.previousOiBySymbol[symbol] ?? null
    })
  }

  // 4. Funding regime scoring (no API calls, uses cached universe data)
  const fundingRegimes: Record<string, FundingRegime> = {}
  for (const symbol of params.symbols) {
    const funding = params.fundingBySymbol[symbol]
    if (funding == null) continue
    fundingRegimes[symbol] = scoreFundingRegime({ symbol, currentFunding: funding })
  }

  // 5. Multi-pillar scoring
  const pillarScores: Record<string, PillarScores> = {}
  for (const symbol of params.symbols) {
    const techSig = params.technicalSignals?.signals[symbol] ?? null
    pillarScores[symbol] = computePillarScores({
      hourlyTrend: hourlyTrends[symbol] ?? null,
      technicalSignal: techSig,
      fundingRegime: fundingRegimes[symbol] ?? null,
      volumeSurge: volumeSurges[symbol] ?? null,
      oiVelocity: oiVelocity[symbol] ?? null,
      btcMacro
    })
  }

  return {
    hourlyTrends,
    btcMacro,
    volumeSurges,
    oiVelocity,
    fundingRegimes,
    pillarScores,
    computedAt: new Date().toISOString()
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
