'use client'

import { useEffect, useRef, useState } from 'react'
import { apiUrl, wsUrl } from '../lib/endpoints'
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
} from './ui/floor-dashboard'
import { CrewStationsPanel } from './ui/CrewStationsPanel'
import { FloorPlanPanel } from './ui/FloorPlanPanel'
import { FloorHeader } from './ui/FloorHeader'
import { PnlPanel } from './ui/PnlPanel'
import { StatusStrip } from './ui/StatusStrip'
import { TapeSection } from './ui/TapeSection'
import { pageShellClass } from './ui/ascii-style'
import { X402AgentMaterialsPanel } from './ui/X402AgentMaterialsPanel'

type TapeLevel = 'INFO' | 'WARN' | 'ERROR'
type CrewRole = keyof typeof EMPTY_HEARTBEAT
type CrewLast = Record<CrewRole, TapeEntry | null>

const UI_TICK_MS = 1000
const RISK_DENIAL_SUPPRESS_MS = 180_000
const MAX_TRAJECTORY_POINTS = 240
const TRAJECTORY_REFRESH_MS = 8000

type SnapshotPayload = {
  type?: string
  ts?: unknown
  mode?: unknown
  healthCode?: unknown
  driftState?: unknown
  lastUpdateAt?: unknown
  message?: unknown
  pnlPct?: unknown
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

  if (typeof payload.data === 'object' && payload.data !== null && payload.data !== null) {
    return pickFromRecord(payload.data as Record<string, unknown>)
  }

  return undefined
}

function normalizeSnapshot(payload: SnapshotPayload, fallback: Snapshot): Snapshot {
  const rawOpenPositions = payload.openPositions ?? payload.open_positions ?? payload.positions
  const nextPnl = pickPnlPercent(payload)
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
        : fallback.lastUpdateAt,
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
  const [nowTick, setNowTick] = useState<number>(Date.now())
  const [pnlSeries, setPnlSeries] = useState<Array<{ ts: string; pnlPct: number }>>([])
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
  const [deckHeartbeatMs, setDeckHeartbeatMs] = useState<number>(Date.now())
  const [riskDeniedCount, setRiskDeniedCount] = useState(0)
  const [riskDeniedSuppressed, setRiskDeniedSuppressed] = useState(0)
  const [riskDeniedReason, setRiskDeniedReason] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const riskDenialRef = useRef<{ signature: string; atMs: number }>({ signature: '', atMs: 0 })
  const seenTapeRef = useRef<Set<string>>(new Set())

  const tapeRef = useRef<HTMLDivElement | null>(null)
  const lastPnlSampleAtRef = useRef<number>(0)

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), UI_TICK_MS)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    tapeRef.current?.scrollTo({ top: 0 })
  }, [tape])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

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
      if (nextPnlPct === undefined) return
      const ts = typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : new Date().toISOString()
      const now = Date.now()
      if (now - lastPnlSampleAtRef.current < TRAJECTORY_REFRESH_MS) return
      lastPnlSampleAtRef.current = now
      setPnlSeries((current) => [...current, { ts, pnlPct: nextPnlPct }].slice(-MAX_TRAJECTORY_POINTS))
    }

    const load = async () => {
      try {
        const [snapshotResponse, tapeResponse] = await Promise.all([
          fetch(apiUrl('/v1/public/floor-snapshot')),
          fetch(apiUrl('/v1/public/floor-tape')),
        ])

        if (snapshotResponse.ok) {
          const rawSnapshot = (await snapshotResponse.json()) as SnapshotPayload
          setSnapshot((current) => normalizeSnapshot(rawSnapshot, current))
          setDeckHeartbeatMs(Date.now())
          samplePnl(rawSnapshot)
        }

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

          if (initialTape.length > 0) {
            setTape(initialTape.slice(0, TAPE_DISPLAY_LIMIT))
          }
        }
      } catch {
        // initial load network issues are non-fatal
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
          socket?.send(JSON.stringify({ type: 'sub.add', channel: 'public' }))
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
            const parsed = JSON.parse(event.data as string) as { type: string; payload: unknown; channel?: string }
            if (parsed.type !== 'event' || parsed.channel !== 'public') return
            const payload = parsed.payload as SnapshotPayload
            const payloadType = payload?.type

            if (payloadType === 'STATE_UPDATE') {
              setSnapshot((current) => normalizeSnapshot(payload, current))
              setDeckHeartbeatMs(Date.now())
              samplePnl(payload)
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

            if (payloadType === 'FLOOR_TAPE') {
              const entry = normalizeTapeEntry(payload)
              if (!entry) return
              if (shouldRenderTapeLine(entry)) {
                setTape((current) => [entry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
              }
              return
            }
          } catch (error) {
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

        socket.onclose = () => {
          if (!running) return
          setWsState('CLOSED')
          const disconnectedEntry = normalizeTapeEntry({
            ts: new Date().toISOString(),
            role: 'ops',
            level: 'WARN',
            line: 'ws disconnected, reconnecting',
          })
          if (disconnectedEntry && shouldRenderTapeLine(disconnectedEntry)) {
            setTape((current) => [disconnectedEntry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
          }
          reconnectTimer = setTimeout(connect, 1500)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch (error) {
        setWsState('CLOSED')
        const connectErrorEntry = normalizeTapeEntry({
          ts: new Date().toISOString(),
          role: 'ops',
          level: 'WARN',
          line: `ws connect failed: ${String(error).slice(0, 120)}`,
        })
        if (connectErrorEntry && shouldRenderTapeLine(connectErrorEntry)) {
          setTape((current) => [connectErrorEntry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
        }
        reconnectTimer = setTimeout(connect, 1500)
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
  const heartbeatMs = Date.now() - deckHeartbeatMs
  const snapshotAgeMs = Number.isFinite(Date.parse(snapshot.lastUpdateAt)) ? nowTick - Date.parse(snapshot.lastUpdateAt) : 0

  return (
    <main className={pageShellClass}>
      <FloorHeader />
      <div className='space-y-2'>
        <StatusStrip
          isLoading={isBootstrapping}
          snapshot={snapshot}
          wsState={wsState}
          suppressedNoAction={suppressedNoAction}
          riskDeniedCount={riskDeniedCount}
          heartbeatAgeMs={heartbeatMs}
          snapshotAgeMs={snapshotAgeMs}
          deckFeedAgeMs={deckFeedAgeMs}
          deckMissing={deckMissing}
        />
        <PnlPanel snapshot={snapshot} trajectory={pnlSeries} isLoading={isBootstrapping} />
        <FloorPlanPanel
          isLoading={isBootstrapping}
          crewHeartbeat={crewHeartbeat}
          nowMs={crewNow}
          deckFeedAgeMs={deckFeedAgeMs}
          deckMissing={deckMissing}
          deckHeartbeatMs={deckHeartbeatMs}
        />
        <CrewStationsPanel
          crewLast={crewLast}
          crewHeartbeat={crewHeartbeat}
          crewSignals={crewSignals}
          nowMs={crewNow}
          isLoading={isBootstrapping}
        />
        <TapeSection tape={tape} tapeRef={tapeRef} isLoading={isBootstrapping} />
        <X402AgentMaterialsPanel />
      </div>
    </main>
  )
}
