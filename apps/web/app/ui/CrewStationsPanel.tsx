import { AsciiBadge } from './ascii-kit'
import {
  crewLabel,
  type CrewHeartbeat,
  type CrewRole,
  type CrewStats,
  formatAge,
  formatTime,
  heartbeatLevel,
  type TapeEntry,
} from './floor-dashboard'
import {
  cardClass,
  cardHeaderClass,
  monitorClass,
  panelBodyPad,
  panelInsetPad,
  sectionTitleClass,
  skeletonPulseClass,
} from './ascii-style'

type CrewLast = Record<CrewRole, TapeEntry | null>

type CrewStationsPanelProps = {
  crewLast: CrewLast
  crewHeartbeat: CrewHeartbeat
  crewSignals: CrewStats
  nowMs: number
  isLoading?: boolean
}

  const roleLane: Record<CrewRole, string> = {
  scout: 'Market scanning',
  research: 'Signal validation',
  strategist: 'Playbook synthesis',
  execution: 'Execution control',
  risk: 'Exposure guardrails',
  scribe: 'Action ledger',
  ops: 'Global coordination',
}

const roleGate: Record<CrewRole, string> = {
  scout: 'feeds -> research',
  research: 'research -> strategist',
  strategist: 'signals -> execution',
  execution: 'orders -> scribe',
  risk: 'risk checks',
  scribe: 'decisions -> archive',
  ops: 'state channel',
}

export function CrewStationsPanel({
  crewLast,
  crewHeartbeat,
  crewSignals,
  nowMs,
  isLoading = false,
}: CrewStationsPanelProps) {
  const getActivityWidth = (beatScore: number) => `${Math.max(0, Math.min(100, Math.round(beatScore / 10) * 10))}%`
  const roles = Object.keys(crewHeartbeat) as CrewRole[]

  const maxSignals = Math.max(...roles.map((role) => crewSignals[role])) || 1

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span className={sectionTitleClass}>CREW STATIONS</span>
        <AsciiBadge tone='neutral'>
          {isLoading ? 'BOOTING' : '7 AGENTS'}
        </AsciiBadge>
      </div>

      <div className={`grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 ${panelBodyPad}`}>
        {roles.map((role) => {
          const last = isLoading ? null : crewLast[role]
          const lastMs = last?.ts ? Date.parse(last.ts) : 0
          const active = !isLoading && lastMs > 0 && nowMs - lastMs < 90_000
          const heartbeatMs = isLoading || !crewHeartbeat[role] ? Number.POSITIVE_INFINITY : nowMs - crewHeartbeat[role]
          const beatScore = isLoading ? 20 : heartbeatLevel(crewHeartbeat[role], nowMs)
          const line = isLoading ? 'initializing stream...' : last?.line || '…'
          const level = isLoading ? 'INFO' : last?.level ?? 'INFO'
          const nextGate = roleGate[role]
          const lane = roleLane[role]
          const nextGateLabel = nextGate.includes('->') ? `next: ${nextGate}` : `next: ${nextGate}`
          const statusLabel = beatScore > 75 ? 'active' : beatScore > 35 ? 'idle' : beatScore > 0 ? 'warming' : 'offline'
          const normalizedLevel = level.toLowerCase()
          const heartbeatPulse = `${'◉'.repeat(Math.min(Math.max(0, Math.round(beatScore / 20)), 5)).padEnd(5, '◌')}`

          return (
            <article
              className={`${monitorClass} min-h-[206px] border border-hlpBorder/65 transition-colors ${active ? 'bg-hlpPanel/95' : 'bg-hlpSurface'}`}
              key={role}
            >
              <div className={`${panelInsetPad} space-y-1 border-b border-hlpBorder/45`}>
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <div className='text-[10px] font-bold tracking-[0.22em]'>{crewLabel(role)}</div>
                    {isLoading ? (
                      <span className='mt-1 inline-block h-3 w-24 rounded-sm bg-hlpSurface/80' />
                    ) : (
                      <div className='mt-1 break-words text-[8px] uppercase tracking-[0.18em] text-hlpMuted'>{lane}</div>
                    )}
                  </div>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isLoading
                        ? 'bg-hlpMuted'
                        : active
                          ? 'bg-hlpHealthy animate-hlp-led'
                          : 'bg-hlpMuted'
                    }`}
                  />
                </div>
                <div className='text-[8px] uppercase tracking-[0.16em] text-hlpMuted'>{isLoading ? 'booting' : statusLabel}</div>
              </div>

              <div className={`${panelBodyPad} space-y-1.5`}>
                {isLoading ? (
                  <span className='inline-block h-3 w-20 rounded-sm bg-hlpSurface/80' />
                ) : (
                  <span
                    className={`text-[8px] uppercase tracking-[0.12em] ${
                      normalizedLevel === 'warn'
                        ? 'text-hlpWarning'
                        : normalizedLevel === 'error'
                          ? 'text-hlpNegative'
                          : 'text-hlpMuted'
                    }`}
                  >
                    {level}
                  </span>
                )}

                <div className='h-2 w-full rounded-sm bg-hlpSurface/75 overflow-hidden' aria-hidden='true'>
                  {isLoading ? <span className={`block h-full rounded-sm ${skeletonPulseClass}`} style={{ width: '58%' }} /> : null}
                  {!isLoading ? (
                    <span
                      className='block h-full rounded-sm bg-hlpHealthy/85'
                      style={{ width: getActivityWidth(beatScore) }}
                    />
                  ) : null}
                </div>

                <div className='flex flex-wrap items-center justify-between gap-1 text-[9px] tracking-[0.15em] text-hlpMuted'>
                  <span className='font-mono text-[9px]'>{heartbeatPulse}</span>
                  <span>{isLoading ? 'heartbeat booting' : heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)}</span>
                </div>

                <div className='min-h-10 overflow-hidden text-[11px] break-words leading-snug' title={line}>
                  {isLoading ? <span className={`inline-block h-3 w-full rounded-sm ${skeletonPulseClass}`} /> : <span>{line}</span>}
                </div>

                <div className='text-[8px] border-b border-hlpBorder/35 pb-1 uppercase leading-snug tracking-[0.14em] break-words text-hlpMuted'>
                  {isLoading ? <span className={`inline-block h-3 w-full rounded-sm ${skeletonPulseClass}`} /> : <span>{nextGateLabel}</span>}
                </div>
              </div>

              <div className={`mt-auto flex flex-wrap items-center justify-between ${panelInsetPad} text-[9px] text-hlpMuted`}>
                <span>{isLoading ? <span className={`inline-block h-3 w-24 rounded-sm ${skeletonPulseClass}`} /> : last?.ts ? formatTime(last.ts) : '—'}</span>
                <span>events {isLoading ? '—' : crewSignals[role]}/max {maxSignals}</span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
