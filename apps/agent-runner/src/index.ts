import { ulid } from 'ulid'
import { RedisEventBus, InMemoryEventBus } from '@hl/privateer-event-bus'
import type { EventEnvelope, AuditEvent, OperatorPosition, StrategyProposal } from '@hl/privateer-contracts'
import { parseStrategyProposal } from '@hl/privateer-contracts'
import type { PluginSignal } from '@hl/privateer-plugin-sdk'
import { env } from './config'
import { fetchMetaAndAssetCtxs, type HyperliquidUniverseAsset } from './hyperliquid'
import { computePriceFeaturePack, type PriceFeature } from './price-features'
import { createCoinGeckoClient, type CoinGeckoCategorySnapshot, type CoinGeckoMarketSnapshot } from './coingecko'
import { runClaudeStructured, runCodexStructured } from './llm'

type Tick = {
  symbol: string
  px: number
  bid: number
  ask: number
  bidSize?: number
  askSize?: number
  updatedAt: string
}

type LlmChoice = 'claude' | 'codex' | 'none'

type FloorRole =
  | 'scout'
  | 'research'
  | 'strategist'
  | 'execution'
  | 'risk'
  | 'scribe'
  | 'ops'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(items.length, concurrency))
  const results: R[] = new Array(items.length)
  let index = 0

  const workers = new Array(limit).fill(0).map(async () => {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) {
        break
      }
      results[current] = await fn(items[current] as T)
    }
  })

  await Promise.all(workers)
  return results
}

function sanitizeLine(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function safeDateMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function roleActorId(role: FloorRole): string {
  return `${env.AGENT_ID}:${role}`
}

function llmForRole(role: FloorRole): LlmChoice {
  const base = env.AGENT_LLM
  if (role === 'research') {
    return env.AGENT_RESEARCH_LLM ?? base
  }
  if (role === 'risk') {
    return env.AGENT_RISK_LLM ?? base
  }
  if (role === 'strategist' || role === 'execution') {
    return env.AGENT_STRATEGIST_LLM ?? base
  }
  if (role === 'scribe') {
    return env.AGENT_SCRIBE_LLM ?? base
  }
  return base
}

function computeTargetNotional(baseTargetNotional: number, signals: PluginSignal[]): number {
  const latestVolatility = [...signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestFunding = [...signals].reverse().find((signal) => signal.signalType === 'funding')

  let scale = 1
  if (latestVolatility) {
    const volatilityScale = 1 - Math.min(0.4, Math.abs(latestVolatility.value) / 25)
    scale *= Math.max(0.6, volatilityScale)
  }

  if (latestFunding) {
    scale *= latestFunding.value > 0 ? 0.95 : 1.05
  }

  return Number(Math.max(100, baseTargetNotional * scale).toFixed(2))
}

function bucketNotional(notionalUsd: number): 'XS' | 'S' | 'M' | 'L' | 'XL' {
  const n = Math.abs(notionalUsd)
  if (n < 50) return 'XS'
  if (n < 250) return 'S'
  if (n < 1000) return 'M'
  if (n < 5000) return 'L'
  return 'XL'
}

function renderLegSummary(legs: Array<{ symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number }>): string {
  return legs
    .map((leg) => `${leg.side} ${leg.symbol} [${bucketNotional(leg.notionalUsd)}]`)
    .join(' | ')
}

function computeExecutionTactics(params: { signals: PluginSignal[] }): { expectedSlippageBps: number; maxSlippageBps: number } {
  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const volPct = latestVolatility ? Math.abs(latestVolatility.value) : 0

  // Heuristic: scale expected slippage with volatility; cap at 12 bps expected.
  const expected = clamp(Math.round(2 + volPct * 0.25), 2, 12)
  // Keep max within risk default (20 bps).
  const max = clamp(Math.round(expected * 2), expected, 20)

  return { expectedSlippageBps: expected, maxSlippageBps: max }
}

const BASE_LONG_SYMBOL = 'HYPE'

const coinGeckoApiKey = env.COINGECKO_API_KEY?.trim()
const coinGecko = coinGeckoApiKey
  ? createCoinGeckoClient({
    apiKey: coinGeckoApiKey,
    baseUrl: env.COINGECKO_BASE_URL,
    timeoutMs: env.COINGECKO_TIMEOUT_MS
  })
  : null

type BasketCandidate = {
  symbol: string
  maxLeverage: number
  dayNtlVlmUsd: number
  openInterest: number
  openInterestUsd: number
  funding: number
  premium: number
  markPx: number
}

type BasketSelection = {
  basketSymbols: string[]
  rationale: string
  selectedAt: string
  context?: {
    featureWindowMin: number
    priceBase: PriceFeature | null
    priceBySymbol: Record<string, PriceFeature>
    coingecko?: {
      marketsBySymbol: Record<string, CoinGeckoMarketSnapshot>
      coinCategoriesBySymbol: Record<string, string[]>
      sectorTopLosers: Array<{ name: string; marketCapChange24hPct: number | null }>
      sectorTopGainers: Array<{ name: string; marketCapChange24hPct: number | null }>
      coveragePct: number
    }
  }
}

function defaultBasketFromEnv(): string[] {
  return env.BASKET_SYMBOLS
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== BASE_LONG_SYMBOL)
}

let activeBasket: BasketSelection = {
  basketSymbols: defaultBasketFromEnv(),
  rationale: 'seeded from env',
  selectedAt: new Date(0).toISOString()
}
let basketSelectInFlight = false
let cachedUniverse: { assets: HyperliquidUniverseAsset[]; fetchedAtMs: number } = { assets: [], fetchedAtMs: 0 }

async function fetchUniverseAssetsCached(nowMs: number): Promise<HyperliquidUniverseAsset[]> {
  // Keep a short cache to avoid hammering the info endpoint.
  if (cachedUniverse.assets.length > 0 && nowMs - cachedUniverse.fetchedAtMs < 60_000) {
    return cachedUniverse.assets
  }

  const assets = await fetchMetaAndAssetCtxs(env.HL_INFO_URL)
  cachedUniverse = { assets, fetchedAtMs: nowMs }
  return assets
}

function buildBasketCandidates(params: {
  assets: HyperliquidUniverseAsset[]
  perLegShortNotionalUsd: number
  basketSize: number
}): BasketCandidate[] {
  const all = params.assets
    .filter((asset) => asset.symbol && !asset.isDelisted)
    .filter((asset) => asset.symbol.toUpperCase() !== BASE_LONG_SYMBOL)
    .map((asset) => ({
      symbol: asset.symbol,
      maxLeverage: asset.maxLeverage,
      dayNtlVlmUsd: asset.dayNtlVlmUsd,
      openInterest: asset.openInterest,
      openInterestUsd: asset.openInterest > 0 && asset.markPx > 0 ? asset.openInterest * asset.markPx : 0,
      funding: asset.funding,
      premium: asset.premium,
      markPx: asset.markPx
    }))
    .filter((asset) => Number.isFinite(asset.dayNtlVlmUsd) && asset.dayNtlVlmUsd > 0)
    .sort((a, b) => b.dayNtlVlmUsd - a.dayNtlVlmUsd)

  const minDayNtlVlmUsd = Math.max(0, params.perLegShortNotionalUsd) * 100
  const filtered = minDayNtlVlmUsd > 0 ? all.filter((asset) => asset.dayNtlVlmUsd >= minDayNtlVlmUsd) : all

  // If we filter too aggressively for the configured size, fall back to the raw top-of-book list.
  const pool = filtered.length >= params.basketSize ? filtered : all
  return pool.slice(0, env.AGENT_BASKET_CANDIDATE_LIMIT)
}

function deterministicBasketFallback(candidates: BasketCandidate[], size: number): string[] {
  return candidates
    .filter((candidate) => candidate.symbol.toUpperCase() !== BASE_LONG_SYMBOL)
    .slice(0, Math.max(1, size))
    .map((candidate) => candidate.symbol)
}

async function generateBasketSelection(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ basketSymbols: string[]; rationale: string }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      basketSymbols: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
      rationale: { type: 'string' }
    },
    required: ['basketSymbols', 'rationale']
  } as const

  if (params.llm === 'none') {
    return {
      basketSymbols: [],
      rationale: 'llm disabled'
    }
  }

  const prompt = [
    'You are HL Privateer basket-selector.',
    'Pick the short basket symbols to trade against HYPE for a market-neutral relative value trade.',
    'Constraints:',
    '- Choose ONLY from the provided candidate symbols.',
    '- Do NOT include HYPE.',
    '- Prefer high liquidity (day notional volume, open interest).',
    '- Prefer shorts with positive funding (we earn it), all else equal.',
    '- Prefer shorts that have underperformed HYPE over the feature window (hist.relRetWindowPct < 0).',
    '- Prefer candidates that stay correlated to HYPE (hist.corrToBase high) to keep the hedge stable.',
    '- Use CoinGecko spot metrics when available (cg.change24hPct/cg.change7dPct, cg.marketCapUsd, cg.volume24hUsd).',
    '- Keep it diversified; avoid selecting extremely illiquid long-tail.',
    'Return only JSON that matches the provided schema.',
    '',
    `CONTEXT_JSON=${JSON.stringify(params.input)}`
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ basketSymbols: string[]; rationale: string }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  return {
    basketSymbols: Array.isArray(raw.basketSymbols) ? raw.basketSymbols.map((s) => String(s)).slice(0, 12) : [],
    rationale: String(raw.rationale ?? '').slice(0, 600)
  }
}

