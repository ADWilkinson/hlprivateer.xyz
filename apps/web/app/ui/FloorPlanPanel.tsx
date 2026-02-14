import { AsciiBadge, AsciiNetworkVisualizer, AsciiTable } from 'react-ascii-ui'
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
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionTitleClass } from './ascii-style'

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
  theme: 'light' | 'dark'
}

type NetworkColor = {
  background: string
  grid: string
  text: string
  border: string
  nodeOnline: string
  nodeOffline: string
  nodeWarning: string
  nodeError: string
  edgeActive: string
  edgeInactive: string
  edgeCongested: string
  edgeError: string
  selection: string
  hover: string
}

const networkThemes: Record<'light' | 'dark', NetworkColor> = {
  light: {
    background: '#f4f1ec',
    grid: 'rgba(42, 58, 74, 0.13)',
    text: '#2f3a4c',
    border: '#b9b0a2',
    nodeOnline: '#2f8b67',
    nodeOffline: '#94a8bf',
    nodeWarning: '#b48844',
    nodeError: '#b95d69',
    edgeActive: '#2f8b67',
    edgeInactive: '#8a97a6',
    edgeCongested: '#b48844',
    edgeError: '#b95d69',
    selection: '#2f3a4c',
    hover: '#2f3a4c',
  },
  dark: {
    background: '#172437',
    grid: 'rgba(220, 230, 245, 0.08)',
    text: '#dbe5f3',
    border: '#435774',
    nodeOnline: '#56cfad',
    nodeOffline: '#94a8bf',
    nodeWarning: '#dfbe70',
    nodeError: '#e18d98',
    edgeActive: '#56cfad',
    edgeInactive: '#7d8aa1',
    edgeCongested: '#dfbe70',
    edgeError: '#e18d98',
    selection: '#dbe5f3',
    hover: '#dbe5f3',
  },
}

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
  theme,
}: FloorPlanPanelProps) {
  const stationRows = useMemo(() => crewTableRows(crewHeartbeat, nowMs), [crewHeartbeat, nowMs])
  const heartbeatAgeMs = Math.max(0, nowMs - deckHeartbeatMs)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [networkWidth, setNetworkWidth] = useState(480)

  useEffect(() => {
    const updateWidth = () => {
      const fallback = typeof window === 'undefined' ? 480 : Math.min(window.innerWidth - 44, 700)
      const measured = mapRef.current?.clientWidth ?? fallback
      setNetworkWidth(Math.max(260, Math.min(700, measured)))
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
    const nodes = stationRows.map((row) => ({
      id: row.id,
      label: row.label,
      type: row.role === 'ops' ? 'router' : 'workstation',
      status: row.status === 'active' ? 'online' : row.status === 'stale' ? 'warning' : 'offline',
      metadata: {
        role: row.role,
        heartbeat: row.ageText,
        pulse: row.pulse,
      },
    }))

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

    return { nodes, edges, metadata: { name: 'HL Trading Floor', description: 'Crew heartbeat topology' } }
  }, [crewHeartbeat, stationRows, nowMs])

  const floorNetworkTheme = useMemo(
    () => ({
      ...ASCII_NETWORK_THEMES.green,
      colors: {
        ...ASCII_NETWORK_THEMES.green.colors,
        ...networkThemes[theme],
      },
    }),
    [theme],
  )

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <div>
          <div className={sectionTitleClass}>FLOOR PLAN</div>
          <div className='text-[11px] text-hlpMuted dark:text-hlpMutedDark'>TRADING FLOOR TOPOLOGY</div>
        </div>
        <AsciiBadge color='success' className='text-hlpPositive dark:text-hlpPositiveDark'>
          live telemetry
        </AsciiBadge>
      </div>

      <div className='grid grid-cols-1 gap-2 p-2 md:grid-cols-[minmax(220px,_320px)_1fr]'>
        <div className='overflow-hidden rounded-hlp border border-hlpBorder dark:border-hlpBorderDark'>
          <div className={cardHeaderClass}>
            <span className={sectionTitleClass}>STATION SIGNALS</span>
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

        <div className='overflow-hidden rounded-hlp border border-hlpBorder dark:border-hlpBorderDark'>
          <div className={cardHeaderClass}>
            <span className={sectionTitleClass}>LIVE MAP</span>
          </div>
          <div ref={mapRef} className='h-[258px] w-full max-w-full overflow-auto px-1 pb-1'>
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
          <div className='flex flex-wrap gap-1 border-t border-hlpBorder dark:border-hlpBorderDark px-2 py-2 bg-hlpSurface dark:bg-hlpSurfaceDark'>
            <span className={inlineBadgeClass}>feedAgeMs={deckFeedAgeMs || '--'}</span>
            <span className={inlineBadgeClass}>missing={deckMissing}</span>
            <span className={inlineBadgeClass}>deck heartbeat={formatAge(heartbeatAgeMs)}</span>
            <span className={inlineBadgeClass}>stations={stationRows.length}</span>
            <span className={inlineBadgeClass}>exchange=HYPERLIQUID</span>
          </div>
        </div>
      </div>
    </section>
  )
}
