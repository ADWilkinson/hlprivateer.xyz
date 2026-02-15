import Link from 'next/link'
import { AsciiBackground } from '../ui/AsciiBackground'
import { cardClass, cardHeaderClass, pageShellClass } from '../ui/ascii-style'

const CREW_ROLES = [
  {
    role: 'SCOUT',
    cadence: 'ops heartbeat every 1s; universe watch every cycle',
    mission: 'Collect live ticks, track feed freshness, and trigger watchlist updates.',
    controls: ['tick freshness', 'watchlist publication', 'reconciling basket events'],
  },
  {
    role: 'RESEARCH',
    cadence: 'Hourly minimum',
    mission:
      'Synthesize regime, funding, correlation, social flow and macro context into actionable hypotheses.',
    controls: ['Hyperliquid', 'OpenClaw', 'social + alternative sentiment sources', 'coingecko'],
  },
  {
    role: 'RISK',
    cadence: 'Hourly minimum',
    mission: 'Generate posture and recommend risk policy shifts before proposal exposure grows.',
    controls: ['Posture scoring', 'dependency failure guard', 'drawdown/leverage checks'],
  },
  {
    role: 'STRATEGIST',
    cadence: 'Hourly minimum',
    mission: 'Choose long/short/pair directives, sizing and time horizon.',
    controls: ['state-aware policy constraints', 'pair-leg composition', 'forced risk-off fallback'],
  },
  {
    role: 'EXECUTION',
    cadence: 'Event-driven when proposals update',
    mission: 'Transform strategy plans into execution-ready proposals and tactic envelopes.',
    controls: ['execution tactics', 'slippage and depth assumptions'],
  },
  {
    role: 'SCRIBE',
    cadence: 'Hourly minimum',
    mission: 'Create audit-grade narrative for rationale, risks, and proposal intent.',
    controls: ['decision logs', 'thesis text', 'context snapshots'],
  },
  {
    role: 'OPS',
    cadence: 'Continuous heartbeat',
    mission: 'Own floor stability, auto-halt/recover behavior, and watchdog actions.',
    controls: ['auto-halt recovery', 'heartbeat publishing', 'ops alerts'],
  },
]

const TELEMETRY_PILLARS = [
  'Live tape of all agent and system events',
  'Crew heartbeat + role activity heatmap',
  'Discord webhook alerts for important actions',
  'Per-agent local journaling files (journal-<agent>.ndjson)',
  'GitHub interval sync to reduce API churn',
  'OpenClaw-driven data + social intelligence graph',
]

function RoleCard({
  role,
  cadence,
  mission,
  controls,
}: {
  role: string
  cadence: string
  mission: string
  controls: string[]
}) {
  return (
    <article className={cardClass}>
      <div className={cardHeaderClass}>
        <span>{role}</span>
        <span className='text-hlpDim'>{cadence}</span>
      </div>
      <div className='space-y-2 p-3'>
        <p className='text-[11px] leading-relaxed text-hlpFg'>{mission}</p>
        <ul className='space-y-1 text-[10px] text-hlpMuted'>
          {controls.map((control) => (
            <li key={`${role}-${control}`} className='border border-hlpBorder bg-hlpSurface/40 px-2 py-1'>
              {control}
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

export default function CrewPage() {
  return (
    <>
      <AsciiBackground />
      <main className={pageShellClass}>
        <section className='rounded-[6px] border border-hlpBorder bg-hlpInverseBg px-4 py-5 md:px-6'>
          <div className='text-[9px] uppercase tracking-[0.2em] text-hlpPanel/70'>Crew setup</div>
          <h1 className='mt-2 text-[30px] leading-tight text-hlpPanel'>[HL] PRIVATEER — Crew Architecture</h1>
          <p className='mt-3 max-w-4xl text-sm leading-relaxed text-hlpPanel/80'>
            The production stack now lets every agent decide its own directional mode (long/short/pair) while
            preserving strict constraints from the runtime risk gate and operational safety framework.
          </p>
          <div className='mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]'>
            <Link
              href='/data'
              className='inline-flex items-center border border-hlpPanel bg-hlpPanel px-3 py-2 text-hlpBg transition-colors hover:bg-hlpSurface'
            >
              View floor telemetry
            </Link>
            <Link
              href='/tape'
              className='inline-flex items-center border border-hlpPanel/50 bg-hlpPanel/20 px-3 py-2 transition-colors hover:bg-hlpPanel/40'
            >
              Open tape stream
            </Link>
          </div>
        </section>

        <section className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
          {CREW_ROLES.map((entry) => (
            <RoleCard
              key={entry.role}
              role={entry.role}
              cadence={entry.cadence}
              mission={entry.mission}
              controls={entry.controls}
            />
          ))}
        </section>

        <section className={cardClass}>
          <div className={cardHeaderClass}>Crew telemetry and observability</div>
          <div className='grid gap-2 p-3 sm:grid-cols-2'>
            {TELEMETRY_PILLARS.map((item) => (
              <div key={item} className='rounded-[3px] border border-hlpBorder bg-hlpSurface/40 px-2 py-2 text-[11px]'>
                {item}
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  )
}