function validateBasketSelection(params: { requested: string[]; allowed: BasketCandidate[]; size: number }): string[] {
  const allowedByUpper = new Map<string, string>()
  for (const candidate of params.allowed) {
    allowedByUpper.set(candidate.symbol.toUpperCase(), candidate.symbol)
  }

  const picked: string[] = []
  for (const raw of params.requested) {
    const upper = String(raw).trim().toUpperCase()
    if (!upper || upper === BASE_LONG_SYMBOL) {
      continue
    }
    const canonical = allowedByUpper.get(upper)
    if (!canonical) {
      continue
    }
    if (picked.some((sym) => sym.toUpperCase() === canonical.toUpperCase())) {
      continue
    }
    picked.push(canonical)
    if (picked.length >= params.size) {
      break
    }
  }

  return picked
}

async function maybeSelectBasket(params: { targetNotionalUsd: number; signals: PluginSignal[]; positions: OperatorPosition[] }): Promise<void> {
  const nowMs = Date.now()
  if (basketSelectInFlight) {
    return
  }
  if (params.positions.length > 0) {
    return
  }

  const needsRefresh =
    activeBasket.basketSymbols.length !== env.AGENT_BASKET_SIZE ||
    nowMs - Date.parse(activeBasket.selectedAt) > env.AGENT_BASKET_REFRESH_MS
  if (!needsRefresh) {
    return
  }

  basketSelectInFlight = true
  try {
    const universe = await fetchUniverseAssetsCached(nowMs)
    const perLegShortNotionalUsd = Number((params.targetNotionalUsd / Math.max(1, env.AGENT_BASKET_SIZE)).toFixed(2))
    const candidates = buildBasketCandidates({
      assets: universe,
      perLegShortNotionalUsd,
      basketSize: env.AGENT_BASKET_SIZE
    })
    const fallback = deterministicBasketFallback(candidates, env.AGENT_BASKET_SIZE)

    const candidateSymbols = candidates.map((candidate) => candidate.symbol)
    const pricePack = await computePriceFeaturePack({
      infoUrl: env.HL_INFO_URL,
      baseSymbol: BASE_LONG_SYMBOL,
      symbols: candidateSymbols,
      windowMin: env.AGENT_FEATURE_WINDOW_MIN,
      interval: '1m',
      timeoutMs: 1500,
      concurrency: env.AGENT_FEATURE_CONCURRENCY
    })

    let cgMarketsBySymbol: Record<string, CoinGeckoMarketSnapshot> = {}
    let cgIdsBySymbol: Record<string, string> = {}
    let cgSectorTopLosers: Array<{ name: string; marketCapChange24hPct: number | null }> = []
    let cgSectorTopGainers: Array<{ name: string; marketCapChange24hPct: number | null }> = []
    let cgCoveragePct = 0

    if (coinGecko) {
      try {
        const concurrency = Math.min(env.AGENT_FEATURE_CONCURRENCY, 4)
        const resolved = await mapWithConcurrency(candidateSymbols, concurrency, async (symbol) => {
          const id = await coinGecko.getCoinIdForSymbol(symbol)
          return { symbol, id }
        })

        for (const entry of resolved) {
          if (entry?.id) {
            cgIdsBySymbol[entry.symbol] = entry.id
          }
        }

        const ids = [...new Set(Object.values(cgIdsBySymbol))]
        const markets = await coinGecko.fetchMarkets(ids)
        const marketById = new Map<string, CoinGeckoMarketSnapshot>()
        for (const market of markets) {
          marketById.set(market.id, market)
        }

        for (const [symbol, id] of Object.entries(cgIdsBySymbol)) {
          const market = marketById.get(id)
          if (market) {
            cgMarketsBySymbol[symbol] = market
          }
        }

        cgCoveragePct = candidateSymbols.length > 0 ? (Object.keys(cgMarketsBySymbol).length / candidateSymbols.length) * 100 : 0

        try {
          const categories = await coinGecko.fetchCategories()
          const withChange = categories.filter(
            (category) => typeof category.marketCapChange24hPct === 'number' && Number.isFinite(category.marketCapChange24hPct)
          )
          withChange.sort((a, b) => (a.marketCapChange24hPct ?? 0) - (b.marketCapChange24hPct ?? 0))
          cgSectorTopLosers = withChange
            .slice(0, 5)
            .map((category) => ({ name: category.name, marketCapChange24hPct: category.marketCapChange24hPct }))
          cgSectorTopGainers = withChange
            .slice(Math.max(0, withChange.length - 5))
            .reverse()
            .map((category) => ({ name: category.name, marketCapChange24hPct: category.marketCapChange24hPct }))
        } catch {
          // optional
        }
      } catch {
        cgMarketsBySymbol = {}
        cgIdsBySymbol = {}
        cgCoveragePct = 0
      }
    }

    const candidatesForLlm = candidates.map((candidate) => ({
      ...candidate,
      hist: pricePack.bySymbol[candidate.symbol] ?? null,
      cg: cgMarketsBySymbol[candidate.symbol] ?? null
    }))

    const input = {
      ts: new Date().toISOString(),
      mode: lastMode,
      basketSize: env.AGENT_BASKET_SIZE,
      targetNotionalUsd: params.targetNotionalUsd,
      perLegShortNotionalUsd,
      candidateFilter: {
        // Pre-filter candidates by daily notional volume as a rough proxy for tradability at size.
        minDayNtlVlmUsd: Number((Math.max(0, perLegShortNotionalUsd) * 100).toFixed(2))
      },
      featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
      priceBase: pricePack.base,
      coingecko: coinGecko
        ? {
          enabled: true,
          coveragePct: Number(cgCoveragePct.toFixed(1)),
          sectorTopLosers: cgSectorTopLosers,
          sectorTopGainers: cgSectorTopGainers
        }
        : { enabled: false },
      candidates: candidatesForLlm,
      signals: {
        // Provide the latest global signals as hints (these are primarily about HYPE, but still useful context).
        volatility: [...params.signals].reverse().find((s) => s.signalType === 'volatility')?.value ?? null,
        correlation: [...params.signals].reverse().find((s) => s.signalType === 'correlation')?.value ?? null,
        funding: [...params.signals].reverse().find((s) => s.signalType === 'funding')?.value ?? null
      }
    }

    const llm = llmForRole('strategist')
    const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

    let chosen: { basketSymbols: string[]; rationale: string }
    try {
      chosen = await generateBasketSelection({ llm, model, input })
    } catch (primaryError) {
      if (llm === 'codex') {
        try {
          chosen = await generateBasketSelection({ llm: 'claude', model: env.CLAUDE_MODEL, input })
          await publishTape({
            correlationId: ulid(),
            role: 'ops',
            level: 'WARN',
            line: `basket codex failed; using claude ${env.CLAUDE_MODEL}: ${String(primaryError).slice(0, 120)}`
          })
        } catch (fallbackError) {
          chosen = { basketSymbols: fallback, rationale: `deterministic fallback: ${String(fallbackError).slice(0, 120)}` }
        }
      } else {
        chosen = { basketSymbols: fallback, rationale: `deterministic fallback: ${String(primaryError).slice(0, 120)}` }
      }
    }

    const validated = validateBasketSelection({ requested: chosen.basketSymbols, allowed: candidates, size: env.AGENT_BASKET_SIZE })
    const finalBasket = validated.length === env.AGENT_BASKET_SIZE ? validated : fallback

    const priceBySymbol: Record<string, PriceFeature> = {}
    for (const symbol of finalBasket) {
      const feature = pricePack.bySymbol[symbol]
      if (feature) {
        priceBySymbol[symbol] = feature
      }
    }

    const cgMarketsSelected: Record<string, CoinGeckoMarketSnapshot> = {}
    for (const symbol of finalBasket) {
      const market = cgMarketsBySymbol[symbol]
      if (market) {
        cgMarketsSelected[symbol] = market
      }
    }

    const cgCoinCategoriesBySymbol: Record<string, string[]> = {}
    if (coinGecko) {
      const tasks = finalBasket
        .map((symbol) => ({ symbol, id: cgIdsBySymbol[symbol] }))
        .filter((task): task is { symbol: string; id: string } => Boolean(task.id))

      const rows = await mapWithConcurrency(tasks, Math.min(tasks.length, 3), async (task) => ({
        symbol: task.symbol,
        categories: await coinGecko.fetchCoinCategories(task.id)
      }))

      for (const row of rows) {
        if (row.categories.length > 0) {
          cgCoinCategoriesBySymbol[row.symbol] = row.categories
        }
      }
    }

    activeBasket = {
      basketSymbols: finalBasket,
      rationale: chosen.rationale || 'selected',
      selectedAt: new Date().toISOString(),
      context: {
        featureWindowMin: env.AGENT_FEATURE_WINDOW_MIN,
        priceBase: pricePack.base,
        priceBySymbol,
        coingecko: coinGecko
          ? {
            marketsBySymbol: cgMarketsSelected,
            coinCategoriesBySymbol: cgCoinCategoriesBySymbol,
            sectorTopLosers: cgSectorTopLosers,
            sectorTopGainers: cgSectorTopGainers,
            coveragePct: Number(cgCoveragePct.toFixed(1))
          }
          : undefined
      }
    }

    void maybePublishWatchlist({ symbols: [BASE_LONG_SYMBOL, ...activeBasket.basketSymbols], reason: 'basket selected' }).catch(() => undefined)

    await publishTape({
      correlationId: ulid(),
      role: 'strategist',
      line: `basket selected: ${activeBasket.basketSymbols.join(',')} (size=${activeBasket.basketSymbols.length})`
    })

    await publishAudit({
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: roleActorId('strategist'),
      action: 'basket.selected',
      resource: 'agent.basket',
      correlationId: ulid(),
      details: {
        basketSymbols: activeBasket.basketSymbols,
        rationale: activeBasket.rationale,
        targetNotionalUsd: params.targetNotionalUsd,
        candidateCount: candidates.length,
        context: activeBasket.context
      }
    })
  } catch (error) {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'WARN',
      line: `basket selection failed: ${String(error).slice(0, 140)}`
    })
  } finally {
    basketSelectInFlight = false
  }
}

