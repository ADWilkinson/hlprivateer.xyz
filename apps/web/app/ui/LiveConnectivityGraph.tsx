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
  theme: 'light' | 'dark'
  loading?: boolean
  className?: string
}

const NODE_BASE_SIZE = 8
const LABEL_MAX_LENGTH = 11
const PADDING = 22
const HEARTBEAT_MAX_LENGTH = 9

type LiveNodePosition = { id: string; x: number; y: number }

function linkColor(status: EdgeStatus, theme: 'light' | 'dark') {
  if (status === 'active') {
    return theme === 'dark' ? '#6ea29a' : '#4b9a87'
  }

  if (status === 'warning' || status === 'congested') {
    return theme === 'dark' ? '#b89d70' : '#c09659'
  }

  if (status === 'error') {
    return theme === 'dark' ? '#ad7f88' : '#b26f78'
  }

  return theme === 'dark' ? 'rgba(120, 136, 157, 0.48)' : 'rgba(144, 139, 128, 0.45)'
}

function nodeStatusColor(status: NodeStatus, theme: 'light' | 'dark') {
  if (status === 'online') {
    return theme === 'dark' ? '#6ea29a' : '#4b9a87'
  }

  if (status === 'warning') {
    return theme === 'dark' ? '#b89d70' : '#c09659'
  }

  return theme === 'dark' ? '#ad7f88' : '#b06a75'
}

function rank(nodeId: string, nodes: LiveNode[]) {
  if (nodeId === 'ops') return 0
  const index = nodes.findIndex((node) => node.id === nodeId)
  return index + 1
}

function buildSeededPositions(nodes: LiveNode[], width: number, height: number) {
  if (!nodes.length) return [] as Array<{ x: number; y: number; id: string }>

  const centerX = Math.round(width * 0.5)
  const centerY = Math.round(height * 0.5)
  const safeW = Math.max(0, width - 36)
  const safeH = Math.max(0, height - 36)
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
    return {
      id: node.id,
      x: clamp(Math.round(centerX + Math.cos(angle) * radiusX), 14, width - 14),
      y: clamp(Math.round(centerY + Math.sin(angle) * radiusY), 14, height - 18),
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

export function LiveConnectivityGraph({
  nodes,
  edges,
  width,
  height,
  theme,
  loading = false,
  className = '',
}: LiveTopologyGraphProps) {
  const safeWidth = Math.max(220, width)
  const safeHeight = Math.max(180, height)
  const markerId = useMemo(() => `hlp-live-map-${theme}-${safeWidth}-${safeHeight}`, [theme, safeWidth, safeHeight])
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
    <div className={`${className} relative h-full w-full overflow-hidden`} style={{ minHeight: safeHeight }}>
      <svg
        className='block'
        width={safeWidth}
        height={safeHeight}
        viewBox={`0 0 ${safeWidth} ${safeHeight}`}
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <marker
            id={markerId}
            markerWidth='8'
            markerHeight='8'
            refX='6'
            refY='4'
            orient='auto'
            markerUnits='strokeWidth'
          >
            <path d='M0 0 L8 4 L0 8 L2 4 Z' fill='currentColor' />
          </marker>
        </defs>
        {mappedNodes.length > 0 &&
          edges.map((edge) => {
            const sourceNode = nodePosition(mappedNodes, edge.source)
            const targetNode = nodePosition(mappedNodes, edge.target)
            if (!sourceNode || !targetNode) return null
            const color = linkColor(edge.status, theme)
            const active = edge.status === 'active'
            const x1 = sourceNode.x
            const y1 = sourceNode.y
            const x2 = targetNode.x
            const y2 = targetNode.y
            const dx = x2 - x1
            const dy = y2 - y1
            const midX = x1 + (dx * 0.5)
            const midY = y1 + (dy * 0.5)

            return (
              <g key={edge.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={color}
                  strokeWidth={active ? 2.05 : 1.35}
                  strokeOpacity={loading ? 0.5 : 0.9}
                  strokeDasharray={edge.status === 'inactive' ? '5 5' : undefined}
                  markerEnd={`url(#${markerId})`}
                  className={active ? 'animate-pulse' : ''}
                  style={{ color }}
                />
                {!loading && (
                  <text
                    x={midX}
                    y={midY - 8}
                    fill={theme === 'dark' ? '#d5dce7' : '#3b4b5f'}
                    fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                    fontSize={8}
                    textAnchor='middle'
                    className='tracking-[0.08em]'
                  >
                    {truncateLabel(edge.label ?? '', 8)}
                  </text>
                )}
              </g>
            )
          })}

        {mappedNodes.map((node) => {
          const x = clamp(node.x, PADDING, safeWidth - PADDING)
          const y = clamp(node.y, PADDING, safeHeight - PADDING)
          const status = nodeStatusColor(node.status, theme)
          const heartbeat = truncateLabel(String(node.metadata?.heartbeat ?? '--'), HEARTBEAT_MAX_LENGTH)
          const textColor = theme === 'dark' ? '#d5dce7' : '#223144'
          const mutedColor = theme === 'dark' ? '#97a5bb' : '#5a6675'

          return (
            <g key={node.id} transform={`translate(${x}, ${y})`}>
              <circle
                cx={0}
                cy={0}
                r={NODE_BASE_SIZE + 2}
                fill={theme === 'dark' ? 'rgba(86, 101, 123, 0.38)' : 'rgba(120, 127, 145, 0.28)'}
                opacity={0.95}
              />
              <circle
                cx={0}
                cy={0}
                r={NODE_BASE_SIZE}
                fill={status}
                className={node.status === 'online' ? 'animate-pulse' : ''}
              />
              <text
                x={0}
                y={-12}
                fill={textColor}
                fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                fontSize={9}
                textAnchor='middle'
                fontWeight={700}
                style={{ letterSpacing: '0.09em' }}
              >
                {truncateLabel(node.label, LABEL_MAX_LENGTH)}
              </text>
              <text
                x={0}
                y={16}
                fill={mutedColor}
                fontFamily='var(--font-hlp-mono), "IBM Plex Mono", monospace'
                fontSize={8}
                textAnchor='middle'
                style={{ letterSpacing: '0.08em' }}
              >
                {loading ? 'loading' : heartbeat}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
