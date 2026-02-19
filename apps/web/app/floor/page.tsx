'use client'

import { useEffect, useRef, useState } from 'react'
import { apiUrl, wsUrl } from '../../lib/endpoints'
import {
  type CrewHeartbeat,
  type CrewStats,
  normalizeOpenPositions,
  type Snapshot,
  TAPE_DISPLAY_LIMIT,
  type TapeEntry,
  type WsState,
  normalizeCrewRole,
  normalizeTapeLinePrefix,
  parseSystemStatus,
  shouldSuppressTapeLine,
  EMPTY_HEARTBEAT,
  EMPTY_STATS,
} from '../ui/floor-dashboard'
import { AsciiDivider } from '../ui/AsciiDivider'
import { CrewStationsPanel } from '../ui/CrewStationsPanel'
import { FloorHeader } from '../ui/FloorHeader'
import { IntelligencePanel } from '../ui/IntelligencePanel'
import { PnlPanel } from '../ui/PnlPanel'
import { PositionsTable } from '../ui/PositionsTable'
import { StatusStrip } from '../ui/StatusStrip'
import { TapeSection } from '../ui/TapeSection'
import { pageShellClass } from '../ui/ascii-style'
import { X402AgentMaterialsPanel } from '../ui/X402AgentMaterialsPanel'

type TapeLevel = 'INFO' | 'WARN' | 'ERROR'
type CrewRole = keyof typeof EMPTY_HEARTBEAT
type CrewLast = Record<CrewRole, TapeEntry | null>
type SectionKey = 'status' | 'positions' | 'pnl' | 'crew' | 'intelligence' | 'tape' | 'x402'

const UI_TICK_MS = 1000
const RISK_DENIAL_SUPPRESS_MS = 180_000
const STANDBY_SUPPRESS_MS = 900_000
const MAX_TRAJECTORY_POINTS = 240
const TRAJECTORY_REFRESH_MS = 8000
const INITIAL_FETCH_TIMEOUT_MS = 7000
const RECONNECT_BASE_MS = 1500
const RECONNECT_MAX_MS = 15_000
const LOG_PREFIX = '[DeckPage]'
const DECK_PNL_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3, minimumFractionDigits: 3 })
const DECK_USD_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })
const PNL_SERIES_STORAGE_KEY = 'hlp-privateer:pnl-series-v1'
const ACCOUNT_SERIES_STORAGE_KEY = 'hlp-privateer:account-series-v1'

function readStoredSeries<T>(
  storageKey: string,
  pickPoint: (raw: unknown) => T | undefined,
): Array<T> {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => pickPoint(entry))
      .filter((entry): entry is T => entry !== undefined)
      .slice(-MAX_TRAJECTORY_POINTS)
  } catch {
    return []
  }
}

function writeStoredSeries<T>(storageKey: string, items: T[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items))
  } catch {
    return
  }
}

function truncate(value: unknown, max = 180): string {
  let next: string
  if (typeof value === 'string') {
    next = value
  } else if (typeof value === 'object' && value !== null) {
    try {
      next = JSON.stringify(value)
    } catch {
      next = String(value)
    }
  } else {
    next = String(value)
  }
  if (next.length <= max) return next
  return `${next.slice(0, max)}...`
}

function logInfo(message: string, details?: unknown): void {
  if (process.env.NODE_ENV === 'production') return
  // eslint-disable-next-line no-console
  console.info(`${LOG_PREFIX} ${message}`, details ? truncate(details) : '')
}

function logWarn(message: string, details?: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`${LOG_PREFIX} ${message}`, details ? truncate(details) : '')
}

function logError(message: string, details: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`${LOG_PREFIX} ${message}`, details ? truncate(details) : '')
}