function buildDeltaProposal(params: {
  createdBy: string
  basketSymbolsCsv: string
  targetNotionalUsd: number
  positions: OperatorPosition[]
  signals: PluginSignal[]
  requestedMode: 'SIM' | 'LIVE'
  executionTactics: { expectedSlippageBps: number; maxSlippageBps: number }
}): StrategyProposal | null {
  const basketSymbols = params.basketSymbolsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (basketSymbols.length === 0) {
    return null
  }

  const desiredBySymbol = new Map<string, number>()
  desiredBySymbol.set(BASE_LONG_SYMBOL, params.targetNotionalUsd)
  const perBasket = params.targetNotionalUsd / basketSymbols.length
  for (const symbol of basketSymbols) {
    desiredBySymbol.set(symbol, -perBasket)
  }

  const currentBySymbol = new Map<string, number>()
  for (const position of params.positions) {
    const signed = position.side === 'LONG' ? Math.abs(position.notionalUsd) : -Math.abs(position.notionalUsd)
    currentBySymbol.set(position.symbol, (currentBySymbol.get(position.symbol) ?? 0) + signed)
  }

  const minLegUsd = Math.max(25, params.targetNotionalUsd * 0.01)
  const legs = [...desiredBySymbol.entries()]
    .map(([symbol, desiredNotional]) => {
      const current = currentBySymbol.get(symbol) ?? 0
      const delta = desiredNotional - current
      if (!Number.isFinite(delta) || Math.abs(delta) < minLegUsd) {
        return null
      }

      return {
        symbol,
        side: delta > 0 ? ('BUY' as const) : ('SELL' as const),
        notionalUsd: Number(Math.abs(delta).toFixed(2))
      }
    })
    .filter((leg): leg is { symbol: string; side: 'BUY' | 'SELL'; notionalUsd: number } => Boolean(leg))

  if (legs.length === 0) {
    return null
  }

  const latestVolatility = [...params.signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestCorrelation = [...params.signals].reverse().find((signal) => signal.signalType === 'correlation')
  const latestFunding = [...params.signals].reverse().find((signal) => signal.signalType === 'funding')
  const signalSummary = [
    latestVolatility ? `vol=${latestVolatility.value.toFixed(3)}` : 'vol=na',
    latestCorrelation ? `corr=${latestCorrelation.value.toFixed(3)}` : 'corr=na',
    latestFunding ? `funding=${latestFunding.value.toFixed(6)}` : 'funding=na'
  ].join(' ')

  const actionNotionalUsd = legs.reduce((sum, leg) => sum + leg.notionalUsd, 0)
  const proposalId = ulid()
  return {
    proposalId,
    cycleId: ulid(),
    summary: `agent delta-to-target (${signalSummary})`,
    confidence: 0.65,
    requestedMode: params.requestedMode,
    createdBy: params.createdBy,
    actions: [
      {
        type: params.positions.length > 0 ? 'REBALANCE' : 'ENTER',
        rationale: 'agent-driven rebalance to target exposure (HYPE vs basket)',
        notionalUsd: Number(actionNotionalUsd.toFixed(2)),
        expectedSlippageBps: params.executionTactics.expectedSlippageBps,
        maxSlippageBps: params.executionTactics.maxSlippageBps,
        legs
      }
    ]
  }
}

async function generateAnalysis(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; thesis: string; risks: string[]; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      thesis: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      confidence: { type: 'number' }
    },
    required: ['headline', 'thesis', 'risks', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Delta-to-target rebalance',
      thesis: 'Maintain market-neutral HYPE vs basket exposure by rebalancing notionals to the target.',
      risks: ['Funding regime shift', 'Liquidity slippage during volatility', 'Model-free signal blindness'],
      confidence: 0.4
    }
  }

  const prompt = [
    'You are HL Privateer, a concise trading-floor analyst for a HYPE-vs-basket market-neutral strategy.',
    'Given the JSON context below, write a short analysis for the next rebalance.',
    'Return only JSON that matches the provided schema.',
    '',
    `CONTEXT_JSON=${JSON.stringify(params.input)}`
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; thesis: string; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const confidence = clamp(Number(raw.confidence), 0, 1)
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'HL Privateer Analysis',
    thesis: String(raw.thesis ?? '').slice(0, 1200),
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence
  }
}

