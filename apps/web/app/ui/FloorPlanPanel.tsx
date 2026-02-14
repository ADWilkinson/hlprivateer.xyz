import { useEffect, useMemo, useRef, useState } from 'react'
import { AsciiBadge, AsciiTable } from './ascii-kit'
import { AsciiTopology, type AsciiTopologyNode } from './ascii-topology'
import {
  CREW,
  HEARTBEAT_WINDOW_MS,
  crewLabel,
  formatAge,
  type CrewHeartbeat,
  type CrewRole,
} from './floor-dashboard'
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionStripClass, sectionTitleClass } from './ascii-style'

type CrewNode = {
  id: string
  label: string
  role: CrewRole
  ageText: string
  status: 'active' | 'stale' | 'silent'
  pulse: string
  route: string
}

type FloorPlanPanelProps = {
  crewHeartbeat: CrewHeartbeat
  nowMs: number
  deckFeedAgeMs: number
  deckMissing: number
  deckHeartbeatMs: number
  theme: 'light' | 'dark'
}

type TopologyEdge = {
  id: string
  source: string
  target: string
  status: 'active' | 'warning' | 'error' | 'inactive' | 'congested'
  label?: string
}

const roleRoute: Record<CrewRole, string> = {
  scout: 'SCOUT -> RESEARCH',
  research: 'RESEARCH -> STRATEGIST',
  strategist: 'STRATEGIST -> EXECUTION',
  execution: 'EXECUTION -> SCRIBE',
  risk: 'RISK -> EXECUTION',
  scribe: 'SCRIBE -> OPS',
  ops: 'OPS -> BROADCAST',
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
      route: roleRoute[role],
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
      const fallback = typeof window === 'undefined' ? 620 : window.innerWidth - 44
      const measured = mapRef.current?.clientWidth ?? fallback
      setNetworkWidth(Math.max(260, measured))
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
    const nodes: AsciiTopologyNode[] = stationRows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status === 'active' ? 'online' : row.status === 'stale' ? 'warning' : 'offline',
      metadata: {
        role: row.role,
        heartbeat: row.ageText,
        pulse: row.pulse,
      },
    }))

    const edges: TopologyEdge[] = stationRows
      .filter((row) => row.role !== 'ops')
      .map((row) => ({
        id: `ops-${row.role}`,
        source: 'ops',
        target: row.id,
        status:
          crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS * 0.45
            ? 'active'
            : crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS * 0.8
              ? 'warning'
              : 'error',
        label: `link:${row.label}`,
      }))

    return { nodes, edges }
  }, [crewHeartbeat, stationRows, nowMs])

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <div>
          <div className={sectionTitleClass}>FLOOR PLAN MAP</div>
          <div className='text-[11px] text-hlpMuted dark:text-hlpMutedDark'>LIVE CONNECTIVITY GRAPH</div>
        </div>
        <AsciiBadge tone='positive' className='text-hlpPositive dark:text-hlpPositiveDark'>
          topology mode
        </AsciiBadge>
      </div>

      <div className='grid grid-cols-1 gap-2 p-2 md:grid-cols-[minmax(220px,_320px)_1fr]'>
        <div className='overflow-hidden rounded-hlp border border-hlpBorder dark:border-hlpBorderDark'>
          <div className={cardHeaderClass}>
            <span className={sectionTitleClass}>NODE TABLE</span>
          </div>
          <AsciiTable
            columns={[
              { key: 'label', header: 'STATION' },
              { key: 'status', header: 'STATUS', align: 'center' },
              { key: 'ageText', header: 'HEARTBEAT', align: 'right' },
              { key: 'pulse', header: 'PULSE', align: 'center' },
              { key: 'route', header: 'ROUTE', align: 'left' },
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
            <AsciiTopology
              nodes={topology.nodes}
              edges={topology.edges}
              width={networkWidth}
              theme={theme}
              className='text-[9px] text-hlpMuted dark:text-hlpMutedDark'
            />
          </div>
          <div className={sectionStripClass}>
            <span className={inlineBadgeClass}>feedAgeMs={deckFeedAgeMs || '--'}</span>
            <span className={inlineBadgeClass}>deck heartbeat={formatAge(heartbeatAgeMs)}</span>
            <span className={inlineBadgeClass}>missing={deckMissing}</span>
            <span className={inlineBadgeClass}>stations={stationRows.length}</span>
            <span className={inlineBadgeClass}>exchange=HYPERLIQUID</span>
          </div>
          <div className='px-2 py-2 text-[9px] text-hlpMuted dark:text-hlpMutedDark'>
            <div className='mb-1 uppercase tracking-[0.16em]'>LINK LEGEND</div>
            <div className='flex flex-wrap gap-1'>
              <span className='inline-flex items-center gap-1 rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/45 dark:bg-hlpSurfaceDark/50 px-1.5 py-1'>
                <span className='inline-block h-2 w-2 rounded-full bg-hlpPositive dark:bg-hlpPositiveDark' />
                active
              </span>
              <span className='inline-flex items-center gap-1 rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/45 dark:bg-hlpSurfaceDark/50 px-1.5 py-1'>
                <span className='inline-block h-2 w-2 rounded-full bg-hlpWarning dark:bg-hlpWarningDark' />
                congested
              </span>
              <span className='inline-flex items-center gap-1 rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/45 dark:bg-hlpSurfaceDark/50 px-1.5 py-1'>
                <span className='inline-block h-2 w-2 rounded-full bg-hlpNegative dark:bg-hlpNegativeDark' />
                risk/error
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
