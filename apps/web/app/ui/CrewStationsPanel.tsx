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
  collapsibleHeaderClass,
  inverseControlClass,
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
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
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

const roleIcon: Record<CrewRole, string> = {
  scout: '\u25C8',
  research: '\u25CE',
  strategist: '\u25C6',
  execution: '\u25B6',
  risk: '\u25A0',
  scribe: '\u25CB',
  ops: '\u2726',
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
  isCollapsed = false,
  onToggle,
  sectionId = 'crew',
}: CrewStationsPanelProps) {
  const getActivityWidth = (beatScore: number) => `${Math.max(0, Math.min(100, Math.round(beatScore / 10) * 10))}%`
  const roles = Object.keys(crewHeartbeat) as CrewRole[]
  const maxSignals = Math.max(...roles.map((role) => crewSignals[role])) || 1

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle crew stations panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className={sectionTitleClass}>CREW STATIONS</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>
            {isCollapsed ? '+' : '\u2212'}
          </span>
          <AsciiBadge tone='inverse'>{isLoading ? 'BOOTING' : '7 AGENTS'}</AsciiBadge>
        </div>
      </button>

      {!isCollapsed && (
        <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${panelBodyPad}`}>
          {roles.map((role) => {
            const last = isLoading ? null : crewLast[role]
            const lastMs = last?.ts ? Date.parse(last.ts) : 0
            const active = !isLoading && lastMs > 0 && nowMs - lastMs < 90_000
            const heartbeatMs = isLoading || !crewHeartbeat[role] ? Number.POSITIVE_INFINITY : nowMs - crewHeartbeat[role]
            const beatScore = isLoading ? 20 : heartbeatLevel(crewHeartbeat[role], nowMs)
            const line = isLoading ? 'initializing stream...' : last?.line || '\u2026'
            const level = isLoading ? 'INFO' : last?.level ?? 'INFO'
            const lane = roleLane[role]
            const icon = roleIcon[role]
            const nextGate = roleGate[role]
            const statusLabel = beatScore > 75 ? 'active' : beatScore > 35 ? 'idle' : beatScore > 0 ? 'warming' : 'offline'
            const normalizedLevel = level.toLowerCase()
            const heartbeatPulse = `${'\u25C9'.repeat(Math.min(Math.max(0, Math.round(beatScore / 20)), 5)).padEnd(5, '\u25CC')}`

            return (
              <article
                className={`${monitorClass} min-h-[180px] border border-hlpBorder transition-colors ${active ? 'bg-hlpPanel/95' : 'bg-hlpSurface'}`}
                key={role}
              >
                <div className={`${panelInsetPad} space-y-1 border-b border-hlpBorder`}>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0 flex items-center gap-1.5'>
                      <span className='text-[12px] text-hlpDim'>{icon}</span>
                      <div>
                        <div className='text-[10px] font-bold tracking-[0.22em]'>{crewLabel(role)}</div>
                        {isLoading ? (
                          <span className='mt-0.5 inline-block h-3 w-20 rounded-sm bg-hlpSurface/80' />
                        ) : (
                          <div className='mt-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpDim'>{lane}</div>
                        )}
                      </div>
                    </div>
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        isLoading
                          ? 'bg-hlpMuted'
                          : active
                            ? 'bg-hlpHealthy animate-hlp-led'
                            : 'bg-hlpMuted'
                      }`}
                    />
                  </div>
                  <div className='text-[8px] uppercase tracking-[0.16em] text-hlpDim'>{isLoading ? 'booting' : statusLabel}</div>
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
                            : 'text-hlpDim'
                      }`}
                    >
                      {level}
                    </span>
                  )}

                  <div className='h-1.5 w-full rounded-full bg-hlpSurface/75 overflow-hidden' aria-hidden='true'>
                    {isLoading ? <span className={`block h-full rounded-full ${skeletonPulseClass}`} style={{ width: '58%' }} /> : null}
                    {!isLoading ? (
                      <span
                        className='block h-full rounded-full bg-hlpHealthy/80 transition-all duration-500'
                        style={{ width: getActivityWidth(beatScore) }}
                      />
                    ) : null}
                  </div>

                  <div className='flex flex-wrap items-center justify-between gap-1 text-[9px] tracking-[0.12em] text-hlpDim'>
                    <span className='font-mono text-[9px]'>{heartbeatPulse}</span>
                    <span>{isLoading ? 'booting' : heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)}</span>
                  </div>

                  <div className='min-h-8 overflow-hidden text-[10px] break-words leading-snug text-hlpMuted' title={line}>
                    {isLoading ? <span className={`inline-block h-3 w-full rounded-sm ${skeletonPulseClass}`} /> : <span>{line}</span>}
                  </div>

                  <div className='text-[8px] uppercase tracking-[0.12em] text-hlpDim/70'>
                    {isLoading ? <span className={`inline-block h-3 w-full rounded-sm ${skeletonPulseClass}`} /> : <span>{nextGate}</span>}
                  </div>
                </div>

                <div className={`mt-auto flex flex-wrap items-center justify-between border-t border-hlpBorder ${panelInsetPad} text-[8px] text-hlpDim`}>
                  <span>{isLoading ? <span className={`inline-block h-3 w-20 rounded-sm ${skeletonPulseClass}`} /> : last?.ts ? formatTime(last.ts) : '--'}</span>
                  <span>events {isLoading ? '--' : crewSignals[role]}/{maxSignals}</span>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
