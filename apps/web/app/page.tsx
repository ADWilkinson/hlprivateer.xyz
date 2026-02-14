'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl, wsUrl } from '../lib/endpoints'
import {
  type CrewHeartbeat,
  type CrewStats,
  type Snapshot,
  TAPE_DISPLAY_LIMIT,
  type TapeEntry,
  type WsState,
  normalizeCrewRole,
  normalizeTapeLinePrefix,
  parseDeckStatus,
  renderAsciiChart,
  shouldSuppressTapeLine,
  EMPTY_HEARTBEAT,
  EMPTY_STATS,
} from './ui/floor-dashboard'
import { CrewStationsPanel } from './ui/CrewStationsPanel'
import { FloorPlanPanel } from './ui/FloorPlanPanel'
import { FloorFooter } from './ui/FloorFooter'
import { FloorHeader } from './ui/FloorHeader'
import { PnlPanel } from './ui/PnlPanel'
import { StatusStrip } from './ui/StatusStrip'
import { TapeSection } from './ui/TapeSection'
import { pageShellClass } from './ui/ascii-style'

type TapeLevel = 'INFO' | 'WARN' | 'ERROR'
type CrewRole = keyof typeof EMPTY_HEARTBEAT
type CrewLast = Record<CrewRole, TapeEntry | null>

const chartWidth = 64
const chartHeight = 12
const UI_TICK_MS = 1000
const RISK_DENIAL_SUPPRESS_MS = 45_000

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
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [riskDeniedCount, setRiskDeniedCount] = useState(0)
  const [riskDeniedSuppressed, setRiskDeniedSuppressed] = useState(0)
  const [riskDeniedReason, setRiskDeniedReason] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const riskDenialRef = useRef<{ signature: string; atMs: number }>({ signature: '', atMs: 0 })
  const seenTapeRef = useRef<Set<string>>(new Set())

  const tapeRef = useRef<HTMLDivElement | null>(null)
  const lastPnlSampleAtRef = useRef<number>(0)

  useEffect(() => {
    const stored = localStorage.getItem('hlp-theme')
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored)
      return
    }

    const theme = document.documentElement.dataset.theme
    if (theme === 'light' || theme === 'dark') {
      setTheme(theme)
    }
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), UI_TICK_MS)
    return () => clearInterval(tick)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('hlp-theme', next)
    document.documentElement.setAttribute('data-theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  const chart = useMemo(() => {
    const values = pnlSeries.map((point) => point.pnlPct)
    return renderAsciiChart(values, chartWidth, chartHeight).chart
  }, [pnlSeries])

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

    const recordDeckStatus = (line: string) => {
      if (!/^deck status /.test(line)) return
      const parsed = parseDeckStatus(line)
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
      const isDeckStatus = /^deck status /i.test(lowered)
      const isRiskDenial = /^risk denied\b/i.test(lowered)

      if (isDeckStatus) {
        recordDeckStatus(normalizedLine)
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

        return false
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

    const samplePnl = (payload: { pnlPct?: unknown; lastUpdateAt?: unknown }) => {
      const pnlPct = Number(payload.pnlPct)
      if (!Number.isFinite(pnlPct)) return
      const ts = typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : new Date().toISOString()
      const now = Date.now()
      if (now - lastPnlSampleAtRef.current < 8000) return
      lastPnlSampleAtRef.current = now
      setPnlSeries((current) => [...current, { ts, pnlPct }].slice(-240))
    }

    const load = async () => {
      try {
        const [snapshotResponse, tapeResponse] = await Promise.all([
          fetch(apiUrl('/v1/public/floor-snapshot')),
          fetch(apiUrl('/v1/public/floor-tape')),
        ])

        if (snapshotResponse.ok) {
          const next = (await snapshotResponse.json()) as Snapshot
          setSnapshot(next)
          setDeckHeartbeatMs(Date.now())
          samplePnl(next)
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
            const payload = parsed.payload as { type?: string; ts?: unknown; role?: unknown; level?: unknown; line?: unknown; message?: unknown; pnlPct?: unknown; lastUpdateAt?: unknown }
            const payloadType = payload?.type

            if (payloadType === 'STATE_UPDATE') {
              setSnapshot(payload as Snapshot)
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
      <FloorHeader theme={theme} apiBase={apiUrl('')} onToggleTheme={toggleTheme} />
      <div className='space-y-2'>
        <StatusStrip
          isLoading={isBootstrapping}
          snapshot={snapshot}
          wsState={wsState}
          suppressedNoAction={suppressedNoAction}
          riskDeniedCount={riskDeniedCount}
          riskDeniedSuppressed={riskDeniedSuppressed}
          riskDeniedReason={riskDeniedReason}
          heartbeatAgeMs={heartbeatMs}
          snapshotAgeMs={snapshotAgeMs}
          deckFeedAgeMs={deckFeedAgeMs}
          deckMissing={deckMissing}
        />
        <PnlPanel snapshot={snapshot} chart={chart} isLoading={isBootstrapping} />
        <FloorPlanPanel
          isLoading={isBootstrapping}
          crewHeartbeat={crewHeartbeat}
          nowMs={crewNow}
          deckFeedAgeMs={deckFeedAgeMs}
          deckMissing={deckMissing}
          deckHeartbeatMs={deckHeartbeatMs}
          theme={theme}
        />
        <CrewStationsPanel
          crewLast={crewLast}
          crewHeartbeat={crewHeartbeat}
          crewSignals={crewSignals}
          nowMs={crewNow}
          isLoading={isBootstrapping}
        />
        <TapeSection tape={tape} tapeRef={tapeRef} isLoading={isBootstrapping} />
        <FloorFooter apiEndpoint={apiUrl('/v1/agent/analysis/latest')} />
      </div>
    </main>
  )
}
