export type WsState = 'CONNECTING' | 'OPEN' | 'CLOSED'
export type TapeLevel = 'INFO' | 'WARN' | 'ERROR'

export type CrewRole =
  | 'scout'
  | 'research'
  | 'strategist'
  | 'execution'
  | 'risk'
  | 'scribe'
  | 'ops'

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const next = Number(value.trim())
    if (Number.isFinite(next)) return next
  }
  return undefined
}

export interface OpenPosition extends Record<string, unknown> {
  id?: string
  symbol: string
  side?: string
  size?: number
  entryPrice?: number
  markPrice?: number
  pnlUsd?: number
  pnlPct?: number
  notionalUsd?: number
}

function normalizeSide(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().toUpperCase()
}

function normalizePositionRecord(raw: unknown): OpenPosition | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>

  const symbol =
    typeof input.symbol === 'string'
      ? input.symbol
      : typeof input.instrument === 'string'
        ? input.instrument
        : typeof input.market === 'string'
          ? input.market
          : ''

  const trimmedSymbol = symbol.trim()
  if (!trimmedSymbol) return null

  const entryPrice = toFiniteNumber(
    input.entryPrice ??
      input.entry_price ??
      input.entry ??
      input.avgEntryPx ??
      input.avg_entry_px ??
      input.avgEntry ??
      input.avg_entry ??
      input.avgEntryPrice ??
      input.avg_entry_price ??
      input.entryPx ??
      input.entry_px ??
      input.avgPx ??
      input.avg_px
  )
  const markPrice = toFiniteNumber(
    input.markPrice ??
      input.mark_price ??
      input.mark ??
      input.avgMarkPx ??
      input.avg_mark_px ??
      input.avgMark ??
      input.avg_mark ??
      input.lastPx ??
      input.last_px ??
      input.markPx ??
      input.mark_px
  )
  const pnlUsd = toFiniteNumber(input.pnlUsd ?? input.pnl_usd ?? input.pnl ?? input.unrealizedPnl ?? input.unrealized)
  const pnlPct = toFiniteNumber(input.pnlPct ?? input.pnl_pct ?? input.pnlPercent ?? input.pnl_percent)
  const notionalUsd = toFiniteNumber(input.notionalUsd ?? input.notional_usd ?? input.notional)
  const size = toFiniteNumber(input.size ?? input.qty ?? input.amount ?? input.quantity)

  return {
    id:
      typeof input.id === 'string'
        ? input.id
        : typeof input.positionId === 'string'
          ? input.positionId
          : typeof input.positionId === 'number'
            ? String(input.positionId)
            : undefined,
    symbol: trimmedSymbol,
    side: normalizeSide(input.side ?? input.direction),
    size,
    entryPrice,
    markPrice,
    pnlUsd,
    pnlPct,
    notionalUsd,
  }
}

export function normalizeOpenPositions(raw: unknown): OpenPosition[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizePositionRecord).filter((position): position is OpenPosition => position !== null).slice(0, 200)
}

export interface Snapshot {
  mode: string
  pnlPct: number
  accountValueUsd?: number
  healthCode: string
  driftState: string
  lastUpdateAt: string
  message?: string
  openPositions?: OpenPosition[]
  openPositionCount?: number
  openPositionNotionalUsd?: number
}

export type TapeEntry = {
  ts: string
  role?: string
  level?: TapeLevel
  line: string
}

export const TAPE_DISPLAY_LIMIT = 64

export type CrewHeartbeat = Record<CrewRole, number>
export type CrewStats = Record<CrewRole, number>

export const CREW: CrewRole[] = ['scout', 'research', 'strategist', 'execution', 'risk', 'scribe', 'ops']
export const HEARTBEAT_WINDOW_MS = 90_000
export const SILENCE_REFRESH_MS = 3_000

export const EMPTY_HEARTBEAT: CrewHeartbeat = CREW.reduce(
  (seed, role) => {
    seed[role] = 0
    return seed
  },
  {} as CrewHeartbeat
)

export const EMPTY_STATS: CrewStats = CREW.reduce(
  (seed, role) => {
    seed[role] = 0
    return seed
  },
  {} as CrewStats
)

export function badgeVariantForHealth(code: string): 'ok' | 'warn' | 'danger' {
  const status = code.toUpperCase().trim()
  if (status === 'GREEN' || status === 'HEALTHY' || status === 'OK' || status === 'GOOD') return 'ok'
  if (status === 'YELLOW' || status === 'WARNING' || status === 'WARN') return 'warn'
  return 'danger'
}

export function healthStatusLabel(code: string): string {
  const status = code.toUpperCase().trim()
  if (status === 'GREEN' || status === 'HEALTHY' || status === 'OK' || status === 'GOOD') return 'HEALTHY'
  if (status === 'YELLOW' || status === 'WARNING' || status === 'WARN') return 'CAUTION'
  return 'DEGRADED'
}

