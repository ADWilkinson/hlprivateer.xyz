'use client'

import { useEffect, useState } from 'react'
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
  role: 'SNT' | 'RSK' | 'EXE' | 'OPS'
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

export default function FloorPage() {
  const [snap, setSnap] = useState<FloorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <main className='relative z-10 mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-8 text-[11px] tracking-wide text-hlpMuted'>
      <header className='flex items-center justify-between border-b border-hlpBorder pb-3'>
        <div className='flex items-center gap-3'>
          <span className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>floor</span>
          <span className='border border-hlpBorder bg-hlpInverseBg px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-hlpPanel'>
            {snap?.mode ?? '—'}
          </span>
          <span className='text-[10px] text-hlpDim'>
            tracking {snap?.marketsTracked ?? 0} markets
          </span>
        </div>
        {error && (
          <span className='text-[10px] text-hlpNegative'>backend offline · {error}</span>
        )}
      </header>

      <section>
        <div className='mb-2 text-[10px] uppercase tracking-[0.22em] text-hlpDim'>markets</div>
        <div className='border border-hlpBorder'>
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
                  <td className='border-r border-hlpBorder px-3 py-1.5 text-hlpFg'>{m.question}</td>
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
              {snap && snap.markets.length === 0 && (
                <tr>
                  <td colSpan={6} className='px-3 py-3 text-center text-hlpDim'>
                    no markets yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className='mb-2 text-[10px] uppercase tracking-[0.22em] text-hlpDim'>tape</div>
        <pre className='max-h-[420px] min-h-[160px] overflow-y-auto border border-hlpBorder bg-hlpInverseBg p-3 text-[10px] leading-[1.6] text-hlpPanel/85'>
          {(snap?.tape ?? [])
            .slice()
            .reverse()
            .map((t) => `${fmtTime(t.ts)} ${t.role.padEnd(3)} ${t.message}`)
            .join('\n') || '— no activity —'}
        </pre>
      </section>
    </main>
  )
}
