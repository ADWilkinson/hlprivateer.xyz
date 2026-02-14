import { useMemo } from 'react'

type NodeStatus = 'online' | 'warning' | 'offline'

type EdgeStatus = 'active' | 'inactive' | 'congested' | 'error' | 'warning'

export type LiveNode = {
  id: string
  label: string
  status: NodeStatus
  metadata?: Record<string, string>
}

type LiveEdge = {
  id: string
  source: string
  target: string
  status: EdgeStatus
  label?: string
}

type LiveTopologyGraphProps = {
  nodes: LiveNode[]
  edges: LiveEdge[]
  width: number
  height: number
  loading?: boolean
  className?: string
}

const NODE_BASE_SIZE = 8
const HUB_NODE_ID = 'ops'
const HUB_SIZE_BOOST = 3
const LABEL_MAX_LENGTH = 11
const HEARTBEAT_MAX_LENGTH = 9
const CONTOUR_STEPS = 4
const GRID_STEPS = 5
const EDGE_OFFSET = 12
const MAP_PADDING = 24

type LiveNodePosition = { id: string; x: number; y: number }

function linkColor(status: EdgeStatus) {
  if (status === 'active') {
    return 'stroke-hlpHealthy'
  }

  if (status === 'warning' || status === 'congested') {
    return 'stroke-hlpWarning'
  }

  if (status === 'error') {
    return 'stroke-hlpNegative'
  }

  return 'stroke-hlpMuted/45'
}

function nodeStatusColor(status: NodeStatus) {
  if (status === 'online') {
    return 'fill-hlpHealthy'
  }

  if (status === 'warning') {
    return 'fill-hlpWarning'
  }

  return 'fill-hlpNegative'
}

function rank(nodeId: string, nodes: LiveNode[]) {
  if (nodeId === HUB_NODE_ID) return 0
  const index = nodes.findIndex((node) => node.id === nodeId)
  return index + 1
}

