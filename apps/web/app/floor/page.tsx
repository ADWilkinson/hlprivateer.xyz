'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiUrl } from '../../lib/endpoints'

type FloorMarket = {
  id: string
  question: string
  status: string
  yesPrice: number
  pHat?: number
  edge?: number
  resolutionAt: string
  topicTags: string[]
}

type FloorTapeLine = {
  ts: string
  role: 'AGT' | 'RSK' | 'EXE' | 'OPS'
  message: string
}

type FloorSnapshot = {
  mode: 'INIT' | 'READY' | 'HALT'
  pnlPct: number | null
  marketsTracked: number
  markets: FloorMarket[]
  tape: FloorTapeLine[]
}

const POLL_MS = 5_000
const PIPELINE = [
  { id: 'sources', label: 'SOURCES', detail: 'raw sentiment' },
  { id: 'agent', label: 'AGT', detail: 'pHat / side / size', role: 'AGT' },
  { id: 'clip', label: 'CLIP', detail: 'Kelly + caps' },
  { id: 'risk', label: 'RSK', detail: '14 fail-closed gates', role: 'RSK' },
  { id: 'execution', label: 'EXE', detail: 'order router -> HL', role: 'EXE' },
  { id: 'audit', label: 'OPS', detail: 'JSONL + tape', role: 'OPS' },
] as const

function fmtPct(x: number | undefined): string {
  if (x === undefined || !Number.isFinite(x)) return '—'
  return `${(x * 100).toFixed(1)}%`
}

function fmtEdge(x: number | undefined): string {
  if (x === undefined || !Number.isFinite(x)) return '—'
  const sign = x > 0 ? '+' : ''
  return `${sign}${(x * 100).toFixed(2)}pp`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return iso.slice(11, 19)
  }
}

function fmtDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${fmtTime(iso)}`
}

function roleClass(role: FloorTapeLine['role']): string {
  if (role === 'AGT') return 'text-hlpAccent'
  if (role === 'RSK') return 'text-hlpWarning'
  if (role === 'EXE') return 'text-hlpPositive'
  return 'text-hlpFg'
}

function modeClass(mode: FloorSnapshot['mode'] | undefined): string {
  if (mode === 'READY') return 'border-hlpHealthy text-hlpHealthy'
  if (mode === 'HALT') return 'border-hlpNegative text-hlpNegative'
  return 'border-hlpBorder text-hlpDim'
}

export default function FloorPage() {
  const [snap, setSnap] = useState<FloorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/v1/public/floor'))
        if (!res.ok) {
          if (active) setError(`HTTP ${res.status}`)
          return
        }
        const json = (await res.json()) as FloorSnapshot
        if (active) {
          setSnap(json)
          setLastUpdatedAt(new Date().toISOString())
          setError(null)
        }
      } catch (err) {
        if (active) setError(String(err))
      }
    }
    void load()
    const t = setInterval(load, POLL_MS)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  const latestTape = snap?.tape.at(-1)
  const visibleTape = useMemo(
    () =>
      (snap?.tape ?? [])
        .slice()
        .reverse()
        .map((t) => `${fmtTime(t.ts)} ${t.role.padEnd(3)} ${t.message}`),
    [snap?.tape],
  )

  return (
    <main
      id='main-content'
      className='relative z-10 mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-6 text-[11px] tracking-wide text-hlpMuted sm:py-8'
    >
      <header className='grid gap-4 border-b border-hlpBorder pb-4 md:grid-cols-[1fr_auto] md:items-end'>
        <div className='space-y-2'>
          <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>public floor</div>
          <h1 className='text-[15px] uppercase tracking-[0.18em] text-hlpFg'>
            HIP-4 outcome-market pipeline
          </h1>
          <p className='max-w-[760px] text-[11px] leading-relaxed text-hlpMuted'>
            Privacy-safe telemetry only: mode, market price, pHat, edge, and the AGT / RSK / EXE / OPS tape.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2 md:justify-end' aria-live='polite'>
          <span
            className={`inline-flex h-8 min-w-20 items-center justify-center border bg-hlpPanel px-3 text-[9px] uppercase tracking-[0.18em] ${modeClass(snap?.mode)}`}
          >
            {snap?.mode ?? 'INIT'}
          </span>
          <span className='inline-flex h-8 items-center border border-hlpBorder bg-hlpPanel px-3 text-[9px] uppercase tracking-[0.16em] text-hlpDim'>
            {snap?.marketsTracked ?? 0} markets
          </span>
          <span className='inline-flex h-8 items-center border border-hlpBorder bg-hlpPanel px-3 text-[9px] uppercase tracking-[0.16em] text-hlpDim'>
            pnl {snap?.pnlPct === null || snap?.pnlPct === undefined ? 'private' : fmtPct(snap.pnlPct)}
          </span>
        </div>
      </header>

      {error && (
        <section className='border border-hlpNegative bg-hlpPanel px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-hlpNegative'>
          backend offline · {error}
        </section>
      )}

      <section className='grid gap-3 lg:grid-cols-[1fr_260px]'>
        <div className='border border-hlpBorder bg-hlpPanel'>
          <div className='border-b border-hlpBorder bg-hlpInverseBg px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-hlpPanel/85'>
            transparent loop
          </div>
          <ol className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'>
            {PIPELINE.map((step, index) => {
              const role = 'role' in step ? step.role : undefined
              const active = role === latestTape?.role
              return (
                <li
                  key={step.id}
                  className={`relative min-h-24 border-b border-r border-hlpBorder p-3 last:border-r-0 lg:border-b-0 ${
                    active ? 'bg-hlpSurface text-hlpFg' : ''
                  }`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <span className={`text-[10px] uppercase tracking-[0.2em] ${active && role ? roleClass(role) : 'text-hlpDim'}`}>
                      {step.label}
                    </span>
                    <span className='text-[9px] text-hlpDim'>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className='mt-3 min-h-8 text-[10px] leading-snug text-hlpMuted'>{step.detail}</div>
                  {active && (
                    <span className='absolute bottom-2 left-3 h-1.5 w-1.5 animate-hlp-led bg-hlpFg' aria-hidden='true' />
                  )}
                </li>
              )
            })}
          </ol>
        </div>

        <aside className='border border-hlpBorder bg-hlpPanel p-3'>
          <div className='text-[10px] uppercase tracking-[0.2em] text-hlpDim'>last pulse</div>
          <div className='mt-3 min-h-12 text-[10px] leading-relaxed text-hlpMuted'>
            {latestTape ? (
              <>
                <span className={roleClass(latestTape.role)}>{latestTape.role}</span>{' '}
                <span>{fmtDateTime(latestTape.ts)}</span>
                <div className='mt-1 text-hlpFg'>{latestTape.message}</div>
              </>
            ) : (
              'waiting for role tape'
            )}
          </div>
          <div className='mt-4 border-t border-hlpBorder pt-3 text-[9px] uppercase tracking-[0.16em] text-hlpDim'>
            refreshed {lastUpdatedAt ? fmtTime(lastUpdatedAt) : 'pending'}
          </div>
        </aside>
      </section>

      <section>
        <div className='mb-2 flex items-center justify-between gap-3'>
          <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>markets</div>
          <div className='text-[9px] uppercase tracking-[0.16em] text-hlpDim'>public fields only</div>
        </div>
        <div className='overflow-x-auto border border-hlpBorder'>
          <table className='w-full text-[10px]'>
            <thead className='bg-hlpInverseBg text-hlpPanel/85'>
              <tr>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-left'>QUESTION</th>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-right'>MKT YES</th>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-right'>p̂</th>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-right'>EDGE</th>
                <th className='border-r border-hlpBorder px-3 py-1.5 text-left'>RESOLVES</th>
                <th className='px-3 py-1.5 text-left'>TAGS</th>
              </tr>
            </thead>
            <tbody>
              {(snap?.markets ?? []).map((m) => (
                <tr key={m.id} className='border-t border-hlpBorder'>
                  <td className='min-w-[260px] border-r border-hlpBorder px-3 py-2 text-hlpFg'>{m.question}</td>
                  <td className='border-r border-hlpBorder px-3 py-1.5 text-right'>{fmtPct(m.yesPrice)}</td>
                  <td className='border-r border-hlpBorder px-3 py-1.5 text-right'>{fmtPct(m.pHat)}</td>
                  <td
                    className={
                      'border-r border-hlpBorder px-3 py-1.5 text-right ' +
                      (m.edge && m.edge > 0
                        ? 'text-hlpPositive'
                        : m.edge && m.edge < 0
                          ? 'text-hlpNegative'
                          : '')
                    }
                  >
                    {fmtEdge(m.edge)}
                  </td>
                  <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpDim'>
                    {fmtTime(m.resolutionAt)} · {m.resolutionAt.slice(0, 10)}
                  </td>
                  <td className='px-3 py-1.5 text-hlpDim'>{m.topicTags.join(' · ') || '—'}</td>
                </tr>
              ))}
              {(!snap || snap.markets.length === 0) && (
                <tr>
                  <td colSpan={6} className='px-3 py-3 text-center text-hlpDim'>
                    {snap ? 'no markets yet' : 'waiting for public floor snapshot'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className='mb-2 flex items-center justify-between gap-3'>
          <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>role tape</div>
          <div className='text-[9px] uppercase tracking-[0.16em] text-hlpDim'>newest first</div>
        </div>
        <pre className='max-h-[420px] min-h-[180px] overflow-y-auto border border-hlpBorder bg-hlpInverseBg p-3 text-[10px] leading-[1.6] text-hlpPanel/85'>
          {visibleTape.join('\n') || '-- no activity --'}
        </pre>
      </section>
    </main>
  )
}
