'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LandingAsciiDisplay } from './ui/LandingAsciiDisplay'
import { apiUrl } from '../lib/endpoints'
import { AsciiTable } from './ui/ascii-kit'
import { normalizeOpenPositions, type OpenPosition } from './ui/floor-dashboard'

const PNL_SERIES_STORAGE_KEY = 'hlp-privateer:pnl-series-v1'
const SITE_URL = 'https://hlprivateer.xyz'
const SNAPSHOT_TIMEOUT_MS = 7000

const USD_0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const USD_2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatSignedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  const abs = USD_2.format(Math.abs(value))
  return value >= 0 ? `+${abs}` : `-${abs}`
}

function normalizePositionSide(value: unknown): 'LONG' | 'SHORT' | '--' {
  if (typeof value !== 'string') return '--'
  const next = value.trim().toUpperCase()
  if (!next) return '--'
  if (next === 'SHORT' || next === 'SELL') return 'SHORT'
  if (next === 'LONG' || next === 'BUY') return 'LONG'
  if (next.includes('SHORT')) return 'SHORT'
  if (next.includes('LONG')) return 'LONG'
  return '--'
}

function computeAnnualizedSharpeFromPnlSeries(series: Array<{ ts: string; pnlPct: number }>): number | null {
  if (!Array.isArray(series) || series.length < 10) return null
  const returns: number[] = []
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1]?.pnlPct
    const next = series[i]?.pnlPct
    if (typeof prev !== 'number' || typeof next !== 'number') continue
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue
    returns.push((next - prev) / 100)
  }
  if (returns.length < 10) return null

  const mean = returns.reduce((acc, value) => acc + value, 0) / returns.length
  const variance =
    returns.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / Math.max(1, returns.length - 1)
  const std = Math.sqrt(variance)
  if (!Number.isFinite(std) || std <= 0) return null
  const sharpe = (mean / std) * Math.sqrt(365)
  return Number.isFinite(sharpe) ? sharpe : null
}

function readPnlSeriesFromLocalStorage(): Array<{ ts: string; pnlPct: number }> {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(PNL_SERIES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const ts = (entry as { ts?: unknown }).ts
        const pnlPct = (entry as { pnlPct?: unknown }).pnlPct
        if (typeof ts !== 'string') return null
        if (typeof pnlPct !== 'number' || !Number.isFinite(pnlPct)) return null
        return { ts, pnlPct }
      })
      .filter((entry): entry is { ts: string; pnlPct: number } => entry !== null)
  } catch {
    return []
  }
}

interface FloorSnapshot {
  pnlPct: number | null
  accountValueUsd: number | null
  leverage: number | null
  realizedPnlUsd: number | null
  openPositions: OpenPosition[]
}

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'HL Privateer',
      url: SITE_URL,
      logo: `${SITE_URL}/icons/icon-512.png`,
      sameAs: ['https://clawhub.ai/ADWilkinson/hl-privateer-fund'],
    },
    {
      '@type': 'WebSite',
      name: '[HL] PRIVATEER',
      url: SITE_URL,
      description:
        'Open Hyperliquid discretionary desk with autonomous agents and live floor telemetry.',
      inLanguage: 'en-US',
    },
  ],
}

