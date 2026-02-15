'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { cardClass, cardHeaderClass, pageShellClass } from './ui/ascii-style'
import { LandingAsciiDisplay } from './ui/LandingAsciiDisplay'
import { apiUrl } from '../lib/endpoints'

const PNL_SERIES_STORAGE_KEY = 'hlp-privateer:pnl-series-v1'
const ACCOUNT_SERIES_STORAGE_KEY = 'hlp-privateer:account-series-v1'
const LEVERAGE_SERIES_STORAGE_KEY = 'hlp-privateer:leverage-series-v1'
const MAX_SERIES_POINTS = 240

const KPI_ITEMS = [
  {
    label: 'Capital floor (minimum leg) ',
    value: '$100',
    tone: 'targeted',
    details: 'No proposal is emitted below this minimum execution size.',
  },
  {
    label: 'Strategy refresh cadence',
    value: '1h+',
    tone: 'steady',
    details: 'Rebalances, research, analysis and directives are hourly-or-higher by design.',
  },
  {
    label: 'Execution model',
    value: 'Discretionary',
    tone: 'adaptive',
    details: 'Agents choose long / short / pair structures and timeframe each cycle.',
  },
  {
    label: 'Risk policy',
    value: 'Hard-gated',
    tone: 'deterministic',
    details: 'Every action requires runtime risk approval before any OMS call.',
  },
]

const STRATEGY_TRAITS = [
  'Cross-asset regime assessment (macro + funding + sentiment + orderbook depth)',
  'Dynamic long/short leg architecture with pair-mean-reversion and momentum bias',
  'Discretionary thesis writing and confidence scoring before proposing each leg',
  'Independent crew reasoning: research, strategist, risk, execution, and ops telemetry',
  'Production only: no test-only fallback state, all paths validated through risk gates',
]

type PnlPoint = { ts: string; pnlPct: number }
type AccountPoint = { ts: string; accountValueUsd: number }
type LeveragePoint = { ts: string; leverage: number }

function normalizeBars(values: number[]) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values.map((value) => ((value - min) / span) * 100)
}

function formatDelta(from: number, to: number, unit: 'pct' | 'raw') {
  const delta = to - from
  const sign = delta >= 0 ? '+' : ''
  return unit === 'pct' ? `${sign}${delta.toFixed(2)}%` : `${sign}${delta.toFixed(2)}`
}

function readStoredSeries<T>(
  storageKey: string,
  pickPoint: (raw: unknown) => T | undefined,
): Array<T> {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => pickPoint(entry))
      .filter((entry): entry is T => entry !== undefined)
      .slice(-MAX_SERIES_POINTS)
  } catch {
    return []
  }
}

function writeStoredSeries<T>(storageKey: string, items: T[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items))
  } catch {
    return
  }
}

