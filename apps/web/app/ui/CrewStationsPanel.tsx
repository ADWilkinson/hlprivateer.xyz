import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import { crewLabel, type CrewHeartbeat, type CrewRole, type CrewStats, formatAge, formatTime, heartbeatLevel, floorHeartbeatGlyph, type TapeEntry } from './floor-dashboard'

type CrewLast = Record<CrewRole, TapeEntry | null>

type CrewStationsPanelProps = {
  crewLast: CrewLast
  crewHeartbeat: CrewHeartbeat
  crewSignals: CrewStats
  nowMs: number
}

export function CrewStationsPanel({ crewLast, crewHeartbeat, crewSignals, nowMs }: CrewStationsPanelProps) {
  return (
    <AsciiCard title='CREW STATIONS' className='panel-card' style={{ padding: 0, backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border)' }}>
      <div className='section-bar'>
        <div className='section-label'>CREW STATIONS</div>
        <AsciiBadge color='success'>7 AGENTS</AsciiBadge>
      </div>
      <div className='crew-grid'>
        {(Object.keys(crewHeartbeat) as CrewRole[]).map((role) => {
          const last = crewLast[role]
          const lastMs = last?.ts ? Date.parse(last.ts) : 0
          const active = lastMs > 0 && nowMs - lastMs < 90_000
          const heartbeatMs = crewHeartbeat[role] ? nowMs - crewHeartbeat[role] : Number.POSITIVE_INFINITY
          const beatScore = heartbeatLevel(crewHeartbeat[role], nowMs)
          const line = last?.line || '…'
          const level = last?.level ?? 'INFO'
          const heartbeatGlyph = floorHeartbeatGlyph(beatScore)
          const heartbeatBeat = Math.max(0, Math.round((beatScore / 20)))
          const pulse = `${'◉'.repeat(Math.min(heartbeatBeat, 5)).padEnd(5, '◌')}`

          return (
            <div className={`agent-term ${active ? 'active' : ''}`} key={role}>
              <div className='agent-bar'>
                <span className='agent-name'>{crewLabel(role)}</span>
                <span className={`agent-led ${active ? 'on' : 'off'}`} />
              </div>
              <div className='agent-body'>
                <span className={`agent-level ${level.toLowerCase()}`}>{level}</span>
                <div className='agent-activity'>
                  <span className='agent-activity-bar' aria-hidden='true'>
                    <span className='agent-activity-fill' style={{ width: `${beatScore}%` }} />
                  </span>
                  <span className='agent-activity-age'>{heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)}</span>
                </div>
                <div className='agent-msg'>{heartbeatGlyph} {line}</div>
                <div className='crew-body-pulse'>
                  <span className='agent-heat'>
                    <span className='agent-heat-bulb'>{active ? '◉' : '◌'}</span>
                    heartbeat {pulse}
                  </span>
                </div>
              </div>
              <div className='agent-ts'>
                <span>{last?.ts ? formatTime(last.ts) : '—'}</span>
                <span className='agent-heartbeat-text'>events {crewSignals[role]}</span>
              </div>
            </div>
          )
        })}
      </div>
    </AsciiCard>
  )
}
