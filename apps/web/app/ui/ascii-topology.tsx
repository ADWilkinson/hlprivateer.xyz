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

const nodePulseRing: Record<NodeStatus, string[]> = {
  online: ['◈', '◉', '◯', '◉'],
  warning: ['◍', '◌', '◈', '◍'],
  offline: ['◌', '·', '·', '◌'],
}

const edgeGlyph: Record<'light' | 'dark', Record<EdgeStatus, string[]>> = {
  light: {
    active: ['━', '═', '⎯'],
    inactive: ['·', '╌', '·'],
    congested: ['┄', '┈', '┄', '┅'],
    error: ['⟶', '⟹', '➤'],
    warning: ['┈', '┅', '┈'],
  },
  dark: {
    active: ['━', '⎯', '═'],
    inactive: ['·', '┄', '·'],
    congested: ['┄', '┈', '┄', '┅'],
    error: ['⟶', '⟹', '➤'],
    warning: ['┈', '┅', '┈'],
  },
}

const packetGlyph: Record<EdgeStatus, string[]> = {
  active: ['◉', '◈'],
  warning: ['◍', '◐'],
  congested: ['◐', '◑'],
  error: ['·', '·'],
  inactive: ['·', '·'],
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

function renderAmbientNoise(grid: string[][], pulsePhase: number) {
  const width = grid[0]!.length
  const height = grid.length
  const density = Math.max(8, Math.floor((width * height) / 320))
  for (let i = 0; i < density; i += 1) {
    const seed = hash(`${pulsePhase}:${i}`)
    const x = seed % width
    const y = (seed >>> 4) % height
    if ((x + pulsePhase + i) % 5 !== 0) continue
    placeCell(grid, x, y, i % 4 === 0 ? '·' : ' ')
  }
}

function drawOrbitPulse(grid: string[][], center: NodePos, pulsePhase: number, radiusX: number, radiusY: number, glyph: string, status: NodeStatus) {
  const nodes = status === 'offline' ? 6 : 9
  for (let i = 0; i < nodes; i += 1) {
    const angle = (i / nodes) * Math.PI * 2 + pulsePhase * 0.16
    const x = Math.round(center.x + Math.cos(angle) * radiusX)
    const y = Math.round(center.y + Math.sin(angle) * radiusY)
    placeCell(grid, x, y, glyph)
  }
}

function drawCore(grid: string[][], node: NodePos, status: NodeStatus, pulsePhase: number) {
  const pulse = pulsePhase % 4
  if (status === 'offline') return
  const glow = status === 'online' ? '✦' : '◈'
  placeCell(grid, node.x, node.y, nodeGlyph[status], true)
  drawOrbitPulse(grid, node, pulsePhase / 2, 1.3, 1.0, glow, status)
  if (pulse % 2 === 0) {
    drawOrbitPulse(grid, node, pulsePhase + 1, 2.2, 1.7, '·', status)
  }
}

function routePhase(status: EdgeStatus, phase: number) {
  if (status === 'active') return phase % 2 === 0 ? 0.8 : 0.2
  if (status === 'warning' || status === 'congested') return 0.38
  return 0.18
}

function renderTopologyMap(
  nodes: AsciiTopologyNode[],
  edges: TopologyEdge[],
  theme: 'light' | 'dark',
  widthPx: number,
  pulseMs = 0,
  loading = false,
): string {
  const width = Math.max(84, Math.min(230, Math.floor(widthPx / 4)))
  const height = Math.max(30, Math.min(72, Math.floor(width * 0.4)))
  const compact = width < 112
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))

  const pulsePhase = Math.floor(pulseMs / 280)
  renderAmbientNoise(grid, pulsePhase)

  const framePadX = Math.max(3, Math.floor(width * 0.045))
  const framePadY = Math.max(2, Math.floor(height * 0.08))
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2) - 1
  const map = new Map<string, NodePos>()

  const hub = nodes.find((node) => node.id === 'ops') ?? nodes[0]
  if (hub) {
    map.set(hub.id, { x: centerX, y: centerY })
  }

  const outer = nodes.filter((node) => node.id !== hub?.id)
  const outerRadiusX = Math.max(10, Math.floor((width - 10) * 0.43))
  const outerRadiusY = Math.max(5, Math.floor((height - 6) * 0.45))

  outer.forEach((node, index) => {
    const angle = (index / Math.max(1, outer.length)) * Math.PI * 2
    const x = Math.round((hub?.id ? centerX : map.get(nodes[0]!.id)!.x) + outerRadiusX * Math.cos(angle))
    const y = Math.round((hub?.id ? centerY : map.get(nodes[0]!.id)!.y) + outerRadiusY * Math.sin(angle))
    map.set(node.id, {
      x: Math.min(width - framePadX - 1, Math.max(framePadX, x)),
      y: Math.min(height - framePadY - 1, Math.max(framePadY, y)),
    })
  })

  const orderedEdges = [...edges].sort((a, b) => {
    const rank = (status: EdgeStatus) =>
      status === 'active' ? 0 : status === 'warning' ? 1 : status === 'congested' ? 2 : status === 'inactive' ? 4 : 3
    return rank(a.status) - rank(b.status)
  })

  orderedEdges.forEach((edge) => {
    if (compact && edge.id.startsWith('mesh-')) return

    const sourcePos = map.get(edge.source)
    const targetPos = map.get(edge.target)
    if (!sourcePos || !targetPos) return

    const segments = edgeGlyph[theme][edge.status] ?? edgeGlyph[theme].active
    const segment = segments[Math.floor(hash(`${edge.id}:${pulsePhase}`) % segments.length)] ?? segments[0]
    drawLine(grid, sourcePos, targetPos, segment)

    const packetCount = edge.status === 'active' ? 2 : edge.status === 'warning' || edge.status === 'congested' ? 1 : loading ? 1 : edge.status === 'error' ? 1 : 0
    for (let i = 0; i < packetCount; i += 1) {
      const t = (hash(`${edge.id}:p:${pulsePhase}:${i}`) % 1000) / 1000
      const packetT = (t + routePhase(edge.status, pulsePhase) + i * 0.5) % 1
      const packetX = Math.round(sourcePos.x + (targetPos.x - sourcePos.x) * packetT)
      const packetY = Math.round(sourcePos.y + (targetPos.y - sourcePos.y) * packetT)
      const glyphSet = packetGlyph[edge.status] ?? packetGlyph.inactive
      const packet = loading ? '◍' : glyphSet[Math.floor((pulsePhase + i) % glyphSet.length)] ?? '·'
      if ((pulsePhase + i) % 2 === 0) {
        placeCell(grid, packetX, packetY, packet)
      }
    }

    if (!compact && edge.label && (edge.status === 'active' || edge.status === 'warning')) {
      const label = edge.label.replace('link:', '').replace('mesh:', '').replace(' ', '')
      const short = label.slice(0, Math.min(6, label.length))
      const midX = Math.round((sourcePos.x + targetPos.x) / 2)
      const midY = Math.round((sourcePos.y + targetPos.y) / 2) + (pulsePhase % 2 === 0 ? -1 : 1)
      const labelX = Math.max(1, Math.min(width - short.length - 2, midX - Math.floor(short.length / 2)))
      drawText(grid, labelX, Math.min(height - 2, Math.max(1, midY)), short)
    }
  })

  nodes.forEach((node, index) => {
    const pos = map.get(node.id)
    if (!pos) return

    drawCore(grid, pos, node.status, pulsePhase + hash(node.id))

    const label = node.label.slice(0, compact ? 4 : 7)
    const labelX = Math.max(1, Math.min(width - label.length - 2, pos.x - Math.floor(label.length / 2)))
    const labelY = Math.min(height - 2, pos.y + 1)
    drawText(grid, labelX, labelY, label)

    if (!compact || node.id === 'ops') {
      const statusTag = node.status === 'online' ? 'ok' : node.status === 'warning' ? 'wrn' : 'off'
      const statX = node.id === 'ops' ? Math.max(1, labelX) : labelX + 1
      const meta = node.id === 'ops'
        ? `hub ${node.metadata?.heartbeat ?? '--'}`
        : `${statusTag} ${node.metadata?.heartbeat ?? '--'}`
      const text = loading ? `boot ${node.id}` : meta
      const metaText = text.slice(0, Math.max(4, Math.min(compact ? 6 : 13, text.length)))
      const metaX = Math.max(1, Math.min(width - metaText.length - 1, pos.x - Math.floor(metaText.length / 2)))
      drawText(grid, metaX, Math.min(height - 1, pos.y + 2), metaText)
    }

    const ringGlyph = nodePulseRing[node.status] ?? nodePulseRing.warning
    const ring = ringGlyph[(index + pulsePhase + hash(node.id)) % ringGlyph.length] ?? ringGlyph[0]
    if (node.status === 'online' || node.status === 'warning') {
      drawOrbitPulse(grid, pos, pulsePhase + index, 1.05, 0.55, ring, node.status)
    }
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
  const map = useMemo(() => renderTopologyMap(nodes, edges, theme, width, pulseMs, loading), [nodes, edges, theme, width, pulseMs, loading])

  return <pre className={`overflow-auto whitespace-pre ${className}`}>{map}</pre>
}

export type { EdgeStatus, NodeStatus }