async function generateResearchReport(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; regime: string; recommendation: string; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      regime: { type: 'string' },
      recommendation: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['headline', 'regime', 'recommendation', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Research pulse',
      regime: 'range / mean-reversion bias',
      recommendation: 'keep basket stable; watch correlation + funding for regime shifts',
      confidence: 0.35
    }
  }

  const prompt = [
    'You are HL Privateer research-agent.',
    'Given the JSON context below, classify the regime and suggest one actionable note for the strategist.',
    'Do not output position sizes. Keep it short and concrete.',
    'Return only JSON that matches the provided schema.',
    '',
    `CONTEXT_JSON=${JSON.stringify(params.input)}`
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; regime: string; recommendation: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; regime: string; recommendation: string; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'Research pulse',
    regime: String(raw.regime ?? '').slice(0, 160) || 'unknown',
    recommendation: String(raw.recommendation ?? '').slice(0, 240),
    confidence: clamp(Number(raw.confidence), 0, 1)
  }
}

async function generateRiskReport(params: {
  llm: LlmChoice
  model: string
  input: Record<string, unknown>
}): Promise<{ headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      posture: { type: 'string', enum: ['GREEN', 'AMBER', 'RED'] },
      risks: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      confidence: { type: 'number' }
    },
    required: ['headline', 'posture', 'risks', 'confidence']
  } as const

  if (params.llm === 'none') {
    return {
      headline: 'Risk posture',
      posture: 'GREEN',
      risks: ['Volatility spike', 'Liquidity gaps', 'Correlation break'],
      confidence: 0.35
    }
  }

  const prompt = [
    'You are HL Privateer risk-agent.',
    'Given the JSON context below, summarize risk posture for a HYPE vs basket strategy.',
    'Do not output position sizes. Use posture GREEN/AMBER/RED and list concrete risks.',
    'Return only JSON that matches the provided schema.',
    '',
    `CONTEXT_JSON=${JSON.stringify(params.input)}`
  ].join('\n')

  const raw =
    params.llm === 'claude'
      ? await runClaudeStructured<{ headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model
      })
      : await runCodexStructured<{ headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }>({
        prompt,
        jsonSchema: schema as unknown as Record<string, unknown>,
        model: params.model,
        reasoningEffort: env.CODEX_REASONING_EFFORT
      })

  const posture = raw.posture === 'GREEN' || raw.posture === 'AMBER' || raw.posture === 'RED' ? raw.posture : 'AMBER'
  return {
    headline: String(raw.headline ?? '').slice(0, 120) || 'Risk posture',
    posture,
    risks: Array.isArray(raw.risks) ? raw.risks.map((r) => String(r).slice(0, 240)).slice(0, 6) : [],
    confidence: clamp(Number(raw.confidence), 0, 1)
  }
}

