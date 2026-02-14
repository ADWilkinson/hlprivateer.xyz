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
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionStripClass, sectionTitleClass, skeletonPulseClass } from './ascii-style'

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
  isLoading?: boolean
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

function crewTableRows(crewHeartbeat: CrewHeartbeat, nowMs: number, isLoading: boolean): CrewNode[] {
  if (isLoading) {
    return CREW.map((role) => ({
      id: role,
      label: crewLabel(role),
      role,
      ageText: 'pending',
      status: 'stale',
      pulse: '◌◌◉◌◌',
      route: roleRoute[role],
    }))
  }

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

function loadingTopologyNodeRow(): AsciiTopologyNode[] {
  return CREW.map((role) => ({
    id: role,
    label: crewLabel(role),
    status: 'warning',
    metadata: {
      role,
      heartbeat: 'pending',
      pulse: '◌◌◉◌◌',
    },
  }))
}

const nodeStatusByCrewState: Record<CrewNode['status'], AsciiTopologyNode['status']> = {
  active: 'online',
  stale: 'warning',
  silent: 'offline',
}

export function FloorPlanPanel({
  crewHeartbeat,
  nowMs,
  deckFeedAgeMs,
  deckMissing,
  deckHeartbeatMs,
  theme,
  isLoading = false,
}: FloorPlanPanelProps) {
  const stationRows = useMemo(() => crewTableRows(crewHeartbeat, nowMs, isLoading), [crewHeartbeat, nowMs, isLoading])
  const heartbeatAgeMs = Math.max(0, nowMs - deckHeartbeatMs)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [networkWidth, setNetworkWidth] = useState(540)

  useEffect(() => {
    const updateWidth = () => {
      const fallback = typeof window === 'undefined' ? 980 : window.innerWidth - 58
      const measured = mapRef.current?.clientWidth ?? fallback
      setNetworkWidth(Math.max(360, Math.min(measured, 1560)))
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
    const nodes = isLoading
      ? loadingTopologyNodeRow()
      : stationRows.map((row) => ({
          id: row.id,
          label: row.label,
          status: nodeStatusByCrewState[row.status],
          metadata: {
            role: row.role,
            heartbeat: row.ageText,
            pulse: row.pulse,
          },
        }))

    const ringMembers = stationRows.filter((row) => row.role !== 'ops')
    const edges = ringMembers
      .map((row) =>
        ({
        id: `ops-${row.role}`,
        source: 'ops',
        target: row.id,
        status: isLoading
          ? 'warning'
          : crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS * 0.45
            ? 'active'
            : crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS * 0.8
              ? 'warning'
              : 'error',
        label: `link:${row.label}`,
      } satisfies TopologyEdge),
      )
    const ringEdges =
      isLoading || ringMembers.length <= 2
        ? []
        : ringMembers.map((row, idx) => {
            const next = ringMembers[(idx + 1) % ringMembers.length]
            return {
              id: `mesh-${row.role}-${next.role}`,
              source: row.id,
              target: next.id,
              status: isLoading
                ? 'inactive'
                : crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS * 0.55
                  ? 'congested'
                  : crewHeartbeat[row.role] && nowMs - crewHeartbeat[row.role] <= HEARTBEAT_WINDOW_MS
                    ? 'warning'
                    : 'error',
              label: `mesh:${row.label}`,
            } satisfies TopologyEdge
          })

    return { nodes, edges: [...edges, ...ringEdges] }
  }, [crewHeartbeat, isLoading, nowMs, stationRows])

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <div>
          <div className={sectionTitleClass}>FLOOR PLAN MAP</div>
          <div className='text-[11px] text-hlpMuted dark:text-hlpMutedDark'>LIVE CONNECTIVITY GRAPH</div>
        </div>
        <AsciiBadge tone='positive' className='text-hlpPositive dark:text-hlpPositiveDark'>
          {isLoading ? 'warming map' : 'topology mode'}
        </AsciiBadge>
      </div>

      <div className='grid grid-cols-1 gap-2 p-2 lg:grid-cols-[minmax(260px,_340px)_minmax(520px,_1fr)]'>
        <div className='min-h-[360px] overflow-hidden rounded-hlp border border-hlpBorder dark:border-hlpBorderDark'>
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

        <div className='min-h-[360px] overflow-hidden rounded-hlp border border-hlpBorder dark:border-hlpBorderDark'>
          <div className={cardHeaderClass}>
            <span className={sectionTitleClass}>LIVE MAP</span>
          </div>
          <div ref={mapRef} className='min-h-[360px] w-full max-w-full overflow-auto px-1 pb-1'>
            <AsciiTopology
              nodes={topology.nodes}
              edges={topology.edges}
              width={networkWidth}
              theme={theme}
              pulseMs={nowMs}
              className='text-[9px] text-hlpMuted dark:text-hlpMutedDark'
              loading={isLoading}
            />
          </div>
          <div className={sectionStripClass}>
            {isLoading ? (
              <>
                <span className={`${skeletonPulseClass} h-5 w-32 rounded-sm`} />
                <span className={`${skeletonPulseClass} h-5 w-36 rounded-sm`} />
                <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
                <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
              </>
            ) : (
              <>
                <span className={inlineBadgeClass}>feedAgeMs={deckFeedAgeMs || '--'}</span>
                <span className={inlineBadgeClass}>deck heartbeat={formatAge(heartbeatAgeMs)}</span>
                <span className={inlineBadgeClass}>missing={deckMissing}</span>
                <span className={inlineBadgeClass}>stations={stationRows.length}</span>
                <span className={inlineBadgeClass}>exchange=HYPERLIQUID</span>
              </>
            )}
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