function SparkBars({ label, values, unit = 'pct' }: { label: string; values: number[]; unit?: 'pct' | 'raw' }) {
  const heights = normalizeBars(values)
  const current = values[values.length - 1]
  const start = values[0]

  return (
    <section className={`${cardClass} p-3`}>
      <div className={cardHeaderClass}>
        <span>{label}</span>
        <span className='text-hlpMuted'>{values.length} points</span>
      </div>

      <div className='mt-2 grid min-h-[190px] grid-cols-14 gap-1'>
        {values.map((value, index) => {
          const h = heights[index]
          const pct = unit === 'pct' ? `${value.toFixed(2)}%` : `${value.toFixed(2)}`

          return (
            <div key={`${label}-${index}`} className='relative flex min-h-0 min-w-0 flex-1 flex-col justify-end'>
              <div
                className='mx-auto w-full border border-hlpBorder bg-hlpSurface'
                style={{ height: `${Math.max(h, 4)}%` }}
              >
                <div className='relative h-full bg-hlpInverseBg/20'>
                  <span
                    className='absolute left-1/2 top-0 -translate-x-1/2 text-[7px] tracking-[0.2em] text-hlpMuted'
                    style={{ transform: 'translate(-50%, -16px)' }}
                  >
                    {index % 2 === 0 ? pct : ''}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className='mt-2 grid grid-cols-3 text-[9px] uppercase tracking-[0.16em] text-hlpDim'>
        <div>
          NOW
          <div className='text-[12px] text-hlpFg'>{current.toFixed(2)}</div>
        </div>
        <div>
          CHANGE
          <div className='text-[12px] text-hlpFg'>{formatDelta(start, current, unit)}</div>
        </div>
        <div>
          TREND
          <div className='text-[12px] text-hlpFg'>{current >= start ? 'UP' : 'DOWN'}</div>
        </div>
      </div>
    </section>
  )
}

export default function LandingPage() {
  const [pnlSeries, setPnlSeries] = useState<PnlPoint[]>(() =>
    readStoredSeries<PnlPoint>(PNL_SERIES_STORAGE_KEY, (raw) => {
      if (!raw || typeof raw !== 'object') return undefined
      const record = raw as Record<string, unknown>
      const ts = typeof record.ts === 'string' ? record.ts : ''
      const pnlPct = typeof record.pnlPct === 'number' ? record.pnlPct : undefined
      if (!ts || pnlPct === undefined || !Number.isFinite(pnlPct)) return undefined
      return { ts, pnlPct }
    })
  )
  const [accountSeries, setAccountSeries] = useState<AccountPoint[]>(() =>
    readStoredSeries<AccountPoint>(ACCOUNT_SERIES_STORAGE_KEY, (raw) => {
      if (!raw || typeof raw !== 'object') return undefined
      const record = raw as Record<string, unknown>
      const ts = typeof record.ts === 'string' ? record.ts : ''
      const accountValueUsd = typeof record.accountValueUsd === 'number' ? record.accountValueUsd : undefined
      if (!ts || accountValueUsd === undefined || !Number.isFinite(accountValueUsd)) return undefined
      return { ts, accountValueUsd }
    })
  )
  const [leverageSeries, setLeverageSeries] = useState<LeveragePoint[]>(() =>
    readStoredSeries<LeveragePoint>(LEVERAGE_SERIES_STORAGE_KEY, (raw) => {
      if (!raw || typeof raw !== 'object') return undefined
      const record = raw as Record<string, unknown>
      const ts = typeof record.ts === 'string' ? record.ts : ''
      const leverage = typeof record.leverage === 'number' ? record.leverage : undefined
      if (!ts || leverage === undefined || !Number.isFinite(leverage)) return undefined
      return { ts, leverage }
    })
  )

  const latestAccountValueUsd = accountSeries.length > 0 ? accountSeries[accountSeries.length - 1]?.accountValueUsd : null
  const latestPnlPct = pnlSeries.length > 0 ? pnlSeries[pnlSeries.length - 1]?.pnlPct : null
  const latestLeverage = leverageSeries.length > 0 ? leverageSeries[leverageSeries.length - 1]?.leverage : null

  useEffect(() => {
    let running = true
    const ingest = async () => {
      try {
        const response = await fetch(apiUrl('/v1/public/floor-snapshot'))
        if (!response.ok) return
        const payload = (await response.json()) as Record<string, unknown>
        const nowIso = new Date().toISOString()
        const pnlPct = typeof payload.pnlPct === 'number' && Number.isFinite(payload.pnlPct) ? payload.pnlPct : null
        const accountValueUsd =
          typeof payload.accountValueUsd === 'number' && Number.isFinite(payload.accountValueUsd) ? payload.accountValueUsd : null
        const openPositionNotionalUsd =
          typeof payload.openPositionNotionalUsd === 'number' && Number.isFinite(payload.openPositionNotionalUsd)
            ? payload.openPositionNotionalUsd
            : null

        if (!running) return

        if (pnlPct !== null) {
          setPnlSeries((current) => {
            const next = [...current, { ts: nowIso, pnlPct }].slice(-MAX_SERIES_POINTS)
            writeStoredSeries(PNL_SERIES_STORAGE_KEY, next)
            return next
          })
        }

        if (accountValueUsd !== null) {
          setAccountSeries((current) => {
            const next = [...current, { ts: nowIso, accountValueUsd }].slice(-MAX_SERIES_POINTS)
            writeStoredSeries(ACCOUNT_SERIES_STORAGE_KEY, next)
            return next
          })
        }

        if (accountValueUsd !== null && accountValueUsd > 0 && openPositionNotionalUsd !== null) {
          const leverage = openPositionNotionalUsd / accountValueUsd
          if (Number.isFinite(leverage)) {
            setLeverageSeries((current) => {
              const next = [...current, { ts: nowIso, leverage }].slice(-MAX_SERIES_POINTS)
              writeStoredSeries(LEVERAGE_SERIES_STORAGE_KEY, next)
              return next
            })
          }
        }
      } catch {
        // ignore one-shot fetch failures
      }
    }

    void ingest()
    const timer = window.setInterval(ingest, 12_000)
    return () => {
      running = false
      window.clearInterval(timer)
    }
  }, [])

  const pnlBars = useMemo(() => {
    const values = pnlSeries.map((point) => point.pnlPct)
    return values.length >= 14 ? values.slice(-14) : values.length > 0 ? values : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  }, [pnlSeries])

  const leverageBars = useMemo(() => {
    const values = leverageSeries.map((point) => point.leverage)
    return values.length >= 14 ? values.slice(-14) : values.length > 0 ? values : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  }, [leverageSeries])

  return (
    <div className={pageShellClass}>
      <section className='relative overflow-hidden border border-hlpBorder bg-hlpInverseBg px-3 py-6 sm:px-5 sm:py-8 md:flex md:items-center md:gap-6'>
        <div className='relative z-10 space-y-4 md:max-w-2xl'>
          <div className='inline-flex items-center gap-2 border border-hlpBorder bg-hlpPanel/20 px-2 py-1 text-[9px] uppercase tracking-[0.22em] text-hlpPanel/70'>
            [HL] PRIVATEER
            <span className='text-hlpPanel/35'>/ ORB / GENESIS</span>
          </div>
          <h1 className='text-[33px] leading-tight tracking-[0.03em] text-hlpPanel sm:text-[46px] md:text-[54px]'>
            Agentic floor, now fully discretionary.
          </h1>
          <p className='max-w-2xl text-sm leading-relaxed text-hlpPanel/80'>
            The strategy stack now selects long, short, and pair constructions across open universe
            candidates based on market regime, confidence, and risk posture. Every thesis is
            synthesized with multi-source signals, scored, then passed through a hard risk gate.
          </p>
          <div className='flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em]'>
            <Link
              href='/data'
              className='inline-flex items-center border border-hlpPanel bg-hlpPanel px-3 py-2 font-semibold text-hlpBg transition-colors hover:bg-hlpSurface'
            >
              Open data center
            </Link>
            <Link
              href='/integrations'
              className='inline-flex items-center border border-hlpPanel/40 bg-hlpPanel/10 px-3 py-2 transition-colors hover:bg-hlpPanel/20'
            >
              Explore integrations
            </Link>
          </div>
          <div className='grid grid-cols-1 gap-1 pt-2 text-[9px] uppercase tracking-[0.16em] text-hlpPanel/70 sm:grid-cols-2'>
            <div className='border border-hlpPanel/35 bg-hlpPanel/10 px-2 py-1'>
              Strategy mode: Discretionary long/short + pair
            </div>
            <div className='border border-hlpPanel/35 bg-hlpPanel/10 px-2 py-1'>
              Floor snapshot: pnl={latestPnlPct !== null ? `${latestPnlPct.toFixed(2)}%` : '--'} equity={latestAccountValueUsd !== null ? `$${latestAccountValueUsd.toFixed(2)}` : '--'} lev={latestLeverage !== null ? `${latestLeverage.toFixed(2)}x` : '--'}
            </div>
          </div>
        </div>

        <div className='relative mt-6 min-w-0 md:mt-0 md:flex-1'>
          <div className='absolute inset-0 bg-hlpBg opacity-40' />
          <LandingAsciiDisplay className='relative z-10 border border-hlpPanel/35 bg-hlpPanel/15 p-3' rows={20} cols={54} speedMs={90} />
        </div>
      </section>

      <section className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
        {KPI_ITEMS.map((kpi) => (
          <article className={`${cardClass} p-3`} key={kpi.label}>
            <div className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>{kpi.label}</div>
            <div className='mt-1 text-[22px] text-hlpFg'>{kpi.value}</div>
            <p className='mt-2 text-[11px] leading-relaxed text-hlpMuted'>{kpi.details}</p>
          </article>
        ))}
      </section>

      <section className='grid gap-3 md:grid-cols-2'>
        <article className={`${cardClass} p-3`}> 
          <div className={cardHeaderClass}>Strategy Doctrine</div>
          <ul className='mt-3 space-y-2 text-[11px] leading-relaxed text-hlpFg'>
            {STRATEGY_TRAITS.map((trait) => (
              <li key={trait} className='flex gap-2'>
                <span className='text-hlpPositive'>▣</span>
                <span>{trait}</span>
              </li>
            ))}
          </ul>
        </article>

        <div className='grid gap-2'>
          <SparkBars label='pnl trajectory (public snapshot stream)' values={pnlBars} unit='pct' />
          <SparkBars label='leverage utilization (gross / equity)' values={leverageBars} unit='raw' />
        </div>
      </section>
    </div>
  )
}