const bus = env.REDIS_URL
  ? new RedisEventBus(env.REDIS_URL, env.REDIS_STREAM_PREFIX, 'agent-runner')
  : new InMemoryEventBus()

const latestTicks = new Map<string, Tick>()
const latestSignals = new Map<string, PluginSignal>()
let lastPositions: OperatorPosition[] = []
let lastMode: string = 'INIT'
let lastProposalAt = 0
let lastAnalysisAt = 0
let lastResearchAt = 0
let lastRiskAt = 0
let lastOpsAt = 0
let lastProposal: StrategyProposal | null = null
let lastRiskDecision: { decision?: string; computedAt?: string } | null = null

async function publishAudit(event: AuditEvent): Promise<void> {
  await bus.publish('hlp.audit.events', {
    type: 'AGENT_ANALYSIS',
    stream: 'hlp.audit.events',
    source: 'agent-runner',
    correlationId: event.correlationId,
    actorType: event.actorType,
    actorId: event.actorId,
    payload: event
  })
}

async function publishProposal(params: { actorId: string; proposal: StrategyProposal }): Promise<void> {
  await bus.publish('hlp.strategy.proposals', {
    type: 'STRATEGY_PROPOSAL',
    stream: 'hlp.strategy.proposals',
    source: 'agent-runner',
    correlationId: params.proposal.proposalId,
    actorType: 'internal_agent',
    actorId: params.actorId,
    payload: params.proposal
  })
}

async function publishTape(params: { correlationId: string; role: string; line: string; level?: 'INFO' | 'WARN' | 'ERROR' }): Promise<void> {
  const line = sanitizeLine(params.line, 240)
  if (!line) {
    return
  }

  await bus.publish('hlp.ui.events', {
    type: 'FLOOR_TAPE',
    stream: 'hlp.ui.events',
    source: 'agent-runner',
    correlationId: params.correlationId,
    actorType: 'internal_agent',
    actorId: env.AGENT_ID,
    payload: {
      ts: new Date().toISOString(),
      role: sanitizeLine(params.role, 32),
      level: params.level ?? 'INFO',
      line
    }
  })
}

let lastWatchlistKey = ''
let lastWatchlistPublishedAtMs = 0

function normalizeSymbolList(symbols: string[]): string[] {
  return symbols
    .map((symbol) => String(symbol).trim())
    .filter(Boolean)
}

function watchlistKey(symbols: string[]): string {
  return normalizeSymbolList(symbols)
    .map((symbol) => symbol.toUpperCase())
    .join(',')
}

