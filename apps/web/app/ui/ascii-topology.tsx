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
  pulseMs?: number
  loading?: boolean
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

const nodeRingGlyph: Record<NodeStatus, string[]> = {
  online: ['◌', '◦', '◉', '◦'],
  warning: ['◍', '◌', '◈', '◍'],
  offline: ['◌', '·', '·', '◌'],
}

const edgeGlyph: Record<'light' | 'dark', Record<EdgeStatus, string[]>> = {
  light: {
    active: ['━', '╌', '⎯', '━'],
    inactive: ['╌', '─', '╌', '─'],
    congested: ['┄', '┅', '┄', '┅'],
    error: ['⟹', '➤', '═', '⟶'],
    warning: ['┈', '┄', '┈', '┄'],
  },
  dark: {
    active: ['━', '╌', '═', '⎯'],
    inactive: ['╌', '╌', '╌', '╌'],
    congested: ['┄', '┅', '┄', '┅'],
    error: ['⟹', '═', '⟶', '➤'],
    warning: ['┈', '┄', '┈', '┄'],
  },
}

function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function placeCell(grid: string[][], x: number, y: number, value: string, force = false) {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0]!.length) return
  if (force || grid[y]![x] === ' ') grid[y]![x] = value
}

function drawText(grid: string[][], startX: number, y: number, text: string) {
  if (y < 0 || y >= grid.length) return
  for (let i = 0; i < text.length; i += 1) {
    placeCell(grid, startX + i, y, text[i]!, true)
  }
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
    placeCell(grid, x, y, fill)
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

function drawOrbit(grid: string[][], node: NodePos, pulsePhase: number, radiusX: number, radiusY: number, glyph: string, status: NodeStatus) {
  const nodes = status === 'online' ? 10 : 7
  for (let i = 0; i < nodes; i += 1) {
    const ratio = (i / nodes) * Math.PI * 2
    const offset = pulsePhase * 0.12
    const x = Math.round(node.x + Math.cos(ratio + offset) * radiusX)
    const y = Math.round(node.y + Math.sin(ratio + offset) * radiusY)
    placeCell(grid, x, y, glyph)
  }
}

function renderSignalNoise(grid: string[][], theme: 'light' | 'dark', pulsePhase: number) {
  const width = grid[0]!.length
  const height = grid.length
  const density = Math.max(20, Math.floor((width * height) / 130))
  for (let i = 0; i < density; i += 1) {
    const s = hash(`${theme}:${pulsePhase}:${i}`)
    const x = s % width
    const y = Math.floor((s >>> 7) % height)
    if ((x + y + pulsePhase) % 4 !== 0) continue
    const glyph = ((x + y + pulsePhase) % 2 === 0 ? '·' : '•')
    placeCell(grid, x, y, glyph)
  }
}

function renderHubCore(grid: string[][], x: number, y: number, pulsePhase: number, status: NodeStatus) {
  const pulse = pulsePhase % 4
  const core = status === 'online' ? '◎' : status === 'warning' ? '◉' : '◌'
  placeCell(grid, x, y, core, true)
  if (pulse % 2 === 0) {
    placeCell(grid, x - 2, y, '─')
    placeCell(grid, x + 2, y, '─')
    placeCell(grid, x, y - 2, '│')
    placeCell(grid, x, y + 2, '│')
  } else {
    placeCell(grid, x - 2, y - 2, '╱')
    placeCell(grid, x + 2, y - 2, '╲')
    placeCell(grid, x - 2, y + 2, '╲')
    placeCell(grid, x + 2, y + 2, '╱')
  }
  drawOrbit(grid, { x, y }, pulsePhase, 1, 0.6, '✦', status)
}

function renderTopologyMap(
  nodes: AsciiTopologyNode[],
  edges: TopologyEdge[],
  theme: 'light' | 'dark',
  widthPx: number,
  pulseMs = 0,
  loading = false,
): string {
  const width = Math.max(78, Math.min(176, Math.floor(widthPx / 7)))
  const height = Math.max(18, Math.min(34, Math.floor(width / 4.5)))
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))

  const pulsePhase = Math.floor(pulseMs / 280)
  const framePadX = Math.max(2, Math.floor(width * 0.04))
  const framePadY = 2
  const centerX = Math.floor((width - 1) / 2)
  const centerY = Math.floor((height - 1) / 2)
  const map = new Map<string, NodePos>()

  const hub = nodes.find((node) => node.id === 'ops') ?? nodes[0]
  if (hub) {
    const hubX = Math.max(framePadX, Math.min(width - framePadX - 1, centerX))
    const hubY = Math.max(framePadY, Math.min(height - framePadY - 1, centerY))
    map.set(hub.id, { x: hubX, y: hubY })
  }

  const outer = nodes.filter((node) => node.id !== hub?.id)
  const outerRadiusX = Math.max(14, Math.floor((width - 14) * 0.37))
  const outerRadiusY = Math.max(6, Math.floor((height - 8) * 0.34))

  outer.forEach((node, index) => {
    const angle = (Math.PI * 2 * (index + 0.5)) / Math.max(1, outer.length)
    const x = Math.round((hub?.id ? map.get(hub?.id)!.x : centerX) + outerRadiusX * Math.cos(angle))
    const y = Math.round((hub?.id ? map.get(hub?.id)!.y : centerY) + outerRadiusY * Math.sin(angle))
    map.set(node.id, {
      x: Math.min(width - framePadX, Math.max(framePadX, x)),
      y: Math.min(height - framePadY - 1, Math.max(framePadY, y)),
    })
  })

  const orderedEdges = [...edges].sort((a, b) => {
    const rank = (status: EdgeStatus) => (status === 'active' ? 0 : status === 'warning' ? 1 : status === 'congested' ? 2 : 3)
    return rank(a.status) - rank(b.status)
  })

  renderSignalNoise(grid, theme, pulsePhase)

  orderedEdges.forEach((edge) => {
    const sourcePos = map.get(edge.source)
    const targetPos = map.get(edge.target)
    if (!sourcePos || !targetPos) return
    const variants = edgeGlyph[theme][edge.status] ?? edgeGlyph[theme].active
    const segmentChar = variants[Math.floor(hash(`${edge.id}:${pulsePhase}`) % variants.length)] ?? variants[0]
    drawLine(grid, sourcePos, targetPos, segmentChar)

    const packetCount = edge.status === 'active' ? 3 : edge.status === 'warning' || edge.status === 'congested' ? 2 : loading ? 1 : edge.status === 'error' ? 1 : 0
    for (let i = 0; i < packetCount; i += 1) {
      const offset = (hash(`${edge.id}:packet:${pulsePhase}:${i}`) % 32) / 32
      const packetX = Math.round(sourcePos.x + (targetPos.x - sourcePos.x) * offset)
      const packetY = Math.round(sourcePos.y + (targetPos.y - sourcePos.y) * offset)
      const packet = loading
        ? '◍'
        : edge.status === 'active'
          ? (pulsePhase % 2 === 0 ? '◉' : '◈')
          : edge.status === 'warning' || edge.status === 'congested'
            ? '◍'
            : '·'
      if (pulsePhase % 2 === 0) {
        placeCell(grid, packetX, packetY, packet)
      }
    }

    if (edge.label) {
      const label = edge.label.replace('link:', '').replace('mesh:', '').toLowerCase().replace(' -> ', '>')
      const displayWidth = Math.min(10, Math.max(0, label.length))
      const trimmed = label.slice(0, displayWidth)
      const midX = Math.round((sourcePos.x + targetPos.x) / 2) - 1
      const midY = Math.min(height - 2, Math.round((sourcePos.y + targetPos.y) / 2))
      const labelX = Math.max(1, Math.min((grid[0]!.length - 2) - trimmed.length, midX))
      drawText(grid, labelX, midY, trimmed)
    }
  })

  nodes.forEach((node, index) => {
    const pos = map.get(node.id)
    if (!pos) return

    const label = node.label.slice(0, 8)
    const glyph = nodeGlyph[node.status] ?? nodeGlyph.offline
    placeCell(grid, pos.x, pos.y, glyph, true)

    if (node.id === 'ops') {
      renderHubCore(grid, pos.x, pos.y, pulsePhase, node.status)
    } else if (node.status !== 'offline') {
      const orbitGlyph = nodeRingGlyph[node.status] ?? nodeRingGlyph.warning
      const orbit = orbitGlyph[(index + hash(node.id) + pulsePhase) % orbitGlyph.length] ?? orbitGlyph[0]
      drawOrbit(grid, pos, pulsePhase + hash(node.id), 1, 0.5, orbit, node.status)
      if (node.status === 'online' && pulsePhase % 3 === 0) {
        drawOrbit(grid, pos, pulsePhase + 4, 1.9, 1.0, '·', node.status)
      }
    }

    const labelX = Math.max(0, Math.min(width - label.length - 1, pos.x - Math.floor(label.length / 2)))
    const labelY = Math.min(height - 2, pos.y + 1)
    drawText(grid, labelX, labelY, label)

    const heartbeat = loading ? `boot:${pulsePhase % 7}` : node.metadata?.heartbeat ?? '--'
    const metaLine = node.id === 'ops' ? `hub · ${heartbeat}` : heartbeat
    const meta = loading ? `${metaLine}` : `${metaLine} ${node.metadata?.pulse ?? ''}`
    const metaX = Math.max(1, Math.min(width - meta.length - 1, pos.x - Math.floor(meta.length / 2)))
    drawText(grid, metaX, Math.min(height - 1, pos.y + 2), meta.slice(0, 18))
  })

  const body = grid.map((row) => row.join('')).join('\n')
  const frameTop = `╭${'─'.repeat(width - 2)}╮`
  const frameBottom = `╰${'─'.repeat(width - 2)}╯`

  return `${frameTop}\n${body}\n${frameBottom}`
}

export function AsciiTopology({
  nodes,
  edges,
  width,
  theme,
  className = '',
  pulseMs = 0,
  loading = false,
}: AsciiTopologyProps) {
  const map = useMemo(
    () => renderTopologyMap(nodes, edges, theme, width, pulseMs, loading),
    [nodes, edges, theme, width, pulseMs, loading],
  )

  return <pre className={`overflow-auto whitespace-pre ${className}`}>{map}</pre>
}

export type { EdgeStatus, NodeStatus }
