'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LandingAsciiDisplay } from './ui/LandingAsciiDisplay'
import { apiUrl } from '../lib/endpoints'

interface FloorSnapshot {
  pnlPct: number | null
  accountValueUsd: number | null
  leverage: number | null
}

export default function LandingPage() {
  const [snap, setSnap] = useState<FloorSnapshot>({
    pnlPct: null,
    accountValueUsd: null,
    leverage: null,
  })

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const res = await fetch(apiUrl('/v1/public/floor-snapshot'))
        if (!res.ok || !active) return
        const d = (await res.json()) as Record<string, unknown>
        const pnlPct = typeof d.pnlPct === 'number' && Number.isFinite(d.pnlPct) ? d.pnlPct : null
        const acct = typeof d.accountValueUsd === 'number' && Number.isFinite(d.accountValueUsd) ? d.accountValueUsd : null
        const maxLev = typeof d.maxLeverage === 'number' && Number.isFinite(d.maxLeverage) ? d.maxLeverage : null
        if (active) setSnap({ pnlPct, accountValueUsd: acct, leverage: maxLev })
      } catch {
        // retry next interval
      }
    }
    void poll()
    const t = window.setInterval(poll, 12_000)
    return () => {
      active = false
      window.clearInterval(t)
    }
  }, [])

  const pnl = snap.pnlPct !== null ? `${snap.pnlPct >= 0 ? '+' : ''}${snap.pnlPct.toFixed(2)}%` : '--'
  const equity = snap.accountValueUsd !== null ? `$${snap.accountValueUsd.toFixed(2)}` : '--'
  const lev = snap.leverage !== null ? `${snap.leverage.toFixed(2)}x` : '--'

  return (
    <div className='relative z-10 mx-auto flex min-h-[calc(100dvh-52px)] w-full max-w-[1300px] flex-col items-center justify-center gap-6 px-3 py-8'>
      <div className='flex w-full items-center justify-between'>
        <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>
          <span className='text-hlpMuted'>[HL]</span> PRIVATEER
        </div>
        <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpPositive'>
          <span className='inline-block h-1.5 w-1.5 animate-hlp-led bg-hlpPositive' />
          LIVE
        </div>
      </div>

      <LandingAsciiDisplay className='w-full border border-hlpBorder p-2' />

      <div className='flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-hlpMuted'>
        <span>
          PNL <span className='text-hlpFg'>{pnl}</span>
        </span>
        <span className='text-hlpBorder'>|</span>
        <span>
          EQUITY <span className='text-hlpFg'>{equity}</span>
        </span>
        <span className='text-hlpBorder'>|</span>
        <span>
          LEVERAGE <span className='text-hlpFg'>{lev}</span>
        </span>
      </div>

      <Link
        href='/floor'
        className='border border-hlpBorder bg-hlpInverseBg px-6 py-3 text-[10px] uppercase tracking-[0.22em] text-hlpPanel transition-colors hover:bg-hlpFg hover:text-hlpBg'
      >
        ENTER FLOOR
      </Link>
    </div>
  )
}
