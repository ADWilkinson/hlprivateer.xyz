'use client'

import { useEffect, useMemo, useState } from 'react'

const SIGNALS = [
  'news: softer inflation internals',
  'farcaster: rate-cut chatter',
  'manual: September market pinned',
  'x: book reopens after challenge',
]

const TAPE = [
  { role: 'AGT', line: 'pHat 70.0 / mkt 62.0 / YES' },
  { role: 'RSK', line: 'ALLOW / 14 fail-closed gates' },
  { role: 'EXE', line: 'fill recorded / HIP-4 order' },
  { role: 'OPS', line: 'public floor tape appended' },
] as const

const STAGES = ['sentiment intake', 'AGT estimate', 'deterministic clip', 'RSK gates', 'EXE route'] as const

function roleColor(role: (typeof TAPE)[number]['role']): string {
  if (role === 'AGT') return '#78b8ff'
  if (role === 'RSK') return '#ffb36b'
  if (role === 'EXE') return '#78e08f'
  return '#ffffff'
}

export function ProductPipelineDemo() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    const intervalId = window.setInterval(() => setTick((n) => n + 1), 1700)
    return () => window.clearInterval(intervalId)
  }, [])

  const activeSignal = tick % SIGNALS.length
  const activeTape = useMemo(() => TAPE.slice(0, (tick % TAPE.length) + 1), [tick])
  const activeStage = tick % STAGES.length

  return (
    <div className='absolute inset-0 overflow-hidden bg-hlpDeepBg text-hlpPanel' aria-hidden='true'>
      <div className='absolute inset-0 probability-field opacity-80' />
      <svg
        className='absolute left-1/2 top-[42%] h-[min(86svh,760px)] w-[min(1160px,96vw)] -translate-x-1/2 -translate-y-1/2 sm:top-1/2'
        viewBox='0 0 1160 760'
        role='img'
      >
        <defs>
          <pattern id='micro-grid' width='28' height='28' patternUnits='userSpaceOnUse'>
            <path d='M28 0H0v28' fill='none' stroke='rgba(255,255,255,0.055)' strokeWidth='1' />
          </pattern>
          <filter id='soft-glow' x='-40%' y='-40%' width='180%' height='180%'>
            <feGaussianBlur stdDeviation='5' result='blur' />
            <feMerge>
              <feMergeNode in='blur' />
              <feMergeNode in='SourceGraphic' />
            </feMerge>
          </filter>
        </defs>

        <rect width='1160' height='760' fill='url(#micro-grid)' />
        <path
          className='probability-orbit'
          d='M137 382C276 204 445 156 580 246c135-90 304-42 443 136-139 178-308 226-443 136-135 90-304 42-443-136Z'
          fill='none'
          stroke='rgba(255,255,255,0.22)'
          strokeWidth='1.5'
        />
        <path
          className='probability-orbit probability-orbit-delay'
          d='M209 382c110-117 247-151 371-83 124-68 261-34 371 83-110 117-247 151-371 83-124 68-261 34-371-83Z'
          fill='none'
          stroke='rgba(120,184,255,0.32)'
          strokeWidth='1.5'
        />

        <g className='probability-draw' filter='url(#soft-glow)'>
          <path
            d='M142 506C292 446 415 380 506 294c30-28 60-44 91-46 44-2 83 24 116 78 41 67 82 102 130 101 47-1 99-38 159-109'
            fill='none'
            stroke='rgba(120,184,255,0.9)'
            strokeWidth='4'
            strokeLinecap='round'
          />
          <path
            d='M142 554c156-70 286-114 389-132 91-16 169-7 232 27 68 37 150 39 247 6'
            fill='none'
            stroke='rgba(120,224,143,0.72)'
            strokeWidth='2'
            strokeLinecap='round'
          />
        </g>

        <line x1='580' y1='154' x2='580' y2='616' stroke='rgba(255,255,255,0.18)' strokeDasharray='4 10' />
        <text x='580' y='140' textAnchor='middle' className='fill-white/55 text-[11px] uppercase tracking-[0.35em]'>
          pHat boundary
        </text>

        <g transform='translate(486 288)'>
          <circle className='probability-node' cx='94' cy='94' r='88' fill='rgba(255,255,255,0.035)' stroke='rgba(255,255,255,0.36)' />
          <circle cx='94' cy='94' r='48' fill='rgba(255,255,255,0.9)' />
          <text x='94' y='90' textAnchor='middle' className='fill-black text-[18px] font-bold tracking-[0.16em]'>
            70.0
          </text>
          <text x='94' y='111' textAnchor='middle' className='fill-black/60 text-[9px] uppercase tracking-[0.24em]'>
            pHat
          </text>
        </g>

        <g transform='translate(90 126)'>
          <text className='fill-white/45 text-[9px] uppercase tracking-[0.26em]'>sentiment intake</text>
          {SIGNALS.map((signal, index) => (
            <g key={signal} transform={`translate(0 ${34 + index * 28})`} opacity={activeSignal === index ? 1 : 0.45}>
              <circle cx='4' cy='-4' r='3.5' fill={activeSignal === index ? '#ffffff' : 'rgba(255,255,255,0.32)'} />
              <text x='18' y='0' className='fill-white/75 text-[11px]'>
                {signal}
              </text>
            </g>
          ))}
        </g>

        <g transform='translate(764 126)'>
          <text className='fill-white/45 text-[9px] uppercase tracking-[0.26em]'>public floor tape</text>
          {activeTape.map((entry, index) => (
            <g key={`${entry.role}-${entry.line}`} transform={`translate(0 ${36 + index * 30})`}>
              <text x='0' y='0' fill={roleColor(entry.role)} className='text-[12px] font-bold tracking-[0.18em]'>
                {entry.role}
              </text>
              <text x='52' y='0' className='fill-white/78 text-[11px]'>
                {entry.line}
              </text>
            </g>
          ))}
        </g>

        <g transform='translate(158 634)'>
          {STAGES.map((stage, index) => (
            <g key={stage} transform={`translate(${index * 184} 0)`} opacity={activeStage === index ? 1 : 0.46}>
              <line x1='0' y1='0' x2='124' y2='0' stroke={activeStage === index ? '#ffffff' : 'rgba(255,255,255,0.28)'} strokeWidth='2' />
              <text x='0' y='25' className='fill-white/72 text-[9px] uppercase tracking-[0.24em]'>
                {stage}
              </text>
              <text x='0' y='45' className='fill-white/36 text-[9px]'>
                {String(index + 1).padStart(2, '0')}
              </text>
            </g>
          ))}
        </g>

        <text x='90' y='710' className='fill-white/42 text-[10px] uppercase tracking-[0.3em]'>
          privacy boundary: no positions / no bankroll / no raw signals / no private thesis
        </text>
      </svg>
    </div>
  )
}
