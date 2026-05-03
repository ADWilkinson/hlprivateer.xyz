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
const RISK_GATES = Array.from({ length: 14 }, (_, index) => index)

function roleColor(role: DemoTapeLine['role']): string {
  if (role === 'AGT') return '#78b8ff'
  if (role === 'RSK') return '#ffb36b'
  if (role === 'EXE') return '#78e08f'
  return '#ffffff'
}

function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
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

function shortMessage(message: string): string {
  return message.length > 31 ? `${message.slice(0, 28)}...` : message
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
  const activeMarketIndex = markets.findIndex((market) => market.id === activeMarket.id)
  const activeTape = useMemo(() => tape.slice(0, (tick % tape.length) + 1), [tape, tick])
  const activeStage = tick % STAGES.length
  const axisStart = 390
  const axisWidth = 390
  const marketX = axisStart + clamp01(activeMarket.yesPrice) * axisWidth
  const estimateX = axisStart + clamp01(activeMarket.pHat ?? activeMarket.yesPrice) * axisWidth
  const activeMarketY = 154 + Math.max(0, activeMarketIndex) * 48
  const edgeStart = Math.min(marketX, estimateX)
  const edgeWidth = Math.abs(marketX - estimateX)

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
        <rect x='70' y='86' width='1020' height='474' fill='rgba(255,255,255,0.018)' stroke='rgba(255,255,255,0.08)' />
        <line x1='330' y1='104' x2='330' y2='540' stroke='rgba(255,255,255,0.08)' />
        <line x1='808' y1='104' x2='808' y2='540' stroke='rgba(255,255,255,0.08)' />
        <line x1='932' y1='104' x2='932' y2='540' stroke='rgba(255,255,255,0.08)' />

        <g className='probability-draw' filter='url(#soft-glow)' opacity='0.95'>
          <path
            d={`M324 ${activeMarketY - 4} C 414 ${activeMarketY - 18}, 446 328, 526 362`}
            fill='none'
            stroke='rgba(120,184,255,0.9)'
            strokeWidth='3'
            strokeLinecap='round'
          />
          <path
            d='M650 382 C 706 382, 738 382, 796 382'
            fill='none'
            stroke='rgba(120,224,143,0.72)'
            strokeWidth='3'
            strokeLinecap='round'
          />
          <path
            d='M928 382 C 966 382, 988 350, 1022 328'
            fill='none'
            stroke='rgba(255,255,255,0.72)'
            strokeWidth='2'
            strokeLinecap='round'
          />
        </g>

        <g transform='translate(90 126)'>
          <text className='fill-white/46 text-[9px] uppercase tracking-[0.26em]'>market window</text>
          {markets.map((market, index) => (
            <g
              key={market.id}
              transform={`translate(0 ${34 + index * 48})`}
              opacity={activeMarket.id === market.id ? 1 : 0.42}
            >
              <circle cx='4' cy='-4' r='3.5' fill={activeMarket.id === market.id ? '#ffffff' : 'rgba(255,255,255,0.34)'} />
              <text x='18' y='0' className='fill-white/78 text-[11px]'>
                {shortQuestion(market.question)}
              </text>
              <text x='18' y='18' className='fill-white/38 text-[9px] uppercase tracking-[0.18em]'>
                market {pct(market.yesPrice)} / agent {pct(market.pHat)}
              </text>
            </g>
          ))}
        </g>

        <g transform='translate(390 132)'>
          <text className='fill-white/46 text-[9px] uppercase tracking-[0.26em]'>probability rail</text>
          <line x1='0' y1='88' x2={axisWidth} y2='88' stroke='rgba(255,255,255,0.28)' />
          {[0, 0.25, 0.5, 0.75, 1].map((mark) => (
            <g key={mark} transform={`translate(${mark * axisWidth} 88)`}>
              <line y1='-8' y2='8' stroke='rgba(255,255,255,0.24)' />
              <text y='29' textAnchor='middle' className='fill-white/36 text-[8px] uppercase tracking-[0.18em]'>
                {mark === 0 || mark === 0.5 || mark === 1 ? `${mark * 100}` : ''}
              </text>
            </g>
          ))}
        </g>

        <line
          x1={marketX}
          y1='184'
          x2={marketX}
          y2='480'
          stroke='rgba(255,255,255,0.28)'
          strokeDasharray='5 10'
        />
        <line
          x1={estimateX}
          y1='168'
          x2={estimateX}
          y2='480'
          stroke='rgba(120,184,255,0.48)'
          strokeDasharray='2 8'
        />
        <rect x={edgeStart} y='214' width={Math.max(edgeWidth, 1)} height='6' fill='rgba(120,224,143,0.42)' />
        <circle cx={marketX} cy='220' r='5' fill='rgba(255,255,255,0.9)' />
        <rect x={estimateX - 7} y='213' width='14' height='14' fill='rgba(8,8,8,0.92)' stroke='rgba(120,184,255,0.96)' />
        <text x={marketX} y='190' textAnchor='middle' className='fill-white/60 text-[10px] uppercase tracking-[0.26em]'>
          market {pct(activeMarket.yesPrice)}
        </text>
        <text x={estimateX} y='170' textAnchor='middle' className='fill-white/76 text-[10px] uppercase tracking-[0.26em]'>
          estimate {pct(activeMarket.pHat)}
        </text>
        <text x={edgeStart + edgeWidth / 2} y='242' textAnchor='middle' className='fill-white/48 text-[9px] uppercase tracking-[0.2em]'>
          edge {pp(activeMarket.edge)}pp
        </text>

        <g transform='translate(498 300)'>
          <path
            d='M82 0 164 82 82 164 0 82Z'
            fill='rgba(255,255,255,0.035)'
            stroke='rgba(255,255,255,0.22)'
          />
          <circle
            className='probability-node'
            cx='82'
            cy='82'
            r='76'
            fill='rgba(255,255,255,0.035)'
            stroke='rgba(255,255,255,0.36)'
          />
          <circle cx='82' cy='82' r='46' fill='rgba(255,255,255,0.9)' />
          <text x='82' y='78' textAnchor='middle' className='fill-black text-[18px] font-bold tracking-[0.16em]'>
            {pct(activeMarket.pHat)}
          </text>
          <text x='82' y='99' textAnchor='middle' className='fill-black/60 text-[9px] uppercase tracking-[0.24em]'>
            agent
          </text>
        </g>

        <g transform='translate(706 318)'>
          <text className='fill-white/46 text-[9px] uppercase tracking-[0.24em]'>stake limit</text>
          <path d='M42 42 84 84 42 126 0 84Z' fill='rgba(120,224,143,0.08)' stroke='rgba(120,224,143,0.42)' />
          <text x='42' y='82' textAnchor='middle' className='fill-white/72 text-[10px] uppercase tracking-[0.2em]'>small</text>
          <text x='42' y='101' textAnchor='middle' className='fill-white/38 text-[8px] uppercase tracking-[0.18em]'>capped</text>
        </g>

        <g transform='translate(820 302)'>
          <text className='fill-white/46 text-[9px] uppercase tracking-[0.24em]'>risk checks</text>
          {RISK_GATES.map((gate) => {
            const row = Math.floor(gate / 7)
            const col = gate % 7
            const live = gate === tick % RISK_GATES.length
            return (
              <rect
                key={gate}
                x={col * 14}
                y={36 + row * 42}
                width='6'
                height='30'
                fill={live ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.18)'}
              />
            )
          })}
          <text x='0' y='136' className='fill-white/40 text-[8px] uppercase tracking-[0.18em]'>14 fixed gates</text>
        </g>

        <g transform='translate(900 186)'>
          <text className='fill-white/46 text-[9px] uppercase tracking-[0.26em]'>public floor tape</text>
          {activeTape.map((entry, index) => (
            <g key={`${entry.role}-${entry.message}-${index}`} transform={`translate(0 ${36 + index * 30})`}>
              <text x='0' y='0' fill={roleColor(entry.role)} className='text-[12px] font-bold tracking-[0.18em]'>
                {entry.role}
              </text>
              <text x='52' y='0' fill='rgba(255,255,255,0.78)' className='text-[11px]'>
                {shortMessage(entry.message)}
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
