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

type EdgeGlyphs = {
  horizontal: [string, string]
  vertical: [string, string]
  diagonal: [string, string]
  marker: string
}

const nodeGlyph: Record<NodeStatus, string> = {
  online: '◉',
  warning: '◍',
  offline: '◌',
}

const nodePulseGlyph: Record<NodeStatus, [string, string]> = {
  online: ['◉', '◈'],
  warning: ['◍', '◌'],
  offline: ['◌', '◌'],
}

const edgeGlyph: Record<EdgeStatus, EdgeGlyphs> = {
  active: {
    horizontal: ['═', '─'],
    vertical: ['║', '│'],
    diagonal: ['╳', '╲'],
    marker: '◆',
  },
  warning: {
    horizontal: ['┈', '╌'],
    vertical: ['┆', '╎'],
    diagonal: ['╱', '╲'],
    marker: '◇',
  },
  congested: {
    horizontal: ['┄', '┈'],
    vertical: ['┆', '╎'],
    diagonal: ['┊', '╱'],
    marker: '◈',
  },
  error: {
    horizontal: ['┅', '╌'],
    vertical: ['┇', '╎'],
    diagonal: ['╳', '┈'],
    marker: '✕',
  },
  inactive: {
    horizontal: ['·', '·'],
    vertical: ['·', '·'],
    diagonal: ['·', '·'],
    marker: '·',
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

function edgeGlyphForStep(dx: number, dy: number, status: EdgeStatus, pulse: number): string {
  const glyphs = edgeGlyph[status]
  const horizontal = (Math.abs(dx) >= Math.abs(dy))
  const vertical = Math.abs(dy) > Math.abs(dx)

  if (horizontal) {
    return glyphs.horizontal[pulse % glyphs.horizontal.length] ?? glyphs.horizontal[0]
  }
  if (vertical) {
    return glyphs.vertical[pulse % glyphs.vertical.length] ?? glyphs.vertical[0]
  }
  return glyphs.diagonal[pulse % glyphs.diagonal.length] ?? glyphs.diagonal[0]
}

function drawLine(grid: string[][], p0: NodePos, p1: NodePos, status: EdgeStatus, pulse: number) {
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
    const stepDx = x === x1 ? 0 : x1 > x ? 1 : -1
    const stepDy = y === y1 ? 0 : y1 > y ? 1 : -1
    const glyph = edgeGlyphForStep(stepDx, stepDy, status, pulse)
    placeCell(grid, x, y, glyph)
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

function statusBadge(status: NodeStatus): string {
  return status === 'online' ? 'OK' : status === 'warning' ? 'WRN' : 'OFF'
}

function rankNode(nodes: AsciiTopologyNode[]) {
  const hub = nodes.find((node) => node.id === 'ops') ?? nodes[0]
  return hub
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function renderTopologyMap(
  nodes: AsciiTopologyNode[],
  edges: TopologyEdge[],
  widthPx: number,
  pulseMs = 0,
  loading = false,
): string {
  const widthPxSafe = Math.max(1, Math.floor(widthPx))
  const width = clamp(Math.floor(widthPxSafe / 6), 48, 150)
  const height = clamp(Math.floor(width * 0.48), 24, 64)
  const compact = width < 96
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))

  const pulse = Math.floor(pulseMs / 260)
  const framePadX = Math.max(2, Math.floor(width * 0.05))
  const framePadY = Math.max(1, Math.floor(height * 0.06))
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2) - 1

  const map = new Map<string, NodePos>()
  const hub = rankNode(nodes)
  if (hub) {
    map.set(hub.id, { x: clamp(centerX, framePadX, width - framePadX - 1), y: clamp(centerY, framePadY, height - framePadY - 1) })
  }

  const outer = nodes.filter((node) => node.id !== hub?.id)
  const outerRadiusX = Math.max(10, Math.floor((width - framePadX * 2) * 0.39))
  const outerRadiusY = Math.max(5, Math.floor((height - framePadY * 2) * 0.45))

  outer.forEach((node, index) => {
    const indexTotal = Math.max(1, outer.length)
    const angle = (index / indexTotal) * Math.PI * 2 - Math.PI / 2
    const x = Math.round((hub?.id ? centerX : map.get(nodes[0]!.id)!.x) + outerRadiusX * Math.cos(angle))
    const y = Math.round((hub?.id ? centerY : map.get(nodes[0]!.id)!.y) + outerRadiusY * Math.sin(angle))
    map.set(node.id, {
      x: clamp(x, framePadX, width - framePadX - 1),
      y: clamp(y, framePadY, height - framePadY - 1),
    })
  })

  const statusRank = (status: EdgeStatus) => (status === 'active' ? 0 : status === 'warning' ? 1 : status === 'congested' ? 2 : status === 'error' ? 3 : 4)

  const orderedEdges = [...edges].sort((a, b) => statusRank(a.status) - statusRank(b.status))
  orderedEdges.forEach((edge) => {
    if (compact && edge.id.startsWith('mesh-')) return
    const sourcePos = map.get(edge.source)
    const targetPos = map.get(edge.target)
    if (!sourcePos || !targetPos) return

    const edgePulse = pulse + hash(`${edge.id}:${loading ? 'a' : 'b'}`)
    drawLine(grid, sourcePos, targetPos, edge.status, edgePulse)

    if (!compact && edge.label && (edge.status === 'active' || edge.status === 'warning')) {
      const midX = Math.round((sourcePos.x + targetPos.x) / 2)
      const midY = Math.round((sourcePos.y + targetPos.y) / 2)
      const marker = edgeGlyph[edge.status].marker
      const label = `${marker} ${edge.label.replace('link:', '').replace('mesh:', '').replace(/^\s+/, '').slice(0, 6)}`
      const safeX = clamp(midX - Math.floor(label.length / 2), 1, width - 1 - label.length)
      drawText(grid, safeX, Math.max(1, Math.min(height - 2, midY)), label)
    }
  })

  nodes.forEach((node, index) => {
    const pos = map.get(node.id)
    if (!pos) return

    const pulseIndex = (pulse + hash(node.id)) % 4
    const pulseGlyph = loading ? nodeStatusPulse(node.status, 0) : nodeStatusPulse(node.status, pulseIndex)
    placeCell(grid, pos.x, pos.y, nodeGlyph[node.status], true)
    placeCell(grid, clamp(pos.x + ((index % 2 === 0 ? 1 : -1) * 0), pos.y, pulseGlyph, false)

    const label = node.label.slice(0, compact ? 3 : 6).toUpperCase()
    const labelX = clamp(pos.x - Math.floor(label.length / 2), 1, width - 1 - label.length)
    drawText(grid, labelX, Math.min(height - 1, pos.y + 1), label)

    if (!compact || node.id === 'ops') {
      const statusTag = `${statusBadge(node.status)}`
      const metaText = `${statusTag} ${node.metadata?.heartbeat ?? '--'}`
      const meta = loading ? `boot ${node.id.slice(0, 3)}` : metaText
      const metaX = clamp(pos.x - Math.floor(meta.length / 2), 1, width - 1 - meta.length)
      drawText(grid, metaX, Math.min(height - 1, pos.y + 2), meta)
    }
  })

  const body = grid.map((row) => row.join('')).join('\n')
  const frameTop = `╭${'─'.repeat(width - 2)}╮`
  const frameBottom = `╰${'─'.repeat(width - 2)}╯`

  return `${frameTop}\n${body}\n${frameBottom}`
}

function nodeStatusPulse(status: NodeStatus, pulse: number) {
  return nodePulseGlyph[status][pulse % nodePulseGlyph[status].length] ?? nodePulseGlyph[status][0]
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
  const map = useMemo(() => renderTopologyMap(nodes, edges, width, pulseMs, loading), [nodes, edges, width, pulseMs, loading])
  const accentClass = theme === 'dark' ? 'text-hlpFgDark' : 'text-hlpFg'

  return <pre className={`overflow-hidden whitespace-pre ${className} ${accentClass} max-w-full`}>{map}</pre>
}

export type { EdgeStatus, NodeStatus }
