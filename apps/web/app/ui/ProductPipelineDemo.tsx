'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiUrl } from '../../lib/endpoints'

type DemoMarket = {
  id: string
  question: string
  yesPrice: number
  pHat?: number
  edge?: number
}

type DemoTapeLine = {
  role: 'AGT' | 'RSK' | 'EXE' | 'OPS'
  message: string
}

type DemoSnapshot = {
  markets: DemoMarket[]
  tape: DemoTapeLine[]
}

const FALLBACK_MARKETS: DemoMarket[] = [
  {
    id: 'demo-fed-pause-sep',
    question: 'Will the Fed pause at the September meeting?',
    yesPrice: 0.62,
    pHat: 0.7,
    edge: 0.08,
  },
  {
    id: 'demo-btc-etf-flows',
    question: 'Will weekly BTC ETF net flows finish positive?',
    yesPrice: 0.54,
    pHat: 0.62,
    edge: 0.08,
  },
  {
    id: 'demo-inflation-print',
    question: 'Will the next CPI print come in below consensus?',
    yesPrice: 0.47,
    pHat: 0.55,
    edge: 0.08,
  },
]

const FALLBACK_TAPE: DemoTapeLine[] = [
  { role: 'AGT', message: 'agent estimate 70.0% / market 62.0%' },
  { role: 'RSK', message: 'risk checks allow the small order' },
  { role: 'EXE', message: 'fill recorded on the public tape' },
  { role: 'OPS', message: 'audit line appended' },
]

const STAGES = ['signals', 'estimate', 'stake limit', 'risk checks', 'public line'] as const

function roleColor(role: DemoTapeLine['role']): string {
  if (role === 'AGT') return '#78b8ff'
  if (role === 'RSK') return '#ffb36b'
  if (role === 'EXE') return '#78e08f'
  return '#ffffff'
}

function pct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return (value * 100).toFixed(1)
}

function pp(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}`
}

function shortQuestion(question: string): string {
  return question.length > 46 ? `${question.slice(0, 43)}...` : question
}

export function ProductPipelineDemo() {
  const [tick, setTick] = useState(0)
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    const intervalId = window.setInterval(() => setTick((n) => n + 1), 1700)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/v1/public/floor'))
        if (!res.ok) return
        const json = (await res.json()) as DemoSnapshot
        if (active) setSnapshot(json)
      } catch {
        // Keep the static fallback. The public site should still read as an exhibit.
      }
    }
    void load()
    const intervalId = window.setInterval(load, 5000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  const markets = snapshot?.markets?.length ? snapshot.markets.slice(0, 3) : FALLBACK_MARKETS
  const tape = snapshot?.tape?.length ? snapshot.tape.slice(-4) : FALLBACK_TAPE
  const activeMarket = markets[tick % markets.length] ?? FALLBACK_MARKETS[0]
  const activeTape = useMemo(() => tape.slice(0, (tick % tape.length) + 1), [tape, tick])
  const activeStage = tick % STAGES.length
  const marketX = 176 + (activeMarket.yesPrice ?? 0.5) * 808
  const estimateX = 176 + (activeMarket.pHat ?? activeMarket.yesPrice ?? 0.5) * 808

  return (
    <div className='absolute inset-0 overflow-hidden bg-hlpDeepBg text-hlpPanel' aria-hidden='true'>
      <div className='absolute inset-0 probability-field opacity-80' />
      <svg
        className='absolute left-1/2 top-[35%] h-[min(86svh,760px)] w-[min(1160px,96vw)] -translate-x-1/2 -translate-y-1/2 sm:top-1/2'
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

        <line
          x1={marketX}
          y1='154'
          x2={marketX}
          y2='616'
          stroke='rgba(255,255,255,0.2)'
          strokeDasharray='4 10'
        />
        <line
          x1={estimateX}
          y1='154'
          x2={estimateX}
          y2='616'
          stroke='rgba(120,184,255,0.38)'
          strokeDasharray='2 8'
        />
        <line
          x1={Math.min(marketX, estimateX)}
          y1='170'
          x2={Math.max(marketX, estimateX)}
          y2='170'
          stroke='rgba(120,224,143,0.56)'
          strokeWidth='2'
        />
        <text x={marketX} y='140' textAnchor='middle' className='fill-white/55 text-[10px] uppercase tracking-[0.26em]'>
          market {pct(activeMarket.yesPrice)}
        </text>
        <text x={estimateX} y='126' textAnchor='middle' className='fill-white/70 text-[10px] uppercase tracking-[0.26em]'>
          estimate {pct(activeMarket.pHat)}
        </text>
        <text x={Math.max(marketX, estimateX) + 16} y='174' className='fill-white/48 text-[9px] uppercase tracking-[0.2em]'>
          edge {pp(activeMarket.edge)}pp
        </text>

        <g transform='translate(486 288)'>
          <circle
            className='probability-node'
            cx='94'
            cy='94'
            r='88'
            fill='rgba(255,255,255,0.035)'
            stroke='rgba(255,255,255,0.36)'
          />
          <circle cx='94' cy='94' r='48' fill='rgba(255,255,255,0.9)' />
          <text x='94' y='90' textAnchor='middle' className='fill-black text-[18px] font-bold tracking-[0.16em]'>
            {pct(activeMarket.pHat)}
          </text>
          <text x='94' y='111' textAnchor='middle' className='fill-black/60 text-[9px] uppercase tracking-[0.24em]'>
            agent
          </text>
        </g>

        <g transform='translate(90 126)'>
          <text className='fill-white/45 text-[9px] uppercase tracking-[0.26em]'>market window</text>
          {markets.map((market, index) => (
            <g
              key={market.id}
              transform={`translate(0 ${34 + index * 38})`}
              opacity={activeMarket.id === market.id ? 1 : 0.46}
            >
              <circle cx='4' cy='-4' r='3.5' fill={activeMarket.id === market.id ? '#ffffff' : 'rgba(255,255,255,0.32)'} />
              <text x='18' y='0' className='fill-white/75 text-[11px]'>
                {shortQuestion(market.question)}
              </text>
              <text x='18' y='18' className='fill-white/36 text-[9px] uppercase tracking-[0.18em]'>
                market {pct(market.yesPrice)} / agent {pct(market.pHat)}
              </text>
            </g>
          ))}
        </g>

        <g transform='translate(828 198)'>
          <text className='fill-white/45 text-[9px] uppercase tracking-[0.26em]'>public floor tape</text>
          {activeTape.map((entry, index) => (
            <g key={`${entry.role}-${entry.message}-${index}`} transform={`translate(0 ${36 + index * 30})`}>
              <text x='0' y='0' fill={roleColor(entry.role)} className='text-[12px] font-bold tracking-[0.18em]'>
                {entry.role}
              </text>
              <text x='52' y='0' fill='rgba(255,255,255,0.78)' className='text-[11px]'>
                {entry.message.length > 42 ? `${entry.message.slice(0, 39)}...` : entry.message}
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
          public window: questions / prices / agent estimate / edge / role tape
        </text>
      </svg>
    </div>
  )
}
