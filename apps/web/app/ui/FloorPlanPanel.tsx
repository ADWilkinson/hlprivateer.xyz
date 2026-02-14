import { useEffect, useMemo, useRef, useState } from 'react'
import { AsciiBadge } from './ascii-kit'
import { LiveConnectivityGraph, type LiveNode } from './LiveConnectivityGraph'
import {
  CREW,
  HEARTBEAT_WINDOW_MS,
  crewLabel,
  formatAge,
  type CrewHeartbeat,
  type CrewRole,
} from './floor-dashboard'
import {
  cardClass,
  collapsibleHeaderClass,
  inverseControlClass,
  inlineBadgeClass,
  monitorClass,
  panelBodyPad,
  sectionStripClass,
  sectionTitleClass,
  skeletonPulseClass,
} from './ascii-style'

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
  isLoading?: boolean
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
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

const NODE_LEGEND = [
  { key: 'online', label: 'ONLINE', dotClass: 'bg-[#1bc89f]', detail: 'steady node' },
  { key: 'warning', label: 'WEAK', dotClass: 'bg-[#e0a63b]', detail: 'aging signal' },
  { key: 'offline', label: 'OFFLINE', dotClass: 'bg-[#a2555d]', detail: 'no pulse' },
] as const

const EDGE_LEGEND = [
  { key: 'active', label: 'ACTIVE LINK', dotClass: 'stroke-[#1bc89f]', detail: 'full health' },
  { key: 'congested', label: 'CONGESTED', dotClass: 'stroke-[#e77d3e]', detail: 'slow lane' },
  { key: 'warning', label: 'WARN LINK', dotClass: 'stroke-[#e0a63b]', detail: 'unstable' },
  { key: 'error', label: 'ERROR', dotClass: 'stroke-[#bf555a]', detail: 'broken' },
  { key: 'inactive', label: 'IDLE', dotClass: 'stroke-[#7f7f88]', detail: 'waiting' },
] as const

const NODE_ONLINE_MS = 5_000
const NODE_WEAK_MS = Math.round(HEARTBEAT_WINDOW_MS * 0.45)
const NODE_STALE_MS = NODE_WEAK_MS
const EDGE_ACTIVE_MS = NODE_WEAK_MS
const EDGE_CONGESTED_MS = Math.round(HEARTBEAT_WINDOW_MS * 0.65)
const EDGE_WARNING_MS = HEARTBEAT_WINDOW_MS

function heartbeatStatus(lastMs: number, nowMs: number): { status: 'active' | 'stale' | 'silent'; pulse: string; label: string } {
  if (!lastMs) {
    return { status: 'silent', pulse: '-----', label: 'silent' }
  }

  const age = nowMs - lastMs
  if (age <= NODE_ONLINE_MS) return { status: 'active', pulse: '*****', label: 'active' }
  if (age <= NODE_STALE_MS) return { status: 'stale', pulse: '===--', label: 'stale' }
  return { status: 'silent', pulse: '-----', label: 'silent' }
}

function linkStatusFromHeartbeat(lastMs: number, nowMs: number): TopologyEdge['status'] {
  if (!lastMs) return 'inactive'

  const age = nowMs - lastMs
  if (age <= EDGE_ACTIVE_MS) return 'active'
  if (age <= EDGE_CONGESTED_MS) return 'congested'
  if (age <= EDGE_WARNING_MS) return 'warning'
  return 'error'
}

