import { AsciiBadge, AsciiCard, AsciiNetworkVisualizer, AsciiTable } from 'react-ascii-ui'
import { ASCII_NETWORK_THEMES } from 'react-ascii-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CREW,
  HEARTBEAT_WINDOW_MS,
  crewLabel,
  formatAge,
  type CrewHeartbeat,
  type CrewRole,
} from './floor-dashboard'
import { cardClass, inlineBadgeClass, sectionTitleClass } from './ascii-style'

type CrewNode = {
  id: string
  label: string
  role: CrewRole
  ageText: string
  status: 'active' | 'stale' | 'silent'
  pulse: string
}

type FloorPlanPanelProps = {
  crewHeartbeat: CrewHeartbeat
  nowMs: number
  deckFeedAgeMs: number
  deckMissing: number
  deckHeartbeatMs: number
}

const floorNetworkTheme = {
  ...ASCII_NETWORK_THEMES.green,
  colors: {
    ...ASCII_NETWORK_THEMES.green.colors,
    background: 'var(--bg-surface)',
    grid: 'color-mix(in_srgb, var(--border) 60%, transparent)',
    text: 'var(--fg)',
    border: 'var(--border-active)',
    nodeOnline: 'var(--positive)',
    nodeOffline: 'var(--fg-muted)',
    nodeWarning: 'var(--amber)',
    nodeError: 'var(--negative)',
    edgeActive: 'var(--positive)',
    edgeInactive: 'var(--fg-dim)',
    edgeCongested: 'var(--amber)',
    edgeError: 'var(--negative)',
    selection: 'var(--fg)',
    hover: 'var(--fg)',
  },
} as const

function heartbeatStatus(lastMs: number, nowMs: number): { status: 'active' | 'stale' | 'silent'; pulse: string; label: string } {
  if (!lastMs) {
    return { status: 'silent', pulse: '◌◌◌◌◌', label: 'silent' }
  }

  const age = nowMs - lastMs
  if (age <= 5_000) return { status: 'active', pulse: '◉◉◉◉◉', label: 'active' }
  if (age <= HEARTBEAT_WINDOW_MS * 0.45) return { status: 'stale', pulse: '◍◍◍◌◌', label: 'stale' }
  return { status: 'silent', pulse: '◌◌◌◌◌', label: 'silent' }
}

function crewTableRows(crewHeartbeat: CrewHeartbeat, nowMs: number): CrewNode[] {
  return CREW.map((role) => {
    const lastPing = crewHeartbeat[role]
    const heartbeatMs = lastPing > 0 ? Math.max(0, nowMs - lastPing) : Number.POSITIVE_INFINITY
    const status = heartbeatStatus(lastPing, nowMs)
    return {
      id: role,
      label: crewLabel(role),
      role,
      ageText: Number.isFinite(heartbeatMs) ? (heartbeatMs === Number.POSITIVE_INFINITY ? 'offline' : formatAge(heartbeatMs)) : 'offline',
      status: status.label === 'active' ? 'active' : status.label === 'stale' ? 'stale' : 'silent',
      pulse: status.pulse,
    }
  })
}

export function FloorPlanPanel({
  crewHeartbeat,
  nowMs,
  deckFeedAgeMs,
  deckMissing,
  deckHeartbeatMs,
}: FloorPlanPanelProps) {
  const stationRows = useMemo(() => crewTableRows(crewHeartbeat, nowMs), [crewHeartbeat, nowMs])
  const heartbeatAgeMs = Math.max(0, nowMs - deckHeartbeatMs)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [networkWidth, setNetworkWidth] = useState(480)

  useEffect(() => {
    const updateWidth = () => {
      const fallback = typeof window === 'undefined' ? 480 : Math.min(window.innerWidth - 44, 620)
      const measured = mapRef.current?.clientWidth ?? fallback
      setNetworkWidth(Math.max(260, Math.min(620, measured)))
    }

    updateWidth()
    if (typeof window === 'undefined') return

    const resizeObserver = new ResizeObserver(() => {
      updateWidth()
    })
    if (mapRef.current) resizeObserver.observe(mapRef.current)
    window.addEventListener('resize', updateWidth)

    return () => {
      window.removeEventListener('resize', updateWidth)
      resizeObserver.disconnect()
    }
  }, [])

  const topology = useMemo(() => {
    const nodes = stationRows.map((row) => {
      return {
        id: row.id,
        label: row.label,
        type: row.role === 'ops' ? 'router' : 'workstation',
        status: row.status === 'active' ? 'online' : row.status === 'stale' ? 'warning' : 'offline',
        metadata: {
          role: row.role,
          heartbeat: row.ageText,
          pulse: row.pulse,
        },
      }
    })

    const edges = stationRows
      .filter((row) => row.role !== 'ops')
      .map((row) => ({
        id: `ops-${row.role}`,
        source: 'ops',
        target: row.id,
        type: 'api',
        status:
          crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS * 0.45 ? 'active' : 'congested',
        bidirectional: true,
        label: `link:${row.label}`,
      }))

    return {
      nodes,
      edges,
      metadata: {
        name: 'HL Trading Floor',
        description: 'Crew heartbeat topology',
      },
    }
  }, [crewHeartbeat, stationRows, nowMs])

  return (
    <AsciiCard className={cardClass}>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2'>
        <div>
          <div className={sectionTitleClass}>FLOOR PLAN</div>
          <div className='text-[11px] text-[var(--fg-muted)]'>TRADING FLOOR TOPOLOGY</div>
        </div>
        <AsciiBadge color='success' className='text-[var(--positive)]'>
          live telemetry
        </AsciiBadge>
      </div>
      <div className='grid grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(200px,_320px)_1fr]'>
        <div className='overflow-hidden rounded-[var(--r)] border border-[var(--border)]'>
          <div className='border-b border-[var(--border)] px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>
            STATION SIGNALS
          </div>
          <AsciiTable
            columns={[
              { key: 'label', header: 'STATION' },
              { key: 'status', header: 'STATUS', align: 'center' },
              { key: 'ageText', header: 'HEARTBEAT', align: 'right' },
              { key: 'pulse', header: 'PULSE', align: 'center' },
            ]}
            data={stationRows}
            className='text-[9px]'
          />
        </div>
        <div className='overflow-hidden rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg-surface)]'>
          <div className='border-b border-[var(--border)] px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>
            LIVE MAP
          </div>
          <div ref={mapRef} className='h-[258px] w-full max-w-full overflow-auto px-1'>
            <AsciiNetworkVisualizer
              topology={topology}
              options={{
                theme: floorNetworkTheme,
                width: networkWidth,
                height: 230,
                showLabels: true,
                showStatus: true,
                interactive: false,
                layout: 'circular',
                animation: true,
                zoom: false,
                pan: false,
                soundEffects: false,
              }}
            />
          </div>
          <div className='flex flex-wrap gap-1 border-t border-[var(--border)] px-2 py-2 bg-[var(--bg-raised)]'>
            <span className={inlineBadgeClass}>feedAgeMs={deckFeedAgeMs || '--'}</span>
            <span className={inlineBadgeClass}>missing={deckMissing}</span>
            <span className={inlineBadgeClass}>deck heartbeat={formatAge(heartbeatAgeMs)}</span>
            <span className={inlineBadgeClass}>stations={stationRows.length}</span>
            <span className={inlineBadgeClass}>exchange=HYPERLIQUID</span>
          </div>
        </div>
      </div>
    </AsciiCard>
  )
}
