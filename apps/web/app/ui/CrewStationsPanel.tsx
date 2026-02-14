import { AsciiBadge } from './ascii-kit'
import {
  crewLabel,
  type CrewHeartbeat,
  type CrewRole,
  type CrewStats,
  formatAge,
  formatTime,
  floorHeartbeatGlyph,
  heartbeatLevel,
  type TapeEntry,
} from './floor-dashboard'
import {
  cardClass,
  cardHeaderClass,
  inlineBadgeClass,
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
  execution: 'Execution routing',
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
  ops: 'state bus',
}

const loadingSkeletonWidth: Record<CrewRole, string> = {
  scout: 'w-40',
  research: 'w-36',
  strategist: 'w-44',
  execution: 'w-40',
  risk: 'w-36',
  scribe: 'w-38',
  ops: 'w-32',
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
        <AsciiBadge tone='positive' className='text-hlpPositive dark:text-hlpPositiveDark'>
          {isLoading ? 'BOOTING...' : '7 AGENTS'}
        </AsciiBadge>
      </div>

      <div className={`grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 ${panelBodyPad}`}>
        {roles.map((role) => {
          const last = isLoading ? null : crewLast[role]
          const lastMs = last?.ts ? Date.parse(last.ts) : 0
          const active = !isLoading && lastMs > 0 && nowMs - lastMs < 90_000
          const heartbeatMs = isLoading || !crewHeartbeat[role] ? Number.POSITIVE_INFINITY : nowMs - crewHeartbeat[role]
          const beatScore = isLoading ? 20 : heartbeatLevel(crewHeartbeat[role], nowMs)
          const line = isLoading ? 'initializing route...' : last?.line || '…'
          const level = isLoading ? 'INFO' : last?.level ?? 'INFO'
          const nextGate = roleGate[role]
          const lane = roleLane[role]
          const nextGateLabel = nextGate.includes('->') ? `route: ${nextGate}` : `route: ${nextGate}`
          const statusLabel = beatScore > 75 ? 'active' : beatScore > 35 ? 'idle' : beatScore > 0 ? 'warming' : 'offline'
          const normalizedLevel = level.toLowerCase()
          const heartbeatPulse = `${'◉'.repeat(Math.min(Math.max(0, Math.round(beatScore / 20)), 5)).padEnd(5, '◌')}`

          return (
            <article
              className={`${monitorClass} min-h-[190px] transition-colors ${
                active
                  ? 'border-hlpPositive/70 dark:border-hlpPositiveDark/70 bg-hlpPanel/95 dark:bg-hlpPanelDark/95'
                  : 'border-hlpBorder dark:border-hlpBorderDark'
              }`}
              key={role}
            >
              <div className={`flex items-center justify-between border-b border-hlpBorder dark:border-hlpBorderDark ${panelInsetPad}`}>
                <div className='flex min-w-0 items-start gap-1.5'>
                  <span className='text-[10px] font-bold tracking-[0.22em]'>{crewLabel(role)}</span>
                  {isLoading ? (
                    <span className={`h-4 w-24 rounded-sm ${skeletonPulseClass}`} />
                  ) : (
                    <span
                      className={`rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/70 dark:bg-hlpSurfaceDark/55 ${panelInsetPad} text-[7px] uppercase leading-tight tracking-[0.14em] text-hlpMuted dark:text-hlpMutedDark break-words`}
                    >
                      {lane}
                    </span>
                  )}
                </div>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isLoading
                      ? 'bg-hlpMuted dark:bg-hlpMutedDark'
                      : active
                        ? 'bg-hlpPositive dark:bg-hlpPositiveDark shadow-[0_0_4px_rgba(47,139,103,0.45)] dark:shadow-[0_0_4px_rgba(86,207,173,0.45)] animate-hlp-led'
                        : 'bg-hlpMuted dark:bg-hlpMutedDark'
                  }`}
                />
              </div>

              <div className={panelBodyPad}>
                {isLoading ? (
                  <span className={`inline-block rounded-sm ${loadingSkeletonWidth[role]} h-3 ${skeletonPulseClass}`} />
                ) : (
                  <span
                    className={`text-[8px] uppercase tracking-[0.12em] ${
                      normalizedLevel === 'warn'
                        ? 'text-hlpWarning dark:text-hlpWarningDark'
                        : normalizedLevel === 'error'
                          ? 'text-hlpNegative dark:text-hlpNegativeDark'
                          : 'text-hlpMuted dark:text-hlpMutedDark'
                    }`}
                  >
                    {level}
                  </span>
                )}

                <div className='mt-1 flex items-center gap-1.5'>
                  <span className='relative h-1 w-full min-w-0 border border-hlpBorder dark:border-hlpBorderDark rounded-sm overflow-hidden' aria-hidden='true'>
                    {isLoading ? (
                      <span className={`absolute inset-y-0 left-0 rounded-sm ${skeletonPulseClass}`} style={{ width: '58%' }} />
                    ) : (
                      <span
                        className='absolute inset-y-0 left-0 bg-gradient-to-r from-hlpPositive dark:from-hlpPositiveDark to-hlpPositive/60 dark:to-hlpPositiveDark/60'
                        style={{ width: getActivityWidth(beatScore) }}
                      />
                    )}
                  </span>
                  <span className='w-12 flex-shrink-0 text-right text-[9px] text-hlpMuted dark:text-hlpMutedDark'>
                    {heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)}
                  </span>
                </div>

                <div className='mt-1 overflow-hidden text-[11px] break-words' title={line}>
                  {isLoading ? (
                    <span className={`inline-block h-3 w-full max-w-[160px] rounded-sm ${skeletonPulseClass}`} />
                  ) : (
                    <>
                      {floorHeartbeatGlyph(beatScore)} {line}
                    </>
                  )}
                </div>

                <div className='mt-1 flex items-center gap-1 overflow-hidden text-[9px] tracking-[0.15em] text-hlpMuted dark:text-hlpMutedDark'>
                  <span className='text-[10px]'>{active ? '◉' : isLoading ? '◌' : '◌'}</span>
                  {isLoading ? 'heartbeats booting' : `heartbeat ${heartbeatPulse} · ${statusLabel}`}
                </div>
                <div className='mt-1 text-[8px] uppercase leading-snug tracking-[0.14em] break-words text-hlpMuted dark:text-hlpMutedDark'>
                  {isLoading ? <span className={`inline-block h-3 w-28 rounded-sm ${skeletonPulseClass}`} /> : <span title={nextGateLabel}>{nextGateLabel}</span>}
                </div>
              </div>

              <div
                className={`flex flex-wrap items-center justify-between gap-1 border-t border-hlpBorder dark:border-hlpBorderDark ${panelInsetPad} text-[9px] text-hlpMuted dark:text-hlpMutedDark`}
              >
                <span>{isLoading ? <span className={`inline-block h-3 w-14 rounded-sm ${skeletonPulseClass}`} /> : last?.ts ? formatTime(last.ts) : '—'}</span>
                <span>events {isLoading ? '—' : crewSignals[role]}/max {maxSignals}</span>
              </div>

              <div className={`flex flex-wrap gap-1 ${panelInsetPad}`}>
                {isLoading ? (
                  <>
                    <span className={`h-5 w-24 rounded-sm ${skeletonPulseClass}`} />
                    <span className={`h-5 w-28 rounded-sm ${skeletonPulseClass}`} />
                  </>
                ) : (
                  <>
                    <span className={inlineBadgeClass}>
                      <span className='uppercase tracking-[0.2em] text-[8px]'>last command</span>
                    </span>
                    <span className={inlineBadgeClass}>
                      <span className='uppercase tracking-[0.2em] text-[8px]'>{active ? 'live lane' : 'offline lane'}</span>
                    </span>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
