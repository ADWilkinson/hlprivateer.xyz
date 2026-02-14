import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import { asciiCrewMap, type CrewHeartbeat, type CrewRole, formatAge } from './floor-dashboard'

type FloorPlanPanelProps = {
  crewHeartbeat: CrewHeartbeat
  nowMs: number
  deckFeedAgeMs: number
  deckMissing: number
  deckHeartbeatMs: number
}

export function FloorPlanPanel({
  crewHeartbeat,
  nowMs,
  deckFeedAgeMs,
  deckMissing,
  deckHeartbeatMs,
}: FloorPlanPanelProps) {
  return (
    <AsciiCard
      title='FLOOR PLAN'
      className='border border-[var(--border)] bg-[var(--bg-raised)] rounded-[var(--r)] shadow-[var(--panel-shadow)] text-[var(--fg)]'
    >
      <div className='flex items-center justify-between border-b border-[var(--border)] px-3 py-2'>
        <div className='text-[9px] uppercase tracking-[0.25em] text-[var(--fg-muted)]'>FLOOR PLAN</div>
        <AsciiBadge color='success'>live telemetry</AsciiBadge>
      </div>
      <div className='w-full overflow-x-auto'>
        <pre className='m-0 min-w-full whitespace-pre px-3 py-1.5 text-[11px] leading-[1.2] text-[var(--fg)]' aria-label='trading floor map'>
          {asciiCrewMap(crewHeartbeat, nowMs)}
        </pre>
      </div>
      <div className='flex flex-wrap gap-1.5 border-t border-[var(--border)] px-3 py-2'>
        <span className={`border border-[var(--border)] px-2 py-1 text-[9px] ${deckFeedAgeMs > 0 ? 'text-[var(--negative)]' : 'text-[var(--fg-muted)]'}`}>deck status feedAge: {deckFeedAgeMs || '--'}ms</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)]'>missing feeds: {deckMissing}</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)]'>heartbeat: {formatAge(Date.now() - deckHeartbeatMs)}</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)]'>topology: {Object.keys(crewHeartbeat).length} stations</span>
      </div>
    </AsciiCard>
  )
}