function crewTableRows(crewHeartbeat: CrewHeartbeat, nowMs: number, isLoading: boolean): CrewNode[] {
  if (isLoading) {
    return CREW.map((role) => ({
      id: role,
      label: crewLabel(role),
      role,
      ageText: 'pending',
      status: 'stale',
      pulse: '--*--',
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

function loadingTopologyNodeRow(): LiveNode[] {
  return CREW.map((role) => ({
    id: role,
    label: crewLabel(role),
    status: 'warning',
    metadata: {
      role,
      heartbeat: 'pending',
      pulse: '--*--',
    },
  }))
}

const nodeStatusByCrewState: Record<CrewNode['status'], LiveNode['status']> = {
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
  isLoading = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'floor-plan',
}: FloorPlanPanelProps) {
  const stationRows = useMemo(() => crewTableRows(crewHeartbeat, nowMs, isLoading), [crewHeartbeat, nowMs, isLoading])
  const heartbeatAgeMs = Math.max(0, nowMs - deckHeartbeatMs)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [networkWidth, setNetworkWidth] = useState(680)
  const [networkHeight, setNetworkHeight] = useState(450)

  useEffect(() => {
    const updateWidth = () => {
      const fallback = typeof window === 'undefined' ? 640 : Math.max(240, window.innerWidth - 58)
      const measured = mapRef.current?.clientWidth ?? fallback
      const usable = Math.max(360, measured - 10)
      const height = Math.max(360, Math.round(usable * 0.72))
      setNetworkWidth(usable)
      setNetworkHeight(height)
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
        status: isLoading ? 'warning' : linkStatusFromHeartbeat(crewHeartbeat[row.role], nowMs),
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
              status: isLoading ? 'inactive' : linkStatusFromHeartbeat(crewHeartbeat[row.role], nowMs),
              label: `mesh:${row.label}`,
            } satisfies TopologyEdge
          })

    return { nodes, edges: [...edges, ...ringEdges] }
  }, [crewHeartbeat, isLoading, nowMs, stationRows])

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle operation map panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <div>
          <div className={sectionTitleClass}>OPERATION MAP</div>
        </div>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>
            {isCollapsed ? '+' : '-'}
          </span>
          <AsciiBadge tone='inverse'>{isLoading ? 'loading map' : 'topology view'}</AsciiBadge>
        </div>
      </button>

      {!isCollapsed && (
        <div className={`flex flex-col ${panelBodyPad}`}>
          <div className={`min-h-[360px] ${monitorClass} flex flex-col`}>
            <div className={`flex items-center justify-between ${panelBodyPad} border-b border-hlpBorder text-[9px] uppercase tracking-[0.14em] text-hlpMuted`}>
              <span className={sectionTitleClass}>LIVE NETWORK MAP</span>
              <AsciiBadge tone='neutral' variant='angle' className='text-hlpMuted'>
                network view
              </AsciiBadge>
            </div>
            <div
              ref={mapRef}
              className='w-full flex-1 overflow-hidden px-1 py-1'
              style={{ minHeight: `${networkHeight}px`, width: '100%' }}
            >
              <LiveConnectivityGraph
                nodes={topology.nodes}
                edges={topology.edges}
                width={networkWidth}
                height={networkHeight}
                className='text-hlpFg'
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
                  <span className={inlineBadgeClass}>system heartbeat={formatAge(heartbeatAgeMs)}</span>
                  <span className={inlineBadgeClass}>stations={stationRows.length}</span>
                  <span className={inlineBadgeClass}>missing={deckMissing}</span>
                </>
              )}
            </div>
            <div className={sectionStripClass}>
              <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>legend</span>
              <span className='text-[9px] font-semibold tracking-[0.16em]'>nodes:</span>
              {NODE_LEGEND.map((entry) => (
                <span
                  className='inline-flex items-center gap-1 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-hlpMuted'
                  key={`node-${entry.key}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${entry.dotClass}`} />
                  <span>{entry.label}</span>
                  <span className='uppercase tracking-[0.14em] text-hlpMuted/70'>({entry.detail})</span>
                </span>
              ))}
              <span className='text-[9px] font-semibold tracking-[0.16em]'>links:</span>
              {EDGE_LEGEND.map((entry) => (
                <span
                  className='inline-flex items-center gap-1 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-hlpMuted'
                  key={`edge-${entry.key}`}
                >
                  <span className={`h-1.5 w-2 rounded-sm border ${entry.dotClass.replace('stroke-', 'border-')}`} />
                  <span>{entry.label}</span>
                  <span className='uppercase tracking-[0.14em] text-hlpMuted/70'>({entry.detail})</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