export default function LandingPage() {
  const [snap, setSnap] = useState<FloorSnapshot>({
    pnlPct: null,
    accountValueUsd: null,
    leverage: null,
    realizedPnlUsd: null,
    openPositions: [],
  })
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const [sharpeRatio, setSharpeRatio] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    let inFlight = false
    let activeRequest: AbortController | null = null

    const computeSharpe = () => {
      if (!active) return
      const series = readPnlSeriesFromLocalStorage()
      setSharpeRatio(computeAnnualizedSharpeFromPnlSeries(series))
    }

    const poll = async () => {
      if (!active || inFlight) return
      inFlight = true
      const controller = new AbortController()
      activeRequest = controller
      const timeoutId = window.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS)

      try {
        const res = await fetch(apiUrl('/v1/public/floor-snapshot'), {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok || !active) {
          computeSharpe()
          return
        }

        const d = (await res.json()) as Record<string, unknown>
        const pnlPct = toFiniteNumber(d.pnlPct ?? d.pnl_percent ?? d.pnl)
        const acct = toFiniteNumber(
          d.accountValueUsd ?? d.account_value_usd ?? d.accountEquityUsd ?? d.account_equity_usd,
        )
        const maxLev = toFiniteNumber(d.maxLeverage ?? d.max_leverage ?? d.leverage)

        const rawOpenPositions = d.openPositions ?? d.open_positions ?? d.positions
        const openPositions = normalizeOpenPositions(rawOpenPositions)
        const realizedPnl = toFiniteNumber(d.realizedPnlUsd ?? d.realized_pnl_usd)

        if (active) {
          setHasSnapshot(true)
          setSnap({ pnlPct, accountValueUsd: acct, leverage: maxLev, realizedPnlUsd: realizedPnl, openPositions })
        }
        computeSharpe()
      } catch {
        // retry next interval
        computeSharpe()
      } finally {
        window.clearTimeout(timeoutId)
        if (activeRequest === controller) {
          activeRequest = null
        }
        inFlight = false
      }
    }
    const seedTrajectory = async () => {
      if (!active) return
      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS)
        const res = await fetch(apiUrl('/v1/public/trajectory'), {
          cache: 'no-store',
          signal: controller.signal,
        })
        window.clearTimeout(timeoutId)
        if (!res.ok || !active) return
        const raw = (await res.json()) as { points?: unknown[] }
        const serverPoints = Array.isArray(raw?.points) ? raw.points : []
        const serverPnl = serverPoints
          .filter(
            (p): p is { ts: string; pnlPct: number } =>
              typeof p === 'object' &&
              p !== null &&
              typeof (p as { ts?: unknown }).ts === 'string' &&
              typeof (p as { pnlPct?: unknown }).pnlPct === 'number' &&
              Number.isFinite((p as { pnlPct: number }).pnlPct) &&
              (p as { pnlPct: number }).pnlPct !== 0,
          )
          .map((p) => ({ ts: p.ts, pnlPct: p.pnlPct }))
        if (serverPnl.length === 0) return
        const local = readPnlSeriesFromLocalStorage()
        const merged = [...serverPnl, ...local].sort((a, b) => a.ts.localeCompare(b.ts))
        const seen = new Set<string>()
        const deduped = merged.filter((p) => {
          if (seen.has(p.ts)) return false
          seen.add(p.ts)
          return true
        })
        try {
          window.localStorage.setItem(PNL_SERIES_STORAGE_KEY, JSON.stringify(deduped))
        } catch {
          // localStorage full or unavailable — Sharpe stays from local data only
        }
        computeSharpe()
      } catch {
        // trajectory seed failed — non-critical
      }
    }

    void poll()
    void seedTrajectory()
    const t = window.setInterval(poll, 12_000)
    return () => {
      active = false
      if (activeRequest) {
        activeRequest.abort()
      }
      window.clearInterval(t)
    }
  }, [])

  const pnl = snap.pnlPct !== null ? `${snap.pnlPct >= 0 ? '+' : ''}${snap.pnlPct.toFixed(2)}%` : '--'
  const equity = snap.accountValueUsd !== null ? USD_2.format(snap.accountValueUsd) : '--'
  const lev = snap.leverage !== null ? `${snap.leverage.toFixed(2)}x` : '--'
  const sharpe = sharpeRatio !== null ? sharpeRatio.toFixed(2) : '--'
  const realizedStr = formatSignedUsd(snap.realizedPnlUsd)
  const realizedColor =
    snap.realizedPnlUsd === null || snap.realizedPnlUsd === 0
      ? 'text-hlpMuted'
      : snap.realizedPnlUsd > 0
        ? 'text-hlpPositive'
        : 'text-hlpNegative'

  const openPositionCount = hasSnapshot ? snap.openPositions.length : null
  const openPositionNotionalUsd = hasSnapshot
    ? snap.openPositions.reduce((acc, position) => {
        const next = typeof position.notionalUsd === 'number' && Number.isFinite(position.notionalUsd)
          ? Math.abs(position.notionalUsd)
          : 0
        return acc + next
      }, 0)
    : null
  const openPositionNotional = openPositionNotionalUsd !== null ? USD_0.format(openPositionNotionalUsd) : '--'

  return (
    <main
      id='main-content'
      className='relative z-10 mx-auto flex min-h-[calc(100dvh-52px)] w-full max-w-[1300px] flex-col items-center justify-center gap-6 px-3 py-8'
      aria-busy={!hasSnapshot}
    >
      <h1 className='sr-only'>HL Privateer open Hyperliquid discretionary desk</h1>
      <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpPositive'>
        <span className='inline-block h-1.5 w-1.5 animate-hlp-led bg-hlpPositive' />
        LIVE
      </div>

      <div className='max-w-[600px] text-center text-[11px] leading-relaxed tracking-wide text-hlpMuted'>
        <p>Open discretionary desk on Hyperliquid.</p>
        <p>Read our analysis and follow the core fund in real time.</p>
      </div>

      <LandingAsciiDisplay className='w-full border border-hlpBorder p-2' />

      <div className='grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 text-[10px] uppercase tracking-[0.16em]'>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          PNL <span className='text-hlpFg'>{pnl}</span>
        </span>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          EQUITY <span className='text-hlpFg'>{equity}</span>
        </span>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          REALIZED <span className={realizedColor}>{realizedStr}</span>
        </span>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          LEVERAGE <span className='text-hlpFg'>{lev}</span>
        </span>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          SHARPE <span className='text-hlpFg'>{sharpe}</span>
        </span>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          OPEN <span className='text-hlpFg'>{openPositionCount === null ? '--' : openPositionCount}</span>
        </span>
        <span className='border border-hlpBorder bg-hlpSurface px-2 py-1.5'>
          NOTIONAL <span className='text-hlpFg'>{openPositionNotional}</span>
        </span>
      </div>

      <div className='w-full'>
        <AsciiTable<OpenPosition>
          caption='open positions'
          columns={[
            {
              key: 'symbol',
              header: 'SYMBOL',
              align: 'left',
              width: '32%',
              render: (value) => <span className='font-medium'>{String(value ?? '')}</span>,
            },
            {
              key: 'side',
              header: 'SIDE',
              align: 'center',
              width: '12%',
              render: (value) => {
                const side = normalizePositionSide(value)
                const tone = side === 'LONG' ? 'text-hlpPositive' : side === 'SHORT' ? 'text-hlpNegative' : 'text-hlpMuted'
                return <span className={tone}>{side}</span>
              },
            },
            {
              key: 'notionalUsd',
              header: 'NOTIONAL USD',
              align: 'right',
              width: '28%',
              render: (value) => {
                const num = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null
                return <span className='text-hlpFg'>{num === null ? '--' : USD_0.format(num)}</span>
              },
            },
            {
              key: 'pnlUsd',
              header: 'PNL',
              align: 'right',
              width: '28%',
              render: (value) => {
                const num = typeof value === 'number' && Number.isFinite(value) ? value : null
                if (num === null) return <span className='text-hlpMuted'>--</span>
                const tone = num >= 0 ? 'text-hlpPositive' : 'text-hlpNegative'
                return <span className={tone}>{formatSignedUsd(num)}</span>
              },
            },
          ]}
          data={snap.openPositions}
          emptyText={hasSnapshot ? 'no open positions' : 'loading...'}
        />
      </div>

      <div className='flex flex-wrap items-center justify-center gap-2'>
        <Link
          href='/floor'
          className='border border-hlpBorder bg-hlpInverseBg px-5 py-2.5 text-[9px] uppercase tracking-[0.22em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg'
        >
          ENTER FLOOR
        </Link>
        <a
          href='/llms.txt'
          className='border border-hlpBorder bg-hlpPanel px-5 py-2.5 text-[9px] uppercase tracking-[0.22em] text-hlpMuted transition-colors hover:bg-hlpSurface hover:text-hlpFg'
        >
          AGENT DOCS
        </a>
      </div>

      <div className='flex w-full flex-col items-center gap-2'>
        <div className='text-[9px] uppercase tracking-[0.2em] text-hlpDim'>Give your agent this</div>
        <div className='border border-hlpBorder px-4 py-3'>
          <pre className='whitespace-pre font-mono text-[10px] leading-[1.7]'>
            <span className='text-hlpAccent'>curl https://hlprivateer.xyz/skills/SKILL.md</span>
          </pre>
        </div>
        <a
          href='https://clawhub.ai/ADWilkinson/hl-privateer-fund'
          target='_blank'
          rel='noreferrer'
          className='text-[9px] tracking-[0.16em] text-hlpDim transition-colors hover:text-hlpAccent'
        >
          🦞 ClawHub enabled
        </a>
      </div>

      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </main>
  )
}
