'use client'

import { useEffect, useMemo, useState } from 'react'

const SIGNALS = [
  'news: macro desk cites softer inflation print',
  'farcaster: rate-cut chatter accelerates',
  'manual: operator pins Fed September market',
  'x: challenger claim resolved, book reopens',
]

const TAPE = [
  { role: 'AGT', line: 'pHat=68.0% (mkt 62.0%) YES@0.620 $200 edge +6.00pp' },
  { role: 'RSK', line: 'ALLOW stake=200 gates=14/14 kelly=0.20' },
  { role: 'EXE', line: 'filled $200 @0.620 fee=0.00' },
  { role: 'OPS', line: 'audit appended proposal + decision + fill' },
] as const

const STAGES = [
  { label: 'raw items', value: '4 fresh signals' },
  { label: 'strategy seam', value: 'trade / skip JSON' },
  { label: 'deterministic clip', value: 'Kelly + caps' },
  { label: 'risk gates', value: '14 fail-closed' },
  { label: 'router', value: 'HIP-4 order' },
] as const

function roleClass(role: (typeof TAPE)[number]['role']): string {
  if (role === 'AGT') return 'text-hlpAccent'
  if (role === 'RSK') return 'text-hlpWarning'
  if (role === 'EXE') return 'text-hlpPositive'
  return 'text-hlpPanel'
}

export function ProductPipelineDemo() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    const intervalId = window.setInterval(() => setTick((n) => n + 1), 1800)
    return () => window.clearInterval(intervalId)
  }, [])

  const signal = SIGNALS[tick % SIGNALS.length]
  const activeTape = useMemo(() => TAPE.slice(0, (tick % TAPE.length) + 1), [tick])
  const activeStage = tick % STAGES.length

  return (
    <div
      className='absolute inset-0 overflow-hidden bg-hlpDeepBg text-hlpPanel'
      aria-hidden='true'
    >
      <div className='absolute inset-0 opacity-75 scanline-overlay' />
      <div className='absolute inset-x-0 top-0 h-px bg-hlpPanel/30' />
      <div className='absolute left-1/2 top-1/2 h-[720px] w-[min(1100px,92vw)] -translate-x-1/2 -translate-y-1/2 border border-hlpPanel/15 bg-black/20' />

      <div className='absolute left-1/2 top-[13%] grid w-[min(1100px,92vw)] -translate-x-1/2 gap-3 md:grid-cols-[1.1fr_0.9fr]'>
        <div className='border border-hlpPanel/20 bg-black/60'>
          <div className='flex items-center justify-between border-b border-hlpPanel/20 px-3 py-2 text-[9px] uppercase tracking-[0.2em] text-hlpPanel/55'>
            <span>sentiment intake</span>
            <span>poll 5s</span>
          </div>
          <div className='min-h-32 p-3 text-[10px] leading-relaxed text-hlpPanel/75'>
            {SIGNALS.map((s, index) => (
              <div
                key={s}
                className={`grid grid-cols-[22px_1fr] border-b border-hlpPanel/10 py-1.5 last:border-b-0 ${
                  s === signal ? 'text-hlpPanel' : ''
                }`}
              >
                <span className='text-hlpPanel/35'>{String(index + 1).padStart(2, '0')}</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>

        <div className='border border-hlpPanel/20 bg-black/60'>
          <div className='flex items-center justify-between border-b border-hlpPanel/20 px-3 py-2 text-[9px] uppercase tracking-[0.2em] text-hlpPanel/55'>
            <span>public floor tape</span>
            <span>privacy-safe</span>
          </div>
          <div className='min-h-32 p-3 text-[10px] leading-relaxed'>
            {activeTape.map((entry) => (
              <div key={`${entry.role}-${entry.line}`} className='mb-2 grid grid-cols-[34px_1fr] gap-2'>
                <span className={roleClass(entry.role)}>{entry.role}</span>
                <span className='text-hlpPanel/80'>{entry.line}</span>
              </div>
            ))}
            <span className='animate-hlp-cursor text-hlpPanel'>_</span>
          </div>
        </div>
      </div>

      <div className='absolute left-1/2 top-[53%] hidden w-[min(1100px,92vw)] -translate-x-1/2 grid-cols-5 gap-0 border border-hlpPanel/20 bg-black/70 sm:grid'>
        {STAGES.map((stage, index) => (
          <div
            key={stage.label}
            className={`relative min-h-28 border-b border-hlpPanel/20 p-3 sm:border-b-0 sm:border-r sm:last:border-r-0 ${
              index === activeStage ? 'bg-hlpPanel text-hlpFg' : ''
            }`}
          >
            <div className='flex items-start justify-between gap-3'>
              <span className='text-[9px] uppercase tracking-[0.2em] opacity-60'>
                {stage.label}
              </span>
              <span className='text-[9px] opacity-45'>{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className='mt-5 text-[11px] leading-tight'>{stage.value}</div>
            {index < STAGES.length - 1 && (
              <span className='absolute -right-1.5 top-1/2 z-10 hidden h-3 w-3 -translate-y-1/2 rotate-45 border-r border-t border-hlpPanel/40 bg-black sm:block' />
            )}
          </div>
        ))}
      </div>

      <div className='absolute bottom-[12%] right-[4vw] hidden w-64 border border-hlpPanel/20 bg-black/55 p-3 lg:block'>
        <div className='text-[9px] uppercase tracking-[0.2em] text-hlpPanel/45'>privacy boundary</div>
        <div className='mt-2 text-[12px] uppercase tracking-[0.12em] text-hlpPanel'>public floor only</div>
        <div className='mt-1 text-[10px] leading-relaxed text-hlpPanel/55'>
          no positions, no bankroll, no raw signals, no private thesis
        </div>
      </div>
    </div>
  )
}