async function maybePublishWatchlist(params: { symbols: string[]; reason: string }): Promise<void> {
  const normalized = normalizeSymbolList(params.symbols)
  if (normalized.length === 0) {
    return
  }

  const nowMs = Date.now()
  const key = watchlistKey(normalized)
  const changed = key !== lastWatchlistKey
  const stale = nowMs - lastWatchlistPublishedAtMs > 30_000
  if (!changed && !stale) {
    return
  }

  lastWatchlistKey = key
  lastWatchlistPublishedAtMs = nowMs
  await bus.publish('hlp.market.watchlist', {
    type: 'MARKET_WATCHLIST',
    stream: 'hlp.market.watchlist',
    source: 'agent-runner',
    correlationId: ulid(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    payload: {
      ts: new Date().toISOString(),
      symbols: normalized,
      reason: sanitizeLine(params.reason, 120)
    }
  })
}

async function publishAgentCommand(params: {
  command: '/halt'
  reason: string
}): Promise<void> {
  await bus.publish('hlp.commands', {
    type: 'agent.command',
    stream: 'hlp.commands',
    source: 'agent-runner',
    correlationId: ulid(),
    actorType: 'internal_agent',
    actorId: roleActorId('ops'),
    payload: {
      command: params.command,
      args: [],
      reason: sanitizeLine(params.reason, 160),
      actorRole: 'operator_admin',
      capabilities: ['command.execute']
    }
  })
}

function requestedModeFromEnv(): 'SIM' | 'LIVE' {
  if (!env.DRY_RUN && env.ENABLE_LIVE_OMS) {
    return 'LIVE'
  }
  return 'SIM'
}

function summarizePositionsForAgents(positions: OperatorPosition[]): { drift: 'IN_TOLERANCE' | 'POTENTIAL_DRIFT' | 'BREACH'; posture: 'GREEN' | 'AMBER' | 'RED' } {
  if (positions.length === 0) {
    return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
  }

  const longs = positions
    .filter((position) => position.side === 'LONG')
    .reduce((sum, position) => sum + Math.max(0, Math.abs(position.notionalUsd)), 0)
  const shorts = positions
    .filter((position) => position.side === 'SHORT')
    .reduce((sum, position) => sum + Math.max(0, Math.abs(position.notionalUsd)), 0)

  const gross = longs + shorts
  if (gross <= 0) {
    return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
  }

  const mismatch = Math.abs(longs - shorts) / (gross / 2)
  if (mismatch > 0.2) {
    return { drift: 'BREACH', posture: 'RED' }
  }
  if (mismatch > 0.05) {
    return { drift: 'POTENTIAL_DRIFT', posture: 'AMBER' }
  }
  return { drift: 'IN_TOLERANCE', posture: 'GREEN' }
}

function tickStalenessMs(symbols: string[]): { maxAgeMs: number; missing: string[] } {
  const missing: string[] = []
  let maxAgeMs = 0

  for (const symbol of symbols) {
    const tick = latestTicks.get(symbol)
    if (!tick) {
      missing.push(symbol)
      maxAgeMs = Math.max(maxAgeMs, 60_000)
      continue
    }

    const updatedAt = safeDateMs(tick.updatedAt)
    if (updatedAt === null) {
      maxAgeMs = Math.max(maxAgeMs, 60_000)
      continue
    }

    maxAgeMs = Math.max(maxAgeMs, Date.now() - updatedAt)
  }

  return { maxAgeMs, missing }
}

async function runOpsAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastOpsAt < env.AGENT_OPS_INTERVAL_MS) {
    return
  }
  lastOpsAt = now

  const universe = [BASE_LONG_SYMBOL, ...activeBasket.basketSymbols]
  const { maxAgeMs, missing } = tickStalenessMs(universe)

  const level: 'INFO' | 'WARN' | 'ERROR' = maxAgeMs > 15000 || missing.length > 0 ? 'WARN' : 'INFO'
  await publishTape({
    correlationId: ulid(),
    role: 'ops',
    level,
    line: `deck status mode=${lastMode} feedAgeMs=${Math.round(maxAgeMs)} missing=${missing.length}`
  })

  // Runtime can source ticks for dynamic basket symbols on-demand via l2Book snapshots.
  void maybePublishWatchlist({ symbols: universe, reason: 'ops heartbeat' }).catch(() => undefined)

  if (env.OPS_AUTO_HALT && lastMode !== 'HALT' && (maxAgeMs > 30000 || missing.length > 0)) {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'ERROR',
      line: 'auto-halt: market data stale'
    })
    await publishAgentCommand({ command: '/halt', reason: 'auto-halt: market data stale' })
  }
}

