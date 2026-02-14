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

export interface Snapshot {
  mode: string
  pnlPct: number
  healthCode: string
  driftState: string
  lastUpdateAt: string
  message?: string
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
  if (code === 'GREEN') return 'ok'
  if (code === 'YELLOW') return 'warn'
  return 'danger'
}

export function badgeVariantForDrift(state: string): 'ok' | 'warn' | 'danger' {
  if (state === 'IN_TOLERANCE') return 'ok'
  if (state === 'POTENTIAL_DRIFT') return 'warn'
  return 'danger'
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
    /^deck status /i.test(normalized)
  )
}

export function parseDeckStatus(line: string): { feedAgeMs: number | undefined; missing: number | undefined } {
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
    const empty = Array.from({ length: height }, () => '\u2502' + ' '.repeat(width) + '\u2502')
    const mid = Math.floor(height / 2)
    const msg = ' warming up '
    empty[mid] = '\u2502' + ' '.repeat(pad) + msg + ' '.repeat(width - pad - msg.length) + '\u2502'
    return {
      chart: ['\u250C' + '\u2500'.repeat(width) + '\u2510', ...empty, '\u2514' + '\u2500'.repeat(width) + '\u2518'].join('\n'),
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
      grid[y]![x] = '\u2588'
    }
  }

  const lines = grid.map((row) => row.join(''))
  return {
    chart: [
      `\u250C${'\u2500'.repeat(width)}\u2510 ${max.toFixed(3)}%`,
      ...lines.map((line) => `\u2502${line}\u2502`),
      `\u2514${'\u2500'.repeat(width)}\u2518 ${min.toFixed(3)}%`,
    ].join('\n'),
    min,
    max,
  }
}

export function floorHeartbeatGlyph(level: number): string {
  if (level >= 75) return '\u25CF\u25CF\u25CF\u25CF\u25CF'
  if (level >= 40) return '\u25D8\u25D8\u25D8\u25D8\u25D8'
  if (level >= 20) return '\u25D0\u25D0\u25D0\u25D0\u25D0'
  if (level > 0) return '\u25D5\u25D5\u25D5\u25D5'
  return '\u25A1\u25A1\u25A1\u25A1\u25A1'
}