export function badgeVariantForDrift(state: string): 'ok' | 'warn' | 'danger' {
  const next = state.toUpperCase().trim()
  if (next === 'IN_TOLERANCE') return 'ok'
  if (next === 'POTENTIAL_DRIFT') return 'warn'
  return 'danger'
}

export function driftStatusLabel(state: string): string {
  const drift = state.toUpperCase().trim()
  if (drift === 'IN_TOLERANCE') return 'STABLE'
  if (drift === 'POTENTIAL_DRIFT') return 'DRIFTING'
  return 'ALERT'
}

export function crewLabel(role: CrewRole): string {
  if (role === 'scout') return 'SCOUT'
  if (role === 'research') return 'RESEARCH'
  if (role === 'strategist') return 'STRATEGIST'
  if (role === 'execution') return 'EXECUTION'
  if (role === 'risk') return 'RISK'
  if (role === 'scribe') return 'SCRIBE'
  return 'OPS'
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
  } catch {
    return '--:--:--'
  }
}

export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function heartbeatLevel(lastPingMs: number, nowMs: number): number {
  if (!lastPingMs) return 0
  const age = Math.max(0, nowMs - lastPingMs)
  if (age <= 5_000) return 100
  if (age >= HEARTBEAT_WINDOW_MS) return 18
  return Math.round(100 - ((age - 5_000) * 82) / (HEARTBEAT_WINDOW_MS - 5_000))
}

export function normalizeCrewRole(role: unknown): CrewRole | undefined {
  if (typeof role !== 'string') return undefined
  if (!CREW.includes(role as CrewRole)) return undefined
  return role as CrewRole
}

export function normalizeTapeLinePrefix(line: string): string {
  return line.trim().replace(/^\[[^\]]+\]\s*/i, '')
}

export function shouldSuppressTapeLine(line: string): boolean {
  const normalized = normalizeTapeLinePrefix(line)
  return (
    !normalized ||
    /\b(no action|no changes?|awaiting agent proposal|idle|no-op)\b/i.test(normalized) ||
    /^(?:floor|system|deck) status /i.test(normalized)
  )
}

export function parseSystemStatus(line: string): { feedAgeMs: number | undefined; missing: number | undefined } {
  const feedAgeMatch = /feedAgeMs=(\d+)/.exec(line)
  const missingMatch = /missing=(\d+)/.exec(line)
  return {
    feedAgeMs: feedAgeMatch ? Number(feedAgeMatch[1]) : undefined,
    missing: missingMatch ? Number(missingMatch[1]) : undefined,
  }
}

export function renderAsciiChart(values: number[], width: number, height: number): { chart: string; min: number; max: number } {
  const trimmed = values.filter((v) => Number.isFinite(v)).slice(-Math.max(width, 2))
  if (trimmed.length < 2) {
    const pad = Math.floor((width - 12) / 2)
    const empty = Array.from({ length: height }, () => '|' + ' '.repeat(width) + '|')
    const mid = Math.floor(height / 2)
    const msg = ' warming up '
    empty[mid] = '|' + ' '.repeat(pad) + msg + ' '.repeat(width - pad - msg.length) + '|'
    return {
      chart: ['+' + '-'.repeat(width) + '+', ...empty, '+' + '-'.repeat(width) + '+'].join('\n'),
      min: 0,
      max: 0,
    }
  }

  let min = Math.min(...trimmed)
  let max = Math.max(...trimmed)
  if (min === max) {
    min -= 0.5
    max += 0.5
  }

  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))
  for (let x = 0; x < width; x += 1) {
    const idx = Math.floor((x * (trimmed.length - 1)) / Math.max(1, width - 1))
    const v = trimmed[idx] ?? 0
    const t = (v - min) / (max - min)
    const y = height - 1 - Math.round(t * (height - 1))
    if (grid[y] && grid[y]![x] !== undefined) {
      grid[y]![x] = '*'
    }
  }

  const zeroLine = min < 0 && max > 0 ? height - 1 - Math.round(((0 - min) / (max - min)) * (height - 1)) : null
  if (zeroLine !== null) {
    for (let x = 0; x < width; x += 1) {
      if (grid[zeroLine]![x] === ' ') {
        grid[zeroLine]![x] = '.'
      }
    }
  }

  const lines = grid.map((row) => row.join(''))
  return {
    chart: [
      `+${'-'.repeat(width)}+ ${max.toFixed(3)}%`,
      ...lines.map((line) => `|${line}|`),
      `+${'-'.repeat(width)}+ ${min.toFixed(3)}%`,
    ].join('\n'),
    min,
    max,
  }
}

export function floorHeartbeatGlyph(level: number): string {
  if (level >= 75) return '*****'
  if (level >= 40) return '====='
  if (level >= 20) return '-----'
  if (level > 0) return '.....'
  return '_____'
}
