import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import { crewLabel, type CrewHeartbeat, type CrewRole, type CrewStats, formatAge, formatTime, heartbeatLevel, floorHeartbeatGlyph, type TapeEntry } from './floor-dashboard'
import { cardClass, sectionTitleClass } from './ascii-style'

type CrewLast = Record<CrewRole, TapeEntry | null>

type CrewStationsPanelProps = {
  crewLast: CrewLast
  crewHeartbeat: CrewHeartbeat
  crewSignals: CrewStats
  nowMs: number
}

export function CrewStationsPanel({ crewLast, crewHeartbeat, crewSignals, nowMs }: CrewStationsPanelProps) {
  const getActivityWidth = (beatScore: number) => `${Math.max(0, Math.min(100, Math.round(beatScore / 10) * 10))}%`
  return (
    <AsciiCard
      className={cardClass}
    >
      <div className='flex items-center justify-between border-b border-[var(--border)] px-3 py-2'>
        <div className={sectionTitleClass}>CREW STATIONS</div>
        <AsciiBadge color='success' className='text-[var(--positive)]'>7 AGENTS</AsciiBadge>
      </div>
      <div className='grid grid-cols-1 gap-1 p-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
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

          const normalizedLevel = level.toLowerCase()
          return (
            <div
              className={`overflow-hidden border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg-surface)] transition-colors transition-shadow ${active ? 'border-[var(--border-active)] shadow-[0_0_10px_color-mix(in_srgb,_var(--positive)_12%,_transparent)]' : ''}`}
              key={role}
            >
              <div className='flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5'>
                <span className='text-[10px] font-bold tracking-[0.22em] text-[var(--fg)]'>{crewLabel(role)}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[var(--positive)] shadow-[0_0_3px_color-mix(in_srgb,_var(--positive)_35%,_transparent)] animate-[led-pulse_2.5s_ease-in-out_infinite]' : 'bg-[var(--fg-dim)]'}`}
                />
              </div>
              <div className='px-2 py-1.5'>
                <span
                  className={`text-[8px] uppercase tracking-[0.12em] ${
                    normalizedLevel === 'warn'
                      ? 'text-[var(--amber)]'
                      : normalizedLevel === 'error'
                        ? 'text-[var(--negative)]'
                        : 'text-[var(--fg-muted)]'
                  }`}
                >
                  {level}
                </span>
                <div className='mt-1 flex items-center gap-1.5'>
                  <span className='relative h-1 w-full min-w-0 border border-[var(--border)] rounded-sm overflow-hidden' aria-hidden='true'>
                    <span
                      className='absolute inset-0 bg-gradient-to-r from-[color-mix(in_srgb,_var(--positive)_55%,_transparent)] to-[color-mix(in_srgb,_var(--amber)_50%,_transparent)]'
                      style={{ width: getActivityWidth(beatScore) }}
                    />
                  </span>
                  <span className='text-[9px] w-12 text-right text-[var(--fg-muted)] flex-shrink-0'>
                    {heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)}
                  </span>
                </div>
                <div className='mt-1 text-[11px] overflow-hidden whitespace-nowrap text-ellipsis text-[var(--fg)]'>
                  {heartbeatGlyph} {line}
                </div>
                <div className='mt-1 overflow-hidden whitespace-nowrap text-ellipsis text-[9px] tracking-[0.15em] text-[var(--fg-muted)] flex items-center gap-1'>
                  <span className='text-[10px]'>{active ? '◉' : '◌'}</span>
                  heartbeat {pulse}
                </div>
              </div>
              <div className='flex items-center justify-between border-t border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)]'>
                <span>{last?.ts ? formatTime(last.ts) : '—'}</span>
                <span className='whitespace-nowrap'>events {crewSignals[role]}</span>
              </div>
            </div>
          )
        })}
      </div>
    </AsciiCard>
  )
}
