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
    <AsciiCard title='FLOOR PLAN' className='panel-card' style={{ padding: 0, backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border)' }}>
      <div className='section-bar'>
        <div className='section-label'>FLOOR PLAN</div>
        <AsciiBadge color='success'>live telemetry</AsciiBadge>
      </div>
      <div className='ascii-floor-plan-wrap'>
        <pre className='ascii-floor-plan' aria-label='trading floor map'>
          {asciiCrewMap(crewHeartbeat, nowMs)}
        </pre>
      </div>
      <div className='plan-meta'>
        <span className={`plan-meta-item ${deckFeedAgeMs > 0 ? 'warn' : ''}`}>deck status feedAge: {deckFeedAgeMs || '--'}ms</span>
        <span className='plan-meta-item'>missing feeds: {deckMissing}</span>
        <span className='plan-meta-item'>heartbeat: {formatAge(Date.now() - deckHeartbeatMs)}</span>
        <span className='plan-meta-item'>topology: {Object.keys(crewHeartbeat).length} stations</span>
      </div>
    </AsciiCard>
  )
}
