'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl, wsUrl } from '../lib/endpoints'
import {
  type CrewHeartbeat,
  type CrewStats,
  type Snapshot,
  type TapeEntry,
  type WsState,
  asciiLogo,
  normalizeCrewRole,
  parseDeckStatus,
  renderAsciiChart,
  shouldSuppressTapeLine,
  EMPTY_HEARTBEAT,
  EMPTY_STATS,
  SILENCE_REFRESH_MS,
} from './ui/floor-dashboard'
import { CREW } from './ui/floor-dashboard'
import { CrewStationsPanel } from './ui/CrewStationsPanel'
import { FloorFooter } from './ui/FloorFooter'
import { FloorHeader } from './ui/FloorHeader'
import { FloorPlanPanel } from './ui/FloorPlanPanel'
import { PnlPanel } from './ui/PnlPanel'
import { StatusStrip } from './ui/StatusStrip'
import { TapeSection } from './ui/TapeSection'

type TapeLevel = 'INFO' | 'WARN' | 'ERROR'
type CrewRole = keyof typeof EMPTY_HEARTBEAT
type CrewLast = Record<CrewRole, TapeEntry | null>

const chartWidth = 64
const chartHeight = 12

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
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [riskDeniedCount, setRiskDeniedCount] = useState(0)
  const [riskDeniedReason, setRiskDeniedReason] = useState('')
  const riskDenialRef = useRef<{ signature: string; atMs: number }>({ signature: '', atMs: 0 })

  const logo = useMemo(() => asciiLogo(), [])
  const tapeRef = useRef<HTMLDivElement | null>(null)
  const lastPnlSampleAtRef = useRef<number>(0)

  useEffect(() => {
    const stored = localStorage.getItem('hlp-theme')
    if (stored === 'light') setTheme('light')
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), SILENCE_REFRESH_MS)
    return () => clearInterval(tick)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('hlp-theme', next)
    document.documentElement.setAttribute('data-theme', next)
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

    const pushTape = (entry: TapeEntry) => {
      const lowered = entry.line.toLowerCase()
      const isRiskDenial = lowered.startsWith('risk denied')
      if (isRiskDenial) {
        const match = entry.line.match(/risk denied\s*\(([^)]*)\)/i)
        const signature = match?.[1] ? match[1].trim() : 'no reason'
        const now = Date.now()
        const shouldSurfaceRiskDenial =
          now - riskDenialRef.current.atMs >= 60_000 || riskDenialRef.current.signature !== signature
        if (!shouldSurfaceRiskDenial) {
          setRiskDeniedReason(signature || '')
          return
        }

        riskDenialRef.current = { signature, atMs: now }
        setRiskDeniedCount((value) => value + 1)
        setRiskDeniedReason(signature)
      }

      setTape((current) => [entry, ...current].slice(0, 64))
      if (entry.role && CREW.includes(entry.role as (typeof CREW)[number])) {
        const role = entry.role as CrewRole
        setCrewLast((current) => ({ ...current, [role]: entry }))
      }

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

    const recordDeckStatus = (line: string) => {
      if (!/^deck status /.test(line)) return
      const parsed = parseDeckStatus(line)
      if (parsed.feedAgeMs !== undefined) setDeckFeedAgeMs(parsed.feedAgeMs)
      if (parsed.missing !== undefined) setDeckMissing(parsed.missing)
      setDeckHeartbeatMs(Date.now())
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
        const res = await fetch(apiUrl('/v1/public/floor-snapshot'))
        if (res.ok) {
          const next = (await res.json()) as Snapshot
          setSnapshot(next)
          setDeckHeartbeatMs(Date.now())
          samplePnl(next)
        }
      } catch {
        // initial load network issues are non-fatal
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
          pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: 'ws connected' })
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
                recordDeckStatus(message)
                if (shouldSuppressTapeLine(message)) {
                  setSuppressedNoAction((value) => value + 1)
                } else {
                  pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: message })
                }
              }
              return
            }

            if (payloadType === 'FLOOR_TAPE') {
              const ts = typeof payload.ts === 'string' ? payload.ts : new Date().toISOString()
              const role = typeof payload.role === 'string' ? payload.role : undefined
              const level = payload.level === 'WARN' || payload.level === 'ERROR' ? payload.level : 'INFO'
              const line = typeof payload.line === 'string' ? payload.line : ''
              if (!line) return
              const parsedRole = normalizeCrewRole(role)
              const suppressed = shouldSuppressTapeLine(line)

              touchCrew(parsedRole, level, line)
              recordDeckStatus(line)

              if (suppressed) {
                setSuppressedNoAction((value) => value + 1)
                return
              }

              pushTape({ ts, role, level, line })
              return
            }
          } catch (error) {
            pushTape({
              ts: new Date().toISOString(),
              role: 'ops',
              level: 'WARN',
              line: `ws parse error: ${String(error).slice(0, 120)}`,
            })
          }
        }

        socket.onclose = () => {
          if (!running) return
          setWsState('CLOSED')
          pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'WARN', line: 'ws disconnected, reconnecting' })
          reconnectTimer = setTimeout(connect, 1500)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch (error) {
        setWsState('CLOSED')
        pushTape({
          ts: new Date().toISOString(),
          role: 'ops',
          level: 'WARN',
          line: `ws connect failed: ${String(error).slice(0, 120)}`,
        })
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
    <main className='floor'>
      <FloorHeader logo={logo} theme={theme} apiBase={apiUrl('')} onToggleTheme={toggleTheme} />
      <StatusStrip
        snapshot={snapshot}
        wsState={wsState}
        suppressedNoAction={suppressedNoAction}
        riskDeniedCount={riskDeniedCount}
        riskDeniedReason={riskDeniedReason}
        heartbeatAgeMs={heartbeatMs}
        snapshotAgeMs={snapshotAgeMs}
        deckFeedAgeMs={deckFeedAgeMs}
        deckMissing={deckMissing}
      />
      <PnlPanel snapshot={snapshot} chart={chart} />
      <FloorPlanPanel
        crewHeartbeat={crewHeartbeat}
        nowMs={crewNow}
        deckFeedAgeMs={deckFeedAgeMs}
        deckMissing={deckMissing}
        deckHeartbeatMs={deckHeartbeatMs}
      />
      <CrewStationsPanel crewLast={crewLast} crewHeartbeat={crewHeartbeat} crewSignals={crewSignals} nowMs={crewNow} />
      <TapeSection tape={tape} tapeRef={tapeRef} />
      <FloorFooter apiEndpoint={apiUrl('/v1/agent/analysis/latest')} />
    </main>
  )
}
