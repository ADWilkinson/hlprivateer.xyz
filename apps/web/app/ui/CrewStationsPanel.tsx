import { AsciiBadge } from 'react-ascii-ui'
import { crewLabel, type CrewHeartbeat, type CrewRole, type CrewStats, formatAge, formatTime, heartbeatLevel, floorHeartbeatGlyph, type TapeEntry } from './floor-dashboard'
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionTitleClass, statusCellClass } from './ascii-style'

type CrewLast = Record<CrewRole, TapeEntry | null>

type CrewStationsPanelProps = {
  crewLast: CrewLast
  crewHeartbeat: CrewHeartbeat
  crewSignals: CrewStats
  nowMs: number
}

export function CrewStationsPanel({ crewLast, crewHeartbeat, crewSignals, nowMs }: CrewStationsPanelProps) {
  const getActivityWidth = (beatScore: number) => `${Math.max(0, Math.min(100, Math.round(beatScore / 10) * 10))}%`
  const roles = Object.keys(crewHeartbeat) as CrewRole[]

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span className={sectionTitleClass}>CREW STATIONS</span>
        <AsciiBadge color='success' className='text-hlpPositive dark:text-hlpPositiveDark'>
          7 AGENTS
        </AsciiBadge>
      </div>

      <div className='grid grid-cols-1 gap-1 p-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
        {roles.map((role) => {
          const last = crewLast[role]
          const lastMs = last?.ts ? Date.parse(last.ts) : 0
          const active = lastMs > 0 && nowMs - lastMs < 90_000
          const heartbeatMs = crewHeartbeat[role] ? nowMs - crewHeartbeat[role] : Number.POSITIVE_INFINITY
          const beatScore = heartbeatLevel(crewHeartbeat[role], nowMs)
          const line = last?.line || '…'
          const level = last?.level ?? 'INFO'

          const normalizedLevel = level.toLowerCase()
          const heartbeatPulse = `${'◉'.repeat(Math.min(Math.round(beatScore / 20), 5)).padEnd(5, '◌')}`

          return (
            <div
              className={`overflow-hidden border rounded-hlp ${statusCellClass} transition-colors ${
                active
                  ? 'border-hlpPositive/70 dark:border-hlpPositiveDark/70 bg-hlpPanel dark:bg-hlpPanelDark'
                  : 'border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel dark:bg-hlpPanelDark'
              }`}
              key={role}
            >
              <div className='flex items-center justify-between border-b border-hlpBorder dark:border-hlpBorderDark px-2 py-1.5'>
                <span className='text-[10px] font-bold tracking-[0.22em]'>{crewLabel(role)}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active
                      ? 'bg-hlpPositive dark:bg-hlpPositiveDark shadow-[0_0_4px_rgba(47,139,103,0.45)] dark:shadow-[0_0_4px_rgba(86,207,173,0.45)] animate-hlp-led'
                      : 'bg-hlpMuted dark:bg-hlpMutedDark'
                  }`}
                />
              </div>

              <div className='px-2 py-1.5'>
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

                <div className='mt-1 flex items-center gap-1.5'>
                  <span className='relative h-1 w-full min-w-0 border border-hlpBorder dark:border-hlpBorderDark rounded-sm overflow-hidden' aria-hidden='true'>
                    <span
                      className='absolute inset-y-0 left-0 bg-hlpPositive dark:bg-hlpPositiveDark'
                      style={{ width: getActivityWidth(beatScore) }}
                    />
                  </span>
                  <span className='w-12 flex-shrink-0 text-right text-[9px] text-hlpMuted dark:text-hlpMutedDark'>
                    {heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)}
                  </span>
                </div>

                <div className='mt-1 overflow-hidden whitespace-nowrap text-[11px]' title={line}>
                  {floorHeartbeatGlyph(beatScore)} {line}
                </div>

                <div className='mt-1 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[9px] tracking-[0.15em] text-hlpMuted dark:text-hlpMutedDark'>
                  <span className='text-[10px]'>{active ? '◉' : '◌'}</span>
                  heartbeat {heartbeatPulse}
                </div>
              </div>

              <div className='flex items-center justify-between border-t border-hlpBorder dark:border-hlpBorderDark px-2 py-1 text-[9px] text-hlpMuted dark:text-hlpMutedDark'>
                <span>{last?.ts ? formatTime(last.ts) : '—'}</span>
                <span className='whitespace-nowrap'>events {crewSignals[role]}</span>
              </div>

              <div className={inlineBadgeClass}>
                <span className='uppercase tracking-[0.2em] text-[8px]'>signal state</span>
              </div>
            </div>
          )
        })}
          </div>
    </section>
  )
}