type SnapshotPayload = {
  type?: string
  ts?: unknown
  mode?: unknown
  healthCode?: unknown
  driftState?: unknown
  lastUpdateAt?: unknown
  message?: unknown
  pnlPct?: unknown
  accountValue?: unknown
  accountValueUsd?: unknown
  account_value_usd?: unknown
  account_equity_usd?: unknown
  accountEquityUsd?: unknown
  equityUsd?: unknown
  equity?: unknown
  pnl?: unknown
  pnlPercent?: unknown
  pnl_percent?: unknown
  pnlPctCurrent?: unknown
  pnlPctChange?: unknown
  pnlChangePct?: unknown
  deltaPnlPct?: unknown
  openPositions?: unknown
  openPositionCount?: unknown
  openPositionNotionalUsd?: unknown
  positions?: unknown
  open_positions?: unknown
  openPositionNotional?: unknown
  open_position_count?: unknown
  open_position_notional?: unknown
  position_count?: unknown
  position_notional?: unknown
  positionNotional?: unknown
  realizedPnlUsd?: unknown
  realized_pnl_usd?: unknown
  data?: unknown
  [key: string]: unknown
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    const exact = Number(trimmed)
    if (Number.isFinite(exact)) return exact
    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function pickPnlPercent(payload: SnapshotPayload): number | undefined {
  const pickFromRecord = (value: Record<string, unknown>, depth = 0): number | undefined => {
    const maybe = toFiniteNumber(
      value.pnlPct ??
        value.pnl ??
        value.pnlPercent ??
        value.pnl_percent ??
        value.pnlPctCurrent ??
        value.pnlPctChange ??
        value.pnlChangePct ??
        value.deltaPnlPct ??
        value.value ??
        value.pct ??
        value.percent,
    )
    if (maybe !== undefined) return maybe

    if (depth >= 2) return undefined

    const nestedValue = value.pnl && typeof value.pnl === 'object' ? (value.pnl as object | undefined) : undefined
    if (nestedValue && typeof nestedValue === 'object') {
      const nestedPnl = nestedValue as Record<string, unknown>
      return pickFromRecord(nestedPnl, depth + 1)
    }

    return undefined
  }

  const root = toFiniteNumber(
    payload.pnlPct ??
      payload.pnl ??
      payload.pnlPercent ??
      payload.pnl_percent ??
      payload.pnlPctCurrent ??
      payload.pnlPctChange ??
      payload.pnlChangePct ??
      payload.deltaPnlPct,
  )

  if (root !== undefined) return root

  if (typeof payload.data === 'object' && payload.data !== null) {
    return pickFromRecord(payload.data as Record<string, unknown>)
  }

  return undefined
}

function pickAccountValueUsd(payload: SnapshotPayload): number | undefined {
  const pickFromRecord = (value: Record<string, unknown>, depth = 0): number | undefined => {
    const maybe = toFiniteNumber(
      value.accountValue ??
        value.accountValueUsd ??
        value.account_value_usd ??
        value.accountEquityUsd ??
        value.account_equity_usd ??
        value.equityUsd ??
        value.equity ??
        value.account ??
        value.balance ??
        value.accountBalance ??
        value.walletBalance ??
        value.value,
    )
    if (maybe !== undefined) return maybe

    if (depth >= 2) return undefined

    const nestedValue = value.account && typeof value.account === 'object' ? (value.account as object | undefined) : undefined
    if (nestedValue && typeof nestedValue === 'object') {
      return pickFromRecord(nestedValue as Record<string, unknown>, depth + 1)
    }

    const walletValue = value.wallet && typeof value.wallet === 'object' ? (value.wallet as object | undefined) : undefined
    if (walletValue && typeof walletValue === 'object') {
      return pickFromRecord(walletValue as Record<string, unknown>, depth + 1)
    }

    return undefined
  }

  return pickFromRecord(payload)
}

function normalizeSnapshot(payload: SnapshotPayload, fallback: Snapshot): Snapshot {
  const rawOpenPositions = payload.openPositions ?? payload.open_positions ?? payload.positions
  const nextPnl = pickPnlPercent(payload)
  const nextAccountValueUsd = pickAccountValueUsd(payload)
  const nextOpenPositionCount = toFiniteNumber(payload.openPositionCount ?? payload.open_position_count)
    ?? toFiniteNumber(payload.position_count)
    ?? toFiniteNumber(payload.positionCount)
    ?? (Array.isArray(rawOpenPositions) ? rawOpenPositions.length : undefined)
  const nextOpenPositionNotionalUsd = toFiniteNumber(
    payload.openPositionNotionalUsd ??
      payload.openPositionNotional ??
      payload.positionNotional ??
      payload.position_notional ??
      payload.open_position_notional,
  )

  return {
    ...fallback,
    mode: typeof payload.mode === 'string' ? payload.mode : fallback.mode,
    healthCode: typeof payload.healthCode === 'string' ? payload.healthCode : fallback.healthCode,
    driftState: typeof payload.driftState === 'string' ? payload.driftState : fallback.driftState,
    lastUpdateAt:
      typeof payload.lastUpdateAt === 'string' && payload.lastUpdateAt
        ? payload.lastUpdateAt
        : new Date().toISOString(),
    message: typeof payload.message === 'string' ? payload.message : undefined,
    pnlPct: nextPnl !== undefined ? nextPnl : fallback.pnlPct,
    openPositions:
      'openPositions' in payload || 'positions' in payload || 'open_positions' in payload
        ? normalizeOpenPositions(rawOpenPositions)
        : fallback.openPositions,
    openPositionCount:
      'openPositionCount' in payload || 'open_position_count' in payload || 'position_count' in payload
        ? (nextOpenPositionCount ?? fallback.openPositionCount)
        : fallback.openPositionCount,
    openPositionNotionalUsd:
      'openPositionNotionalUsd' in payload || 'openPositionNotional' in payload || 'positionNotional' in payload || 'open_position_notional' in payload || 'position_notional' in payload
        ? (nextOpenPositionNotionalUsd ?? fallback.openPositionNotionalUsd)
        : fallback.openPositionNotionalUsd,
    accountValueUsd: nextAccountValueUsd,
    realizedPnlUsd: toFiniteNumber(payload.realizedPnlUsd ?? payload.realized_pnl_usd),
  }
}

function normalizeTapePrefix(line: string): string {
  return normalizeTapeLinePrefix(line.trim())
}

function normalizeRiskDenial(text: string): { signature: string; display: string } {
  const normalizedText = normalizeTapePrefix(text)
  const reason = normalizedText.replace(/^risk denied\s*:?\s*/i, '').trim()
  const display = reason
    .replace(/\b[a-f0-9]{10,}\b/gi, '<id>')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const signature = reason
    .split('|')
    .map((entry) => entry.split(':')[0]?.trim())
    .map((entry) => entry?.toUpperCase())
    .filter((entry): entry is string => !!entry)
    .map((entry) => entry.replace(/\d+/g, ''))
    .map((entry) => entry.replace(/\s+/g, ' '))
    .filter((entry) => entry.length > 0)
    .join('|')

  return {
    signature: signature || display || 'no reason',
    display: display || 'no reason',
  }
}

function parseLevel(level: unknown): TapeEntry['level'] {
  return level === 'WARN' || level === 'ERROR' ? level : 'INFO'
}

function normalizeTapeEntry(input: { ts?: unknown; role?: unknown; level?: unknown; line?: unknown }): TapeEntry | null {
  const line = typeof input.line === 'string' ? input.line.trim() : ''
  if (!line) {
    return null
  }

  return {
    ts: typeof input.ts === 'string' ? input.ts : new Date().toISOString(),
    role: typeof input.role === 'string' ? input.role : undefined,
    level: parseLevel(input.level),
    line,
  }
}

export default function DeckPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    mode: 'INIT',
    pnlPct: 0,
    healthCode: 'GREEN',
    driftState: 'IN_TOLERANCE',
    lastUpdateAt: new Date().toISOString(),
    openPositions: [],
  }))
  const [tape, setTape] = useState<TapeEntry[]>([
    { ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: 'booting floor' },
  ])
  const [wsState, setWsState] = useState<WsState>('CONNECTING')
  const [nowTick, setNowTick] = useState<number>(() => Date.now())
  const [pnlSeries, setPnlSeries] = useState<Array<{ ts: string; pnlPct: number }>>(() =>
    readStoredSeries<{ ts: string; pnlPct: number }>(PNL_SERIES_STORAGE_KEY, (raw) => {
      if (
        !raw ||
        typeof raw !== 'object' ||
        typeof (raw as { ts?: unknown }).ts !== 'string' ||
        typeof (raw as { pnlPct?: unknown }).pnlPct !== 'number' ||
        !Number.isFinite((raw as { pnlPct: number }).pnlPct) ||
        (raw as { pnlPct: number }).pnlPct === 0
      ) {
        return undefined
      }
      return { ts: (raw as { ts: string }).ts, pnlPct: (raw as { pnlPct: number }).pnlPct }
    }),
  )
  const [accountValueSeries, setAccountValueSeries] = useState<Array<{ ts: string; accountValueUsd: number }>>(() =>
    readStoredSeries<{ ts: string; accountValueUsd: number }>(
      ACCOUNT_SERIES_STORAGE_KEY,
      (raw) => {
        if (
          !raw ||
          typeof raw !== 'object' ||
          typeof (raw as { ts?: unknown }).ts !== 'string' ||
          typeof (raw as { accountValueUsd?: unknown }).accountValueUsd !== 'number' ||
          !Number.isFinite((raw as { accountValueUsd: number }).accountValueUsd) ||
          (raw as { accountValueUsd: number }).accountValueUsd === 0
        ) {
          return undefined
        }
        return {
          ts: (raw as { ts: string }).ts,
          accountValueUsd: (raw as { accountValueUsd: number }).accountValueUsd,
        }
      },
    ),
  )
  const [crewLast, setCrewLast] = useState<CrewLast>(() => ({
    scout: null,
    research: null,
    strategist: null,
    execution: null,
    risk: null,
    scribe: null,
    ops: null,
  }))
  const [crewHeartbeat, setCrewHeartbeat] = useState<CrewHeartbeat>(EMPTY_HEARTBEAT)
  const [crewSignals, setCrewSignals] = useState<CrewStats>(EMPTY_STATS)
  const [suppressedNoAction, setSuppressedNoAction] = useState(0)
  const [deckFeedAgeMs, setDeckFeedAgeMs] = useState<number>(0)
  const [deckMissing, setDeckMissing] = useState<number>(0)
  const [deckHeartbeatMs, setDeckHeartbeatMs] = useState<number>(() => Date.now())
  const [riskDeniedCount, setRiskDeniedCount] = useState(0)
  const [riskDeniedSuppressed, setRiskDeniedSuppressed] = useState(0)
  const [riskDeniedReason, setRiskDeniedReason] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>({
    status: false,
    positions: false,
    pnl: false,
    crew: false,
    intelligence: false,
    tape: false,
    x402: false,
  })
  const riskDenialRef = useRef<{ signature: string; atMs: number }>({ signature: '', atMs: 0 })
  const standbySeenRef = useRef<Record<string, number>>({})
  const seenTapeRef = useRef<Set<string>>(new Set())
  const reconnectAttemptsRef = useRef(0)

  const tapeRef = useRef<HTMLDivElement | null>(null)
  const lastPnlSampleAtRef = useRef<number>(0)
  const lastAccountValueSampleAtRef = useRef<number>(0)

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), UI_TICK_MS)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    writeStoredSeries(PNL_SERIES_STORAGE_KEY, pnlSeries)
  }, [pnlSeries])

  useEffect(() => {
    writeStoredSeries(ACCOUNT_SERIES_STORAGE_KEY, accountValueSeries)
  }, [accountValueSeries])

  useEffect(() => {
    tapeRef.current?.scrollTo({ top: 0 })
  }, [tape])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const fetchWithTimeout = async (url: string): Promise<Response> => {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), INITIAL_FETCH_TIMEOUT_MS)
      try {
        return await fetch(url, {
          cache: 'no-store',
          signal: controller.signal,
        })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    const scheduleReconnect = () => {
      const attempt = reconnectAttemptsRef.current
      const delayMs = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS)
      reconnectAttemptsRef.current = attempt + 1
      reconnectTimer = setTimeout(connect, delayMs)
    }

    const touchCrew = (role: CrewRole | undefined, level: TapeLevel, line: string) => {
      if (!role) return
      const now = Date.now()
      setCrewHeartbeat((current) => ({ ...current, [role]: now }))
      setCrewSignals((current) => ({ ...current, [role]: current[role] + 1 }))
      setCrewLast((current) => ({
        ...current,
        [role]: {
          ts: new Date(now).toISOString(),
          role,
          level,
          line,
        },
      }))
    }

    const recordSystemStatus = (line: string) => {
      if (!/^(?:floor|system|deck) status /i.test(line)) return
      const parsed = parseSystemStatus(line)
      if (parsed.feedAgeMs !== undefined) setDeckFeedAgeMs(parsed.feedAgeMs)
      if (parsed.missing !== undefined) setDeckMissing(parsed.missing)
      setDeckHeartbeatMs(Date.now())
    }

    const trimTapeDedupWindow = () => {
      if (seenTapeRef.current.size <= 500) return
      const next = Array.from(seenTapeRef.current)
      seenTapeRef.current = new Set(next.slice(-250))
    }

    const shouldRenderTapeLine = (entry: TapeEntry): boolean => {
      const role = normalizeCrewRole(entry.role)
      const normalizedLine = normalizeTapePrefix(entry.line)
      const lowered = normalizedLine.toLowerCase()
      const isDeckStatus = /^(?:floor|system|deck) status /i.test(lowered)
      const isRiskDenial = /^risk denied\b/i.test(lowered)

      if (isDeckStatus) {
        recordSystemStatus(normalizedLine)
        setSuppressedNoAction((value) => value + 1)
        return false
      }

      if (isRiskDenial) {
        const normalized = normalizeRiskDenial(entry.line)
        const { signature, display } = normalized
        const now = Date.now()
        const shouldSurfaceRiskDenial =
          now - riskDenialRef.current.atMs >= RISK_DENIAL_SUPPRESS_MS || riskDenialRef.current.signature !== signature
        if (!shouldSurfaceRiskDenial) {
          setRiskDeniedReason(display)
          setRiskDeniedSuppressed((value) => value + 1)
          return false
        }

        riskDenialRef.current = { signature, atMs: now }
        setRiskDeniedCount((value) => value + 1)
        setRiskDeniedReason(display)
        entry.role = 'ops'
        entry.level = 'WARN'
        entry.line = `risk denied: ${display}`
        return true
      }

      if (/\bstandby\b/i.test(lowered)) {
        const key = role ?? 'unknown'
        const now = Date.now()
        const lastSeen = standbySeenRef.current[key] ?? 0
        if (now - lastSeen < STANDBY_SUPPRESS_MS) {
          setSuppressedNoAction((value) => value + 1)
          return false
        }
        standbySeenRef.current[key] = now
        touchCrew(role, entry.level || 'INFO', entry.line)
        return true
      }

      if (shouldSuppressTapeLine(entry.line)) {
        setSuppressedNoAction((value) => value + 1)
        return false
      }

      touchCrew(role, entry.level || 'INFO', entry.line)

      const signature = `${entry.ts}|${role ?? ''}|${entry.level ?? 'INFO'}|${normalizedLine.toLowerCase()}`
      if (seenTapeRef.current.has(signature)) {
        return false
      }

      seenTapeRef.current.add(signature)
      trimTapeDedupWindow()
      return true
    }

    const samplePnl = (payload: SnapshotPayload) => {
      const nextPnlPct = pickPnlPercent(payload)
      if (nextPnlPct === undefined || nextPnlPct === 0) return
      const mode = typeof payload.mode === 'string' ? payload.mode : ''
      if (mode === 'INIT' || mode === 'WARMUP') return
      const ts = typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : new Date().toISOString()
      const now = Date.now()
      if (now - lastPnlSampleAtRef.current < TRAJECTORY_REFRESH_MS) return
      lastPnlSampleAtRef.current = now
      setPnlSeries((current) => [...current, { ts, pnlPct: nextPnlPct }].slice(-MAX_TRAJECTORY_POINTS))
    }

    const sampleAccountValue = (payload: SnapshotPayload) => {
      const nextAccountValueUsd = pickAccountValueUsd(payload)
      if (nextAccountValueUsd === undefined || nextAccountValueUsd === 0) return
      const mode = typeof payload.mode === 'string' ? payload.mode : ''
      if (mode === 'INIT' || mode === 'WARMUP') return
      const ts = typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : new Date().toISOString()
      const now = Date.now()
      if (now - lastAccountValueSampleAtRef.current < TRAJECTORY_REFRESH_MS) return
      lastAccountValueSampleAtRef.current = now
      setAccountValueSeries((current) =>
        [...current, { ts, accountValueUsd: nextAccountValueUsd }].slice(-MAX_TRAJECTORY_POINTS),
      )
    }

    const load = async () => {
      try {
        const [snapshotResult, tapeResult, trajectoryResult] = await Promise.allSettled([
          fetchWithTimeout(apiUrl('/v1/public/floor-snapshot')),
          fetchWithTimeout(apiUrl('/v1/public/floor-tape')),
          fetchWithTimeout(apiUrl('/v1/public/trajectory')),
        ])

        if (snapshotResult.status === 'fulfilled') {
          const snapshotResponse = snapshotResult.value
          if (snapshotResponse.ok) {
            const rawSnapshot = (await snapshotResponse.json()) as SnapshotPayload
            if (!running) return
            setSnapshot((current) => normalizeSnapshot(rawSnapshot, current))
            setDeckHeartbeatMs(Date.now())
            samplePnl(rawSnapshot)
            sampleAccountValue(rawSnapshot)
          } else {
            logWarn('snapshot fetch failed', {
              status: snapshotResponse.status,
              statusText: snapshotResponse.statusText,
              url: snapshotResponse.url,
            })
          }
        } else {
          logWarn('snapshot fetch threw', snapshotResult.reason)
        }

        if (tapeResult.status === 'fulfilled') {
          const tapeResponse = tapeResult.value
          if (tapeResponse.ok) {
            const rawTape = await tapeResponse.json()
            const loadedLines = Array.isArray(rawTape)
              ? rawTape
                  .map((line) => normalizeTapeEntry(line as Record<string, unknown>))
                  .filter((entry): entry is TapeEntry => entry !== null)
                  .reverse()
              : []
            const initialTape = loadedLines
              .map((entry) => (shouldRenderTapeLine(entry) ? entry : null))
              .filter((entry): entry is TapeEntry => entry !== null)

            if (running && initialTape.length > 0) {
              setTape(initialTape.slice(0, TAPE_DISPLAY_LIMIT))
            }
          } else {
            logWarn('tape fetch failed', {
              status: tapeResponse.status,
              statusText: tapeResponse.statusText,
              url: tapeResponse.url,
            })
          }
        } else {
          logWarn('tape fetch threw', tapeResult.reason)
        }

        if (trajectoryResult.status === 'fulfilled') {
          const trajectoryResponse = trajectoryResult.value
          if (trajectoryResponse.ok) {
            const rawTrajectory = await trajectoryResponse.json() as { points?: unknown[] }
            const serverPoints = Array.isArray(rawTrajectory?.points) ? rawTrajectory.points : []
            if (running && serverPoints.length > 0) {
              setPnlSeries((current) => {
                const serverPnl = serverPoints
                  .filter((p): p is { ts: string; pnlPct: number } =>
                    typeof p === 'object' && p !== null &&
                    typeof (p as { ts?: unknown }).ts === 'string' &&
                    typeof (p as { pnlPct?: unknown }).pnlPct === 'number' &&
                    Number.isFinite((p as { pnlPct: number }).pnlPct) &&
                    (p as { pnlPct: number }).pnlPct !== 0
                  )
                  .map((p) => ({ ts: p.ts, pnlPct: p.pnlPct }))
                const merged = [...serverPnl, ...current]
                  .sort((a, b) => a.ts.localeCompare(b.ts))
                const seen = new Set<string>()
                return merged.filter((p) => {
                  if (seen.has(p.ts)) return false
                  seen.add(p.ts)
                  return true
                }).slice(-MAX_TRAJECTORY_POINTS)
              })
              setAccountValueSeries((current) => {
                const serverAv = serverPoints
                  .filter((p): p is { ts: string; accountValueUsd: number } =>
                    typeof p === 'object' && p !== null &&
                    typeof (p as { ts?: unknown }).ts === 'string' &&
                    typeof (p as { accountValueUsd?: unknown }).accountValueUsd === 'number' &&
                    Number.isFinite((p as { accountValueUsd: number }).accountValueUsd) &&
                    (p as { accountValueUsd: number }).accountValueUsd > 0
                  )
                  .map((p) => ({ ts: p.ts, accountValueUsd: p.accountValueUsd }))
                const merged = [...serverAv, ...current]
                  .sort((a, b) => a.ts.localeCompare(b.ts))
                const seen = new Set<string>()
                return merged.filter((p) => {
                  if (seen.has(p.ts)) return false
                  seen.add(p.ts)
                  return true
                }).slice(-MAX_TRAJECTORY_POINTS)
              })
            }
          }
        }
      } catch (error) {
        logError('initial load failed', error)
      } finally {
        if (running) {
          setIsBootstrapping(false)
        }
      }
    }

    const connect = () => {
      if (!running) return
      try {
        setWsState('CONNECTING')
        socket = new WebSocket(wsUrl())

        socket.onopen = () => {
          logInfo('websocket connected', wsUrl())
          socket?.send(JSON.stringify({ type: 'sub.add', channel: 'public' }))
          reconnectAttemptsRef.current = 0
          setWsState('OPEN')
          const connectedEntry = normalizeTapeEntry({
            ts: new Date().toISOString(),
            role: 'ops',
            level: 'INFO',
            line: 'ws connected',
          })
          if (connectedEntry && shouldRenderTapeLine(connectedEntry)) {
            setTape((current) => [connectedEntry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
          }
        }

        socket.onmessage = (event) => {
          if (!running) return
          try {
            const parsed = JSON.parse(event.data as string) as { type?: unknown; payload?: unknown; channel?: unknown; ts?: unknown }
            const envelopeType =
              typeof parsed?.type === 'string' ? parsed.type.trim().toLowerCase() : ''
            const envelopeChannel = typeof parsed?.channel === 'string' ? parsed.channel : ''
            const hasEnvelopePayload = Object.prototype.hasOwnProperty.call(parsed, 'payload')
            const payload = (envelopeType === 'event' && envelopeChannel === 'public' && hasEnvelopePayload
              ? parsed.payload
              : parsed) as SnapshotPayload

            const envelopeHeartbeatTs = typeof parsed.ts === 'string' ? Date.parse(parsed.ts) : NaN

            if (envelopeType === 'heartbeat') {
              setDeckHeartbeatMs(Number.isFinite(envelopeHeartbeatTs) ? envelopeHeartbeatTs : Date.now())
              return
            }

            if (envelopeType === 'pong' || envelopeType === 'ping') {
              setDeckHeartbeatMs(Date.now())
              return
            }

            if (envelopeType === 'event' && envelopeChannel !== 'public') {
              logInfo('websocket envelope ignored', { type: envelopeType, channel: envelopeChannel })
              return
            }

            if (envelopeType === 'event' && envelopeChannel === 'public' && !hasEnvelopePayload) {
              logWarn('websocket event missing payload', { type: envelopeType, channel: envelopeChannel })
              return
            }

            if (!payload || typeof payload !== 'object') {
              logWarn('unhandled websocket payload type', payload)
              return
            }

            const payloadType =
              payload && typeof payload === 'object' && 'type' in payload && typeof payload.type === 'string'
                ? payload.type.trim().toLowerCase()
                : ''
            logInfo(`ws payloadType=${payloadType || 'unknown'}`)

            const isHeartbeatPayloadMessage = payloadType === 'heartbeat' ||
              (typeof (payload as Record<string, unknown>)?.type === 'string' &&
                String((payload as Record<string, unknown>).type).trim().toLowerCase() === 'heartbeat') ||
              payloadType === 'pong' ||
              payloadType === 'ping'

            if (isHeartbeatPayloadMessage) {
              if (typeof payload?.ts === 'string' && Number.isFinite(Date.parse(payload.ts))) {
                setDeckHeartbeatMs(Date.parse(payload.ts))
              } else {
                setDeckHeartbeatMs(Date.now())
              }
              return
            }

            if (!payloadType && payload && typeof payload === 'object' && 'ts' in payload && 'mode' in payload) {
              logWarn('ws payload missing type; falling back to state update inference', payload)
              setSnapshot((current) => normalizeSnapshot(payload as SnapshotPayload, current))
              setDeckHeartbeatMs(Date.now())
              samplePnl(payload as SnapshotPayload)
              sampleAccountValue(payload as SnapshotPayload)
              return
            }

            if (payloadType === 'state_update') {
              setSnapshot((current) => normalizeSnapshot(payload, current))
              setDeckHeartbeatMs(Date.now())
              samplePnl(payload)
              sampleAccountValue(payload)
              const message = typeof payload.message === 'string' ? payload.message : ''
              if (message) {
                const parsedMessage = normalizeTapeEntry({
                  ts: typeof payload.ts === 'string' ? payload.ts : new Date().toISOString(),
                  role: 'ops',
                  level: 'INFO',
                  line: message,
                })
                if (parsedMessage && shouldRenderTapeLine(parsedMessage)) {
                  setTape((current) => [parsedMessage, ...current].slice(0, TAPE_DISPLAY_LIMIT))
                }
              }
              return
            }

            if (payloadType === 'floor_tape') {
              const entry = normalizeTapeEntry(payload)
              if (!entry) return
              if (shouldRenderTapeLine(entry)) {
                setTape((current) => [entry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
              }
              return
            }

            if (typeof payload === 'object' && payload !== null) {
              const candidate = payload as SnapshotPayload
              if ('healthCode' in candidate || 'driftState' in candidate || 'accountValueUsd' in candidate) {
                setSnapshot((current) => normalizeSnapshot(candidate, current))
                setDeckHeartbeatMs(Date.now())
                samplePnl(candidate)
                sampleAccountValue(candidate)
                if (typeof candidate.message === 'string' && candidate.message) {
                  const parsedMessage = normalizeTapeEntry({
                    ts: typeof candidate.ts === 'string' ? candidate.ts : new Date().toISOString(),
                    role: 'ops',
                    level: 'INFO',
                    line: candidate.message,
                  })
                  if (parsedMessage && shouldRenderTapeLine(parsedMessage)) {
                    setTape((current) => [parsedMessage, ...current].slice(0, TAPE_DISPLAY_LIMIT))
                  }
                }
                return
              }
            }

            logWarn('unhandled websocket payload type', payload)
          } catch (error) {
            logError('failed to parse websocket message', { raw: truncate(event.data) })
            logError('websocket message parse error', error)
            const parseError = normalizeTapeEntry({
              ts: new Date().toISOString(),
              role: 'ops',
              level: 'WARN',
              line: `ws parse error: ${String(error).slice(0, 120)}`,
            })
            if (parseError) {
              if (shouldRenderTapeLine(parseError)) {
                setTape((current) => [parseError, ...current].slice(0, TAPE_DISPLAY_LIMIT))
              }
            }
          }
        }

        socket.onclose = (event) => {
          if (!running) return
          setWsState('CLOSED')
          logWarn('websocket closed', { code: event.code, reason: event.reason, wasClean: event.wasClean })
          const disconnectedEntry = normalizeTapeEntry({
            ts: new Date().toISOString(),
            role: 'ops',
            level: 'WARN',
            line: 'ws disconnected, reconnecting',
          })
          if (disconnectedEntry && shouldRenderTapeLine(disconnectedEntry)) {
            setTape((current) => [disconnectedEntry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
          }
          scheduleReconnect()
        }

        socket.onerror = (event) => {
          logError('websocket error', event)
          socket?.close()
        }
      } catch (error) {
        setWsState('CLOSED')
        logError('websocket connect exception', error)
        const connectErrorEntry = normalizeTapeEntry({
          ts: new Date().toISOString(),
          role: 'ops',
          level: 'WARN',
          line: `ws connect failed: ${String(error).slice(0, 120)}`,
        })
        if (connectErrorEntry && shouldRenderTapeLine(connectErrorEntry)) {
          setTape((current) => [connectErrorEntry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
        }
        scheduleReconnect()
      }
    }

    void load()
    connect()

    return () => {
      running = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (socket && socket.readyState < 2) socket.close()
    }
  }, [])

  const crewNow = nowTick
  const heartbeatMs = Math.max(0, nowTick - deckHeartbeatMs)
  const snapshotAgeMs = Number.isFinite(Date.parse(snapshot.lastUpdateAt)) ? nowTick - Date.parse(snapshot.lastUpdateAt) : 0
  const pnlStr = isBootstrapping ? '--' : `${snapshot.pnlPct >= 0 ? '+' : ''}${DECK_PNL_FMT.format(snapshot.pnlPct)}%`
  const equityStr = isBootstrapping || snapshot.accountValueUsd === undefined ? '--' : DECK_USD_FMT.format(snapshot.accountValueUsd)
  const modeStr = isBootstrapping ? '--' : snapshot.mode
  const pnlColor = isBootstrapping || snapshot.pnlPct === 0 ? 'text-hlpMuted' : snapshot.pnlPct > 0 ? 'text-hlpPositive' : 'text-hlpNegative'
  const realizedPnlUsd = snapshot.realizedPnlUsd
  const realizedStr =
    !isBootstrapping && realizedPnlUsd !== undefined && Number.isFinite(realizedPnlUsd)
      ? (realizedPnlUsd >= 0 ? `+${DECK_USD_FMT.format(realizedPnlUsd)}` : `-${DECK_USD_FMT.format(Math.abs(realizedPnlUsd))}`)
      : '--'
  const realizedColor =
    isBootstrapping || !realizedPnlUsd || realizedPnlUsd === 0
      ? 'text-hlpMuted'
      : realizedPnlUsd > 0
        ? 'text-hlpPositive'
        : 'text-hlpNegative'
  const toggleSection = (section: SectionKey) => {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  return (
    <main id='main-content' className={pageShellClass} aria-busy={isBootstrapping}>
        <h1 className='sr-only'>HL Privateer live trading floor</h1>
        <FloorHeader onX402Access={() => setCollapsedSections((current) => ({ ...current, x402: false }))} />

        <div className='flex flex-wrap items-end justify-center gap-x-10 gap-y-3 py-5 animate-hlp-fade-up-delay-1'>
          <div className='text-center'>
            <div className='text-[8px] uppercase tracking-[0.20em] text-hlpDim mb-1'>MARKET PNL</div>
            <div className={`text-[22px] sm:text-[28px] font-semibold tracking-[0.04em] leading-none ${pnlColor}`}>
              {pnlStr}
            </div>
          </div>
          <div className='text-hlpBorder/40 text-[22px] leading-none select-none hidden sm:block' aria-hidden='true'>|</div>
          <div className='text-center'>
            <div className='text-[8px] uppercase tracking-[0.20em] text-hlpDim mb-1'>ACCOUNT VALUE</div>
            <div className='text-[22px] sm:text-[28px] font-semibold tracking-[0.04em] leading-none text-hlpFg'>
              {equityStr}
            </div>
          </div>
          <div className='text-hlpBorder/40 text-[22px] leading-none select-none hidden sm:block' aria-hidden='true'>|</div>
          <div className='text-center'>
            <div className='text-[8px] uppercase tracking-[0.20em] text-hlpDim mb-1'>REALIZED</div>
            <div className={`text-[22px] sm:text-[28px] font-semibold tracking-[0.04em] leading-none ${realizedColor}`}>
              {realizedStr}
            </div>
          </div>
          <div className='text-hlpBorder/40 text-[22px] leading-none select-none hidden sm:block' aria-hidden='true'>|</div>
          <div className='text-center'>
            <div className='text-[8px] uppercase tracking-[0.20em] text-hlpDim mb-1'>MODE</div>
            <div className='text-[22px] sm:text-[28px] font-semibold tracking-[0.04em] leading-none text-hlpFg'>
              {modeStr}
            </div>
          </div>
        </div>

        <div className='space-y-3'>
          <StatusStrip
            isLoading={isBootstrapping}
            snapshot={snapshot}
            wsState={wsState}
            heartbeatAgeMs={heartbeatMs}
            snapshotAgeMs={snapshotAgeMs}
            isCollapsed={collapsedSections.status}
            onToggle={() => toggleSection('status')}
            sectionId='status'
          />

          <AsciiDivider variant='dots' />

          <PositionsTable
            positions={snapshot.openPositions ?? []}
            isLoading={isBootstrapping}
            isCollapsed={collapsedSections.positions}
            onToggle={() => toggleSection('positions')}
            sectionId='positions'
          />

          <AsciiDivider variant='compass' />

          <PnlPanel
            snapshot={snapshot}
            trajectory={pnlSeries}
            accountValueTrajectory={accountValueSeries}
            isLoading={isBootstrapping}
            isCollapsed={collapsedSections.pnl}
            onToggle={() => toggleSection('pnl')}
            sectionId='pnl'
          />

          <AsciiDivider variant='compass' />

          <CrewStationsPanel
            crewLast={crewLast}
            crewHeartbeat={crewHeartbeat}
            crewSignals={crewSignals}
            nowMs={crewNow}
            isLoading={isBootstrapping}
            isCollapsed={collapsedSections.crew}
            onToggle={() => toggleSection('crew')}
            sectionId='crew'
          />

          <AsciiDivider variant='dots' />

          <IntelligencePanel
            crewLast={crewLast}
            nowMs={crewNow}
            isLoading={isBootstrapping}
            isCollapsed={collapsedSections.intelligence}
            onToggle={() => toggleSection('intelligence')}
            sectionId='intelligence'
          />

          <AsciiDivider variant='dots' />

          <TapeSection
            tape={tape}
            tapeRef={tapeRef}
            isLoading={isBootstrapping}
            isCollapsed={collapsedSections.tape}
            onToggle={() => toggleSection('tape')}
            sectionId='tape'
          />

          <AsciiDivider variant='wave' />

          <X402AgentMaterialsPanel
            isCollapsed={collapsedSections.x402}
            onToggle={() => toggleSection('x402')}
            sectionId='x402'
          />
        </div>

        <footer className='mt-4 pb-4 text-center' aria-label='site footer'>
          <div className='text-[9px] uppercase tracking-[0.2em] text-hlpDim/30'>
            hlprivateer.xyz
          </div>
          <div className='mt-1 text-[8px] uppercase tracking-[0.16em] text-hlpDim/45'>
            feed {Math.max(0, deckFeedAgeMs)}ms | missing {Math.max(0, deckMissing)} | risk denied {riskDeniedCount}
            {' '}({riskDeniedSuppressed} suppressed) | no-action {suppressedNoAction}
          </div>
          {riskDeniedReason ? (
            <div className='mt-1 text-[8px] tracking-[0.12em] text-hlpDim/45'>{riskDeniedReason}</div>
          ) : null}
        </footer>
      </main>
  )
}