function buildSeededPositions(nodes: LiveNode[], width: number, height: number) {
  if (!nodes.length) return [] as Array<{ x: number; y: number; id: string }>

  const centerX = Math.round(width * 0.5)
  const centerY = Math.round(height * 0.5)
  const safeW = Math.max(0, width - MAP_PADDING * 2)
  const safeH = Math.max(0, height - MAP_PADDING * 2)
  const radiusX = Math.floor(safeW * 0.34)
  const radiusY = Math.floor(safeH * 0.42)
  const ordered = [...nodes].sort((a, b) => rank(a.id, nodes) - rank(b.id, nodes))
  const hub = ordered[0]?.id

  return ordered.map((node, index) => {
    if (node.id === hub) {
      return { id: node.id, x: centerX, y: centerY }
    }

    const positionIndex = ordered.findIndex((entry) => entry.id === node.id)
    const outerCount = Math.max(1, ordered.length - 1)
    const angle = ((positionIndex - 1) / outerCount) * Math.PI * 2 - Math.PI / 2
    const radius = radiusX > 0 ? radiusX : width * 0.3
    const wave = radiusY > 0 ? radiusY : height * 0.3
    return {
      id: node.id,
      x: clamp(Math.round(centerX + Math.cos(angle) * radius), MAP_PADDING, width - MAP_PADDING),
      y: clamp(Math.round(centerY + Math.sin(angle) * wave), MAP_PADDING, height - MAP_PADDING),
    }
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function nodePosition(nodes: LiveNodePosition[], id: string) {
  return nodes.find((node) => node.id === id)
}

function truncateLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function routePath(source: LiveNodePosition, target: LiveNodePosition, index: number, isActive: boolean) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const orthX = (-dy / distance) * (isActive ? (index % 2 ? EDGE_OFFSET : -EDGE_OFFSET) : EDGE_OFFSET * 0.4)
  const orthY = (dx / distance) * (isActive ? (index % 2 ? EDGE_OFFSET : -EDGE_OFFSET) : EDGE_OFFSET * 0.4)
  const cx = (source.x + target.x) / 2 + orthX
  const cy = (source.y + target.y) / 2 + orthY
  return `M ${source.x.toFixed(2)} ${source.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${target.x.toFixed(2)} ${target.y.toFixed(2)}`
}

export function LiveConnectivityGraph({
  nodes,
  edges,
  width,
  height,
  loading = false,
  className = '',
}: LiveTopologyGraphProps) {
  const safeWidth = Math.max(240, width)
  const safeHeight = Math.max(220, height)
  const centerX = safeWidth / 2
  const centerY = safeHeight / 2
  const maxRingX = Math.max(28, (safeWidth - 36) * 0.36)
  const maxRingY = Math.max(22, (safeHeight - 38) * 0.38)

  const seeded = useMemo(() => buildSeededPositions(nodes, safeWidth, safeHeight), [nodes, safeWidth, safeHeight])
  const mappedNodes = useMemo(() => {
    const index = new Map(seeded.map((node) => [node.id, node]))
    return nodes.map((node) => {
      const position = index.get(node.id)
      return {
        ...node,
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        label: node.label.toUpperCase(),
      }
    })
  }, [nodes, seeded])

  return (
    <div className={`${className} relative w-full overflow-hidden`} style={{ minHeight: safeHeight }}>
      <svg
        className='block h-full w-full'
        viewBox={`0 0 ${safeWidth} ${safeHeight}`}
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        preserveAspectRatio='xMidYMid meet'
        role='img'
        aria-label='live network topology map'
      >
        <g className='stroke-hlpBorder/22'>
          {Array.from({ length: GRID_STEPS }, (_, index) => {
            const ratio = (index + 1) / (GRID_STEPS + 1)
            return (
              <line
                key={`grid-x-${index}`}
                x1={safeWidth * ratio}
                x2={safeWidth * ratio}
                y1={MAP_PADDING}
                y2={safeHeight - MAP_PADDING}
                className='stroke-hlpBorder/14'
                strokeWidth='0.25'
                strokeDasharray='2 8'
              />
            )
          })}

          {Array.from({ length: GRID_STEPS }, (_, index) => {
            const ratio = (index + 1) / (GRID_STEPS + 1)
            return (
              <line
                key={`grid-y-${index}`}
                x1={MAP_PADDING}
                x2={safeWidth - MAP_PADDING}
                y1={safeHeight * ratio}
                y2={safeHeight * ratio}
                className='stroke-hlpBorder/14'
                strokeWidth='0.25'
                strokeDasharray='2 8'
              />
            )
          })}

          {Array.from({ length: CONTOUR_STEPS }, (_, index) => {
            const t = (index + 1) / (CONTOUR_STEPS + 1)
            return (
              <ellipse
                key={`contour-ring-${index}`}
                cx={centerX}
                cy={centerY}
                rx={Math.max(22, maxRingX * t)}
                ry={Math.max(18, maxRingY * t)}
                fill='none'
                className='stroke-hlpBorder/16'
                strokeWidth='0.4'
                strokeDasharray='4 7'
              />
            )
          })}
        </g>

        <line
          x1={MAP_PADDING}
          y1={safeHeight * 0.5}
          x2={safeWidth - MAP_PADDING}
          y2={safeHeight * 0.5}
          className='stroke-hlpBorder/12'
          strokeWidth='0.2'
          strokeDasharray='3 6'
        />
        <line
          x1={safeWidth * 0.5}
          y1={MAP_PADDING}
          x2={safeWidth * 0.5}
          y2={safeHeight - MAP_PADDING}
          className='stroke-hlpBorder/12'
          strokeWidth='0.2'
          strokeDasharray='3 6'
        />

        {mappedNodes.length > 0 &&
          edges.map((edge, index) => {
            const sourceNode = nodePosition(mappedNodes, edge.source)
            const targetNode = nodePosition(mappedNodes, edge.target)
            if (!sourceNode || !targetNode) return null
            const color = linkColor(edge.status)
            const active = edge.status === 'active'
            const muted = edge.status === 'inactive'

            return (
              <g key={edge.id}>
                <path
                  d={routePath(sourceNode, targetNode, index, active)}
                  stroke='currentColor'
                  strokeWidth={active ? 1.45 : 0.95}
                  strokeOpacity={loading ? 0.5 : muted ? 0.45 : 0.9}
                  strokeDasharray={muted ? '4 4' : active ? '0' : edge.status === 'congested' ? '5 3' : undefined}
                  markerEnd={active ? 'url(#edgeArrow)' : undefined}
                  className={`${active ? 'animate-hlp-led' : ''} ${color}`}
                  fill='none'
                />
              </g>
            )
          })}

        <defs>
          <marker id='edgeArrow' markerWidth='5' markerHeight='5' refX='4' refY='2.5' orient='auto'>
            <path d='M0,0 L0,5 L4.5,2.5 z' fill='currentColor' />
          </marker>
        </defs>

        {mappedNodes.map((node, index) => {
          const x = clamp(node.x, MAP_PADDING, safeWidth - MAP_PADDING)
          const y = clamp(node.y, MAP_PADDING, safeHeight - MAP_PADDING)
          const status = nodeStatusColor(node.status)
          const isHub = node.id === HUB_NODE_ID
          const radius = isHub ? NODE_BASE_SIZE + HUB_SIZE_BOOST : NODE_BASE_SIZE
          const heartbeat = truncateLabel(String(node.metadata?.heartbeat ?? '--'), HEARTBEAT_MAX_LENGTH)
          const statePulse = truncateLabel(String(node.metadata?.pulse ?? '--'), 8)

          return (
            <g key={node.id} transform={`translate(${x}, ${y})`}>
              <circle cx='0' cy='0' r={radius + 5} className='fill-hlpSurface/56' />
              <circle cx='0' cy='0' r={radius + 3} className='stroke-hlpBorder/22 fill-none' strokeWidth='0.45' />
              {isHub ? (
                <path
                  d={`M ${-radius - 2} 0 L 0 ${-radius - 2} L ${radius + 2} 0 L 0 ${radius + 2} Z`}
                  className='fill-hlpSurface/75 stroke-hlpBorder'
                  strokeWidth='0.35'
                />
              ) : null}
              <circle
                cx='0'
                cy='0'
                r={radius}
                className={`${status} ${node.status === 'online' ? 'animate-hlp-led' : ''}`}
              />
              <text
                x='0'
                y='-13'
                className='fill-hlpFg'
                fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                fontSize={8}
                textAnchor='middle'
                fontWeight={700}
                style={{ letterSpacing: '0.08em' }}
              >
                {truncateLabel(node.label, LABEL_MAX_LENGTH)}
              </text>
              <text
                x='0'
                y='22'
                className='fill-hlpMuted'
                fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                fontSize={7.2}
                textAnchor='middle'
                style={{ letterSpacing: '0.07em' }}
              >
                {loading ? 'loading' : heartbeat}
              </text>
              <text
                x='0'
                y='29'
                className='fill-hlpMuted'
                fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                fontSize={6.8}
                textAnchor='middle'
                style={{ letterSpacing: '0.08em' }}
              >
                {loading ? '--' : statePulse}
              </text>
              {isHub && (
                <text
                  x='0'
                  y='36'
                  className='fill-hlpMuted'
                  fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                  fontSize={6.6}
                  textAnchor='middle'
                  style={{ letterSpacing: '0.1em' }}
                >
                  CORE
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
