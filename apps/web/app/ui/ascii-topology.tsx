import { useMemo } from 'react'

type NodeStatus = 'online' | 'warning' | 'offline'

type EdgeStatus = 'active' | 'inactive' | 'congested' | 'error' | 'warning'

export type AsciiTopologyNode = {
  id: string
  label: string
  status: NodeStatus
  metadata?: Record<string, string>
}

type TopologyEdge = {
  id: string
  source: string
  target: string
  status: EdgeStatus
  label?: string
}

type AsciiTopologyProps = {
  nodes: AsciiTopologyNode[]
  edges: TopologyEdge[]
  width: number
  theme: 'light' | 'dark'
  className?: string
}

type NodePos = {
  x: number
  y: number
}

const nodeGlyph: Record<NodeStatus, string> = {
  online: '◉',
  warning: '◍',
  offline: '◌',
}

const edgeGlyph: Record<'light' | 'dark', Record<EdgeStatus, string>> = {
  light: {
    active: '─',
    inactive: '┄',
    congested: '┅',
    warning: '┈',
    error: '⟶',
  },
  dark: {
    active: '━',
    inactive: '╌',
    congested: '┄',
    warning: '┈',
    error: '═',
  },
}

function drawLine(grid: string[][], p0: NodePos, p1: NodePos, fill: string) {
  const x0 = p0.x
  const y0 = p0.y
  const x1 = p1.x
  const y1 = p1.y
  const dx = Math.abs(x1 - x0)
  const sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0)
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy

  let x = x0
  let y = y0

  while (true) {
    const current = grid[y]?.[x]
    if (current !== undefined && current === ' ') {
      grid[y]![x] = fill
    }
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

function renderTopologyMap(nodes: AsciiTopologyNode[], edges: AsciiTopologyEdge[], theme: 'light' | 'dark', widthPx: number): string {
  const width = Math.max(56, Math.min(84, Math.floor(widthPx / 10) * 2 + 8))
  const height = 16
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))

  if (nodes.length === 0) {
    const empty = '\n  [topology unavailable]\n'.padStart(28, ' ')
    return `${'╭' + '─'.repeat(width - 2) + '╮'}\n${empty}\n${'╰' + '─'.repeat(width - 2) + '╯'}`
  }

  const centerX = Math.floor((width - 1) / 2)
  const centerY = Math.floor((height - 1) / 2)
  const map = new Map<string, NodePos>()

  const outer = nodes.filter((node) => node.id !== 'ops')
  const outerRadiusX = Math.max(8, Math.floor((width - 6) / 2))
  const outerRadiusY = Math.max(4, Math.floor((height - 4) / 2))

  map.set('ops', { x: centerX, y: centerY })

  outer.forEach((node, index) => {
    const angle = (Math.PI * 2 * (index + 1)) / Math.max(outer.length, 1)
    const x = Math.round(centerX + outerRadiusX * Math.cos(angle))
    const y = Math.round(centerY + outerRadiusY * Math.sin(angle))
    map.set(node.id, {
      x: Math.min(width - 3, Math.max(2, x)),
      y: Math.min(height - 3, Math.max(2, y)),
    })
  })

  const hubX = width - 6
  const hubY = 2
  nodes.forEach((node, index) => {
    const point = map.get(node.id)
    if (!point) return
    const glyph = nodeGlyph[node.status] ?? nodeGlyph.offline
    grid[point.y]![point.x] = glyph

    const idText = node.id.toUpperCase().slice(0, 8)
    const labelX = Math.max(0, Math.min(width - idText.length - 1, point.x + (index === 0 ? -Math.floor(idText.length / 2) : -2)))
    const labelY = point.y + 1
    if (labelY < height) {
      for (let i = 0; i < idText.length && labelX + i < width; i += 1) {
        if (grid[labelY]?.[labelX + i] === ' ') {
          grid[labelY]![labelX + i] = idText[i]!
        }
      }
    }

    if (point.x + 1 < width && point.y + 2 < height) {
      const heartbeat = node.metadata?.heartbeat ? `:${node.metadata.heartbeat}` : ''
      const metaX = Math.max(0, Math.min(width - heartbeat.length - 1, point.x - Math.floor(heartbeat.length / 2)))
      const metaY = Math.min(height - 1, point.y + 2)
      for (let i = 0; i < heartbeat.length && metaX + i < width; i += 1) {
        if (grid[metaY]?.[metaX + i] === ' ') {
          grid[metaY]![metaX + i] = heartbeat[i]!
        }
      }
    }
  })

  edges.forEach((edge) => {
    const sourcePos = map.get(edge.source)
    const targetPos = map.get(edge.target)
    if (!sourcePos || !targetPos) return

    let lineChar = edgeGlyph[theme][edge.status] ?? edgeGlyph[theme].active
    if (lineChar.length === 0) lineChar = '─'

    drawLine(grid, sourcePos, targetPos, lineChar)
    const midX = Math.round((sourcePos.x + targetPos.x) / 2)
    const midY = Math.round((sourcePos.y + targetPos.y) / 2)
    const label = edge.label ? edge.label.slice(0, 11) : undefined
    if (label) {
      const labelX = Math.min(width - label.length - 1, Math.max(1, midX - Math.floor(label.length / 2)))
      for (let i = 0; i < label.length; i += 1) {
        if (grid[midY]?.[labelX + i] === ' ') {
          grid[midY]![labelX + i] = label[i]!
        }
      }
    }
  })

  const body = grid.map((row) => row.join('')).join('\n')
  const frameTop = `╭${'─'.repeat(width - 2)}╮`
  const frameBottom = `╰${'─'.repeat(width - 2)}╯`

  return `${frameTop}\n${body}\n${frameBottom}`
}

type AsciiTopologyEdge = TopologyEdge

export function AsciiTopology({ nodes, edges, width, theme, className = '' }: AsciiTopologyProps) {
  const map = useMemo(() => renderTopologyMap(nodes, edges, theme, width), [nodes, edges, theme, width])

  return <pre className={`overflow-auto whitespace-pre ${className}`}>{map}</pre>
}

export type { EdgeStatus, NodeStatus }
