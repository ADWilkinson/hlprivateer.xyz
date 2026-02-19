import type { TapeEntry, CrewRole } from './floor-dashboard'
import { formatTime, formatAge, crewLabel } from './floor-dashboard'
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
import { AsciiBadge } from './ascii-kit'

const INTEL_ROLES: CrewRole[] = ['research', 'risk', 'strategist', 'scribe']

const roleIcon: Record<string, string> = {
  research: '\u25CE',
  risk: '\u25A0',
  strategist: '\u25C6',
  scribe: '\u25CB',
}

const roleDescription: Record<string, string> = {
  research: 'Regime + signal context',
  risk: 'Posture + policy rules',
  strategist: 'Playbook + sizing',
  scribe: 'Decision rationale',
}

type IntelligencePanelProps = {
  crewLast: Record<string, TapeEntry | null>
  nowMs: number
  isLoading?: boolean
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
}

function RiskLine({ line }: { line: string }) {
  const match = /\b(AMBER|GREEN|RED)\b/i.exec(line)
  if (!match) return <>{line}</>
  const posture = match[0].toUpperCase()
  const color = posture === 'GREEN' ? 'text-hlpHealthy' : posture === 'RED' ? 'text-hlpNegative' : 'text-hlpWarning'
  return (
    <>
      {line.slice(0, match.index)}
      <span className={`font-bold ${color}`}>{posture}</span>
      {line.slice(match.index + posture.length)}
    </>
  )
}

export function IntelligencePanel({
  crewLast,
  nowMs,
  isLoading = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'intelligence',
}: IntelligencePanelProps) {
  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle intelligence panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className={sectionTitleClass}>INTELLIGENCE</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>{isCollapsed ? '+' : '-'}</span>
          <AsciiBadge tone='inverse'>4 ROLES</AsciiBadge>
        </div>
      </button>

      <div id={`section-${sectionId}`} hidden={isCollapsed}>
        {!isCollapsed && (
          <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${panelBodyPad}`}>
            {INTEL_ROLES.map((role) => {
              const last = isLoading ? null : crewLast[role]
              const level = last?.level ?? 'INFO'
              const line = isLoading ? 'loading...' : (last?.line ?? 'awaiting first cycle...')
              const ageMs = last?.ts ? nowMs - Date.parse(last.ts) : null
              const levelClass =
                level === 'WARN'
                  ? 'text-hlpWarning'
                  : level === 'ERROR'
                    ? 'text-hlpNegative'
                    : 'text-hlpDim'

              return (
                <article
                  key={role}
                  className={`${monitorClass} border border-hlpBorder`}
                >
                  <div className={`flex items-center justify-between border-b border-hlpBorder ${panelInsetPad}`}>
                    <div className='flex items-center gap-1.5'>
                      <span className='text-[11px] text-hlpDim'>{roleIcon[role]}</span>
                      <div>
                        <div className='text-[10px] font-bold tracking-[0.18em]'>{crewLabel(role as CrewRole)}</div>
                        <div className='text-[8px] uppercase tracking-[0.14em] text-hlpDim'>{roleDescription[role]}</div>
                      </div>
                    </div>
                    <span className={`text-[8px] uppercase tracking-[0.14em] ${levelClass}`}>{level}</span>
                  </div>

                  <div className={`${panelBodyPad} min-h-[64px]`}>
                    {isLoading ? (
                      <span className={`inline-block h-3 w-full ${skeletonPulseClass}`} />
                    ) : (
                      <p className='text-[10px] leading-relaxed text-hlpMuted break-words'>
                        {role === 'risk' ? <RiskLine line={line} /> : line}
                      </p>
                    )}
                  </div>

                  <div className={`flex items-center justify-between border-t border-hlpBorder ${panelInsetPad} text-[8px] text-hlpDim`}>
                    <span>{last?.ts ? formatTime(last.ts) : '--:--:--'}</span>
                    <span>{ageMs !== null && ageMs >= 0 ? `${formatAge(ageMs)} ago` : '--'}</span>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