async function runResearchAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastResearchAt < env.AGENT_RESEARCH_INTERVAL_MS) {
    return
  }
  lastResearchAt = now

  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const latestVol = [...signals].reverse().find((signal) => signal.signalType === 'volatility')
  const latestCorr = [...signals].reverse().find((signal) => signal.signalType === 'correlation')
  const latestFunding = [...signals].reverse().find((signal) => signal.signalType === 'funding')
  const regime =
    latestVol && Math.abs(latestVol.value) > 15
      ? 'high vol'
      : latestCorr && latestCorr.value < 0.1
        ? 'correlation break risk'
        : 'stable'

  const input = {
    ts: new Date().toISOString(),
    mode: lastMode,
    basketSymbols: activeBasket.basketSymbols.join(','),
    signals: {
      vol: latestVol?.value ?? null,
      corr: latestCorr?.value ?? null,
      funding: latestFunding?.value ?? null
    },
    inferredRegime: regime
  }

  const llm = llmForRole('research')
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

  let report: { headline: string; regime: string; recommendation: string; confidence: number }
  try {
    report = await generateResearchReport({ llm, model, input })
  } catch (primaryError) {
    if (llm === 'codex') {
      try {
        report = await generateResearchReport({ llm: 'claude', model: env.CLAUDE_MODEL, input })
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `research codex failed; using claude ${env.CLAUDE_MODEL}: ${String(primaryError).slice(0, 120)}`
        })
      } catch (fallbackError) {
        report = await generateResearchReport({ llm: 'none', model, input })
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `research codex+claude failed; deterministic: ${String(fallbackError).slice(0, 120)}`
        })
      }
    } else {
      report = await generateResearchReport({ llm: 'none', model, input })
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `research llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
    }
  }

  await publishTape({
    correlationId: ulid(),
    role: 'research',
    line: `${report.headline}: regime=${report.regime}`
  })

  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('research'),
    action: 'research.report',
    resource: 'agent.research',
    correlationId: ulid(),
    details: {
      ...report,
      input
    }
  })
}

async function runRiskAgent(): Promise<void> {
  const now = Date.now()
  if (now - lastRiskAt < env.AGENT_RISK_INTERVAL_MS) {
    return
  }
  lastRiskAt = now

  const summary = summarizePositionsForAgents(lastPositions)
  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const latestVol = [...signals].reverse().find((signal) => signal.signalType === 'volatility')

  const input = {
    ts: new Date().toISOString(),
    mode: lastMode,
    drift: summary.drift,
    postureHint: summary.posture,
    vol1hPct: latestVol?.value ?? null,
    lastRiskDecision
  }

  const llm = llmForRole('risk')
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL

  let report: { headline: string; posture: 'GREEN' | 'AMBER' | 'RED'; risks: string[]; confidence: number }
  try {
    report = await generateRiskReport({ llm, model, input })
  } catch (primaryError) {
    if (llm === 'codex') {
      try {
        report = await generateRiskReport({ llm: 'claude', model: env.CLAUDE_MODEL, input })
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk codex failed; using claude ${env.CLAUDE_MODEL}: ${String(primaryError).slice(0, 120)}`
        })
      } catch (fallbackError) {
        report = await generateRiskReport({ llm: 'none', model, input })
        await publishTape({
          correlationId: ulid(),
          role: 'ops',
          level: 'WARN',
          line: `risk codex+claude failed; deterministic: ${String(fallbackError).slice(0, 120)}`
        })
      }
    } else {
      report = await generateRiskReport({ llm: 'none', model, input })
      await publishTape({
        correlationId: ulid(),
        role: 'ops',
        level: 'WARN',
        line: `risk llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
    }
  }

  await publishTape({
    correlationId: ulid(),
    role: 'risk',
    line: `${report.headline}: ${report.posture} drift=${summary.drift}`
  })

  await publishAudit({
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('risk'),
    action: 'risk.report',
    resource: 'agent.risk',
    correlationId: ulid(),
    details: {
      ...report,
      derived: summary,
      input
    }
  })
}

async function runStrategistCycle(): Promise<void> {
  const now = Date.now()
  if (now - lastProposalAt < env.AGENT_PROPOSAL_INTERVAL_MS) {
    return
  }
  lastProposalAt = now

  if (lastMode === 'HALT' || lastMode === 'SAFE_MODE') {
    await publishTape({
      correlationId: ulid(),
      role: 'ops',
      level: 'WARN',
      line: `strategy paused (mode=${lastMode})`
    })
    return
  }

  const signals = [...latestSignals.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const targetNotionalUsd = computeTargetNotional(env.BASKET_TARGET_NOTIONAL_USD, signals)
  const tactics = computeExecutionTactics({ signals })

  await maybeSelectBasket({ targetNotionalUsd, signals, positions: lastPositions })

  const proposal = buildDeltaProposal({
    createdBy: roleActorId('strategist'),
    basketSymbolsCsv: activeBasket.basketSymbols.join(','),
    targetNotionalUsd,
    positions: lastPositions,
    signals,
    requestedMode: requestedModeFromEnv(),
    executionTactics: tactics
  })
  if (!proposal) {
    await publishTape({
      correlationId: ulid(),
      role: 'scout',
      line: `no action (mode=${lastMode})`
    })
    return
  }

  const parsed = parseStrategyProposal(proposal)
  if (!parsed.ok) {
    const audit: AuditEvent = {
      id: ulid(),
      ts: new Date().toISOString(),
      actorType: 'internal_agent',
      actorId: env.AGENT_ID,
      action: 'agent.proposal.invalid',
      resource: 'agent.proposal',
      correlationId: ulid(),
      details: { errors: parsed.errors }
    }
    await publishAudit(audit)
    return
  }

  const proposalSummary = renderLegSummary(parsed.proposal.actions[0]?.legs ?? [])
  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'scout',
    line: `proposal ${parsed.proposal.actions[0]?.type ?? 'ACTION'}: ${proposalSummary ?? parsed.proposal.summary}`
  })

  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'execution',
    line: `tactics slippage=${tactics.expectedSlippageBps}bps cap=${tactics.maxSlippageBps}bps`
  })

  await publishProposal({ actorId: roleActorId('strategist'), proposal: parsed.proposal })
  await publishTape({
    correlationId: parsed.proposal.proposalId,
    role: 'strategist',
    line: `${parsed.proposal.summary} (confidence=${parsed.proposal.confidence.toFixed(2)} mode=${parsed.proposal.requestedMode})`
  })

  lastProposal = parsed.proposal

  if (now - lastAnalysisAt < env.AGENT_ANALYSIS_INTERVAL_MS) {
    return
  }
  lastAnalysisAt = now

  await runScribeAnalysis(parsed.proposal, { signals, targetNotionalUsd })
}

async function runScribeAnalysis(proposal: StrategyProposal, context: { signals: PluginSignal[]; targetNotionalUsd: number }): Promise<void> {
  const universe = new Set<string>([BASE_LONG_SYMBOL, ...activeBasket.basketSymbols])
  const tickSnapshot = [...universe].map((symbol) => latestTicks.get(symbol)).filter(Boolean)
  const analysisInput = {
    ts: new Date().toISOString(),
    mode: lastMode,
    targetNotionalUsd: context.targetNotionalUsd,
    basketSymbols: activeBasket.basketSymbols.join(','),
    basketContext: activeBasket.context ?? null,
    signals: context.signals,
    ticks: tickSnapshot,
    positions: lastPositions,
    proposal
  }

  const llm = llmForRole('scribe')
  const model = llm === 'claude' ? env.CLAUDE_MODEL : env.CODEX_MODEL
  let analysis: { headline: string; thesis: string; risks: string[]; confidence: number }
  try {
    analysis = await generateAnalysis({ llm, model, input: analysisInput })
  } catch (primaryError) {
    if (llm === 'codex') {
      try {
        analysis = await generateAnalysis({ llm: 'claude', model: env.CLAUDE_MODEL, input: analysisInput })
        await publishTape({
          correlationId: proposal.proposalId,
          role: 'ops',
          level: 'WARN',
          line: `scribe codex failed; using claude ${env.CLAUDE_MODEL}: ${String(primaryError).slice(0, 120)}`
        })
      } catch (fallbackError) {
        analysis = await generateAnalysis({ llm: 'none', model, input: analysisInput })
        await publishTape({
          correlationId: proposal.proposalId,
          role: 'ops',
          level: 'WARN',
          line: `scribe codex+claude failed; deterministic: ${String(fallbackError).slice(0, 120)}`
        })
      }
    } else {
      analysis = await generateAnalysis({ llm: 'none', model, input: analysisInput })
      await publishTape({
        correlationId: proposal.proposalId,
        role: 'ops',
        level: 'WARN',
        line: `scribe llm unavailable: ${String(primaryError).slice(0, 140)}`
      })
    }
  }

  await publishTape({
    correlationId: proposal.proposalId,
    role: 'scribe',
    line: `${analysis.headline} (confidence=${analysis.confidence.toFixed(2)})`
  })

  const audit: AuditEvent = {
    id: ulid(),
    ts: new Date().toISOString(),
    actorType: 'internal_agent',
    actorId: roleActorId('scribe'),
    action: 'analysis.report',
    resource: 'agent.analysis',
    correlationId: proposal.proposalId,
    details: {
      ...analysis,
      input: analysisInput
    }
  }
  await publishAudit(audit)
}

const start = async (): Promise<void> => {
  await bus.consume('hlp.market.normalized', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type !== 'MARKET_TICK') {
      return
    }
    const payload = envelope.payload as any
    if (!payload?.symbol) return
    const symbol = String(payload.symbol)
    const px = Number(payload.px)
    const bid = Number(payload.bid)
    const ask = Number(payload.ask)
    if (!Number.isFinite(px) || !Number.isFinite(bid) || !Number.isFinite(ask)) return

    latestTicks.set(symbol, {
      symbol,
      px,
      bid,
      ask,
      bidSize: typeof payload.bidSize === 'number' ? payload.bidSize : undefined,
      askSize: typeof payload.askSize === 'number' ? payload.askSize : undefined,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString()
    })
  })

  await bus.consume('hlp.plugin.signals', '$', (envelope: EventEnvelope<any>) => {
    const payload = envelope.payload as any
    if (!payload?.signalType || !payload?.pluginId) {
      return
    }
    const signal = payload as PluginSignal
    latestSignals.set(`${signal.signalType}:${signal.pluginId}`, signal)
  })

  await bus.consume('hlp.ui.events', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type === 'STATE_UPDATE') {
      const payload = envelope.payload as any
      if (payload?.mode) {
        lastMode = String(payload.mode)
      }
    }
    if (envelope.type === 'POSITION_UPDATE') {
      const payload = envelope.payload as any
      if (Array.isArray(payload)) {
        lastPositions = payload as OperatorPosition[]
      }
    }
  })

  await bus.consume('hlp.risk.decisions', '$', (envelope: EventEnvelope<any>) => {
    if (envelope.type !== 'risk.decision') {
      return
    }
    const payload = envelope.payload as any
    if (payload && typeof payload === 'object') {
      lastRiskDecision = {
        decision: typeof payload.decision === 'string' ? payload.decision : undefined,
        computedAt: typeof payload.computedAt === 'string' ? payload.computedAt : undefined
      }
    }
  })

  let tickRunning = false
  setInterval(() => {
    if (tickRunning) {
      return
    }

    tickRunning = true
    void Promise.resolve()
      .then(async () => {
        await runOpsAgent()
        await runResearchAgent()
        await runRiskAgent()
        await runStrategistCycle()
      })
      .catch((error) => {
        // Keep the runner alive; report via audit stream.
        void publishAudit({
          id: ulid(),
          ts: new Date().toISOString(),
          actorType: 'internal_agent',
          actorId: roleActorId('ops'),
          action: 'agent.error',
          resource: 'agent.runner',
          correlationId: ulid(),
          details: { message: String(error) }
        })
      })
      .finally(() => {
        tickRunning = false
      })
  }, 1000)

  await publishTape({ correlationId: ulid(), role: 'ops', line: `crew online requestedMode=${requestedModeFromEnv()}` })
  await publishTape({ correlationId: ulid(), role: 'scout', line: 'scout online (market + tape)' })
  await publishTape({ correlationId: ulid(), role: 'research', line: 'research online (regime + basket notes)' })
  await publishTape({ correlationId: ulid(), role: 'risk', line: 'risk online (posture + constraints)' })
  await publishTape({ correlationId: ulid(), role: 'strategist', line: 'strategist online (proposals)' })
  await publishTape({ correlationId: ulid(), role: 'execution', line: 'execution online (tactics)' })
  await publishTape({ correlationId: ulid(), role: 'scribe', line: 'scribe online (analysis)' })

  console.log(`agent-runner started agentId=${env.AGENT_ID} llm=${env.AGENT_LLM} requestedMode=${requestedModeFromEnv()}`)
}

void start().catch((error) => {
  console.error(error)
  process.exit(1)
})
