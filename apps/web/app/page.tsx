'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl, wsUrl } from '../lib/endpoints'

interface Snapshot {
  mode: string
  pnlPct: number
  healthCode: string
  driftState: string
  lastUpdateAt: string
}

type WsState = 'CONNECTING' | 'OPEN' | 'CLOSED'
type TapeLevel = 'INFO' | 'WARN' | 'ERROR'

type CrewRole =
  | 'scout'
  | 'research'
  | 'strategist'
  | 'execution'
  | 'risk'
  | 'scribe'
  | 'ops'

type TapeEntry = {
  ts: string
  role?: string
  level?: TapeLevel
  line: string
}

type CrewHeartbeat = Record<CrewRole, number>
type CrewStats = Record<CrewRole, number>

const CREW: CrewRole[] = ['scout', 'research', 'strategist', 'execution', 'risk', 'scribe', 'ops']
const HEARTBEAT_WINDOW_MS = 90_000
const SILENCE_REFRESH_MS = 3_000

const EMPTY_HEARTBEAT: CrewHeartbeat = CREW.reduce(
  (seed, role) => {
    seed[role] = 0
    return seed
  },
  {} as CrewHeartbeat
)
const EMPTY_STATS: CrewStats = CREW.reduce(
  (seed, role) => {
    seed[role] = 0
    return seed
  },
  {} as CrewStats
)

function badgeVariantForHealth(code: string): 'ok' | 'warn' | 'danger' {
  if (code === 'GREEN') return 'ok'
  if (code === 'YELLOW') return 'warn'
  return 'danger'
}

function badgeVariantForDrift(state: string): 'ok' | 'warn' | 'danger' {
  if (state === 'IN_TOLERANCE') return 'ok'
  if (state === 'POTENTIAL_DRIFT') return 'warn'
  return 'danger'
}

function Badge({ children, variant }: { children: string; variant: 'ok' | 'warn' | 'danger' }) {
  return <span className={`badge ${variant}`}>{children}</span>
}

function Led({ variant }: { variant: 'ok' | 'warn' | 'danger' }) {
  return <span className={`led ${variant}`} />
}

function crewLabel(role: CrewRole): string {
  if (role === 'scout') return 'SCOUT'
  if (role === 'research') return 'RESEARCH'
  if (role === 'strategist') return 'STRATEGIST'
  if (role === 'execution') return 'EXECUTION'
  if (role === 'risk') return 'RISK'
  if (role === 'scribe') return 'SCRIBE'
  return 'OPS'
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
  } catch {
    return '--:--:--'
  }
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function heartbeatLevel(lastPingMs: number, nowMs: number): number {
  if (!lastPingMs) return 0
  const age = Math.max(0, nowMs - lastPingMs)
  if (age <= 5_000) return 100
  if (age >= HEARTBEAT_WINDOW_MS) return 18
  return Math.round(100 - ((age - 5_000) * 82) / (HEARTBEAT_WINDOW_MS - 5_000))
}

function normalizeCrewRole(role: unknown): CrewRole | undefined {
  if (typeof role !== 'string') return undefined
  if (!CREW.includes(role as CrewRole)) return undefined
  return role as CrewRole
}

function shouldSuppressTapeLine(line: string): boolean {
  return /(?:^|\b)(no action|no changes)(?:\s|$)/i.test(line)
}

function parseDeckStatus(line: string): { feedAgeMs: number | undefined; missing: number | undefined } {
  const feedAgeMatch = /feedAgeMs=(\d+)/.exec(line)
  const missingMatch = /missing=(\d+)/.exec(line)
  return {
    feedAgeMs: feedAgeMatch ? Number(feedAgeMatch[1]) : undefined,
    missing: missingMatch ? Number(missingMatch[1]) : undefined,
  }
}

function asciiLogo(): string {
  return [
    '\u2588 \u2588 \u2588      \u2588\u2580\u2588 \u2588\u2580\u2588  \u2588  \u2588 \u2588 \u2584\u2580\u2584 \u2580\u2588\u2580 \u2588\u2580\u2580 \u2588\u2580\u2580 \u2588\u2580\u2588',
    '\u2588\u2580\u2588 \u2588\u2584\u2584    \u2588\u2580\u2580 \u2588\u2580\u2584  \u2588  \u2580\u2584\u2580 \u2588\u2580\u2588  \u2588  \u2588\u2584\u2584 \u2588\u2584\u2584 \u2588\u2580\u2584',
  ].join('\n')
}

function asciiCrewMap(activeByRole: CrewHeartbeat, nowMs: number): string {
  const marker = (role: CrewRole) => {
    const lastPing = activeByRole[role]
    if (!lastPing) return '\u00B7'
    const age = Math.max(0, nowMs - lastPing)
    if (age <= 5_000) return '\u25C9'
    if (age <= HEARTBEAT_WINDOW_MS) return '\u25CB'
    return '\u25A1'
  }

  return [
    '╔═══════════════ TRADING FLOOR ════════════════╗',
    `║ ${marker('scout')} SCOUT    ${marker('research')} RESEARCH    ${marker('strategist')} STRATEGY ║`,
    `║            ${marker('ops')} OPS                   ║`,
    `║ ${marker('risk')} RISK      ${marker('scribe')} SCRIBE    ${marker('execution')} EXECUTE ║`,
    '╚═══════════════════════════════════════════════╝',
  ].join('\n')
}

function renderAsciiChart(values: number[], width: number, height: number): { chart: string; min: number; max: number } {
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
  const [crewLast, setCrewLast] = useState<Record<CrewRole, TapeEntry | null>>(() => ({
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

  const logo = useMemo(() => asciiLogo(), [])
  const tapeRef = useRef<HTMLDivElement | null>(null)
  const lastPnlSampleAtRef = useRef<number>(0)

  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0

  const chart = useMemo(() => {
    const values = pnlSeries.map((point) => point.pnlPct)
    return renderAsciiChart(values, 64, 12).chart
  }, [pnlSeries])

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

  useEffect(() => {
    tapeRef.current?.scrollTo({ top: 0 })
  }, [tape])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const pushTape = (entry: TapeEntry) => {
      setTape((current) => [entry, ...current].slice(0, 64))
      if (entry.role && (CREW as string[]).includes(entry.role)) {
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
        // network unavailable on initial load
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
            const parsed = JSON.parse(event.data as string) as { type: string; payload: any; channel?: string }
            if (parsed.type !== 'event' || parsed.channel !== 'public') return

            const payload = parsed.payload ?? {}
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
              const level = payload.level === 'WARN' || payload.level === 'ERROR' ? payload.level : ('INFO' as const)
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
  const isFeedStale = snapshotAgeMs > 12_000

  return (
    <main className="floor">
      <header className="floor-header">
        <div className="header-left">
          <pre className="ascii-logo" aria-label="HL Privateer">
            {logo}
          </pre>
          <div className="header-title-mobile">HL PRIVATEER</div>
        </div>
        <div className="header-right">
          <div className="header-subtitle">TRADING FLOOR</div>
          <div className="header-endpoints">{apiUrl('')}</div>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'light' ? 'DARK' : 'LIGHT'}
          </button>
        </div>
      </header>

      <div className="strip">
        <div className="strip-item">
          <span className="strip-label">MODE</span>
          <span className="strip-value">{snapshot.mode}</span>
        </div>
        <span className="strip-sep">{'\u2502'}</span>
        <div className="strip-item">
          <span className="strip-label">WS</span>
          <span className={`strip-value ${wsState === 'OPEN' ? 'ok' : 'warn'}`}>{wsState}</span>
        </div>
        <span className="strip-sep">{'\u2502'}</span>
        <div className="strip-item">
          <span className="strip-label">HEALTH</span>
          <Led variant={badgeVariantForHealth(snapshot.healthCode)} />
          <span className="strip-value">{snapshot.healthCode}</span>
        </div>
        <span className="strip-sep">{'\u2502'}</span>
        <div className="strip-item">
          <span className="strip-label">DRIFT</span>
          <Led variant={badgeVariantForDrift(snapshot.driftState)} />
          <span className="strip-value">{snapshot.driftState}</span>
        </div>
        <span className="strip-sep">{'\u2502'}</span>
        <div className="strip-item">
          <span className="strip-label">FEED AGE</span>
          <span className={`strip-value ${isFeedStale ? 'warn' : ''}`}>{formatAge(Math.max(0, snapshotAgeMs))}</span>
        </div>
        <span className="strip-sep">{'\u2502'}</span>
        <div className="strip-item">
          <span className="strip-label">OPS QUIET</span>
          <span className="strip-value">{suppressedNoAction}</span>
        </div>
        <span className="strip-sep">{'\u2502'}</span>
        <div className="strip-item">
          <span className="strip-label">EXCHANGE</span>
          <span className="strip-value">HYPERLIQUID</span>
        </div>
      </div>

      <section className="pnl-row">
        <div className="pnl-hero">
          <div className="pnl-label">PROFIT / LOSS</div>
          <div className={`pnl-value ${pnl < 0 ? 'negative' : ''}`}>
            {pnl >= 0 ? '+' : ''}
            {pnl.toFixed(3)}%
          </div>
          <div className="pnl-meta">
            <span>HYPE vs basket</span>
            <span className="pnl-dot">{'\u00B7'}</span>
            <span>{formatTime(snapshot.lastUpdateAt)}</span>
          </div>
        </div>
        <div className="pnl-chart-panel">
          <div className="section-label">PNL TRAJECTORY</div>
          <pre className="chart">{chart}</pre>
        </div>
      </section>

      <section className="section-floor-plan">
        <div className="section-bar">
          <div className="section-label">FLOOR PLAN</div>
          <Badge variant={wsState === 'OPEN' ? 'ok' : 'warn'}>live telemetry</Badge>
        </div>
        <pre className="ascii-floor-plan" aria-label="trading floor map">
          {asciiCrewMap(crewHeartbeat, crewNow)}
        </pre>
        <div className="plan-meta">
          <span className={`plan-meta-item ${deckFeedAgeMs > 0 ? 'warn' : ''}`}>deck status feedAge: {deckFeedAgeMs || '--'}ms</span>
          <span className="plan-meta-item">missing feeds: {deckMissing}</span>
          <span className="plan-meta-item">heartbeat: {formatAge(heartbeatMs)}</span>
        </div>
      </section>

      <section className="crew-section">
        <div className="section-bar">
          <div className="section-label">CREW STATIONS</div>
          <Badge variant="ok">7 agents</Badge>
        </div>
        <div className="crew-grid">
          {CREW.map((role) => {
            const last = crewLast[role]
            const lastMs = last?.ts ? Date.parse(last.ts) : 0
            const active = lastMs > 0 && crewNow - lastMs < HEARTBEAT_WINDOW_MS
            const heartbeatMs = crewHeartbeat[role] ? crewNow - crewHeartbeat[role] : Infinity
            const beatScore = heartbeatLevel(crewHeartbeat[role], crewNow)
            const line = last?.line || '\u2026'
            const level = last?.level ?? 'INFO'
            return (
              <div className={`agent-term ${active ? 'active' : ''}`} key={role}>
                <div className="agent-bar">
                  <span className="agent-name">{crewLabel(role)}</span>
                  <span className={`agent-led ${active ? 'on' : 'off'}`} />
                </div>
                <div className="agent-body">
                  <span className={`agent-level ${level.toLowerCase()}`}>{level}</span>
                  <div className="agent-activity">
                    <span className="agent-activity-bar" aria-hidden="true">
                      <span className="agent-activity-fill" style={{ width: `${beatScore}%` }} />
                    </span>
                    <span className="agent-activity-age">{heartbeatMs === Infinity ? 'offline' : formatAge(heartbeatMs)}</span>
                  </div>
                  <div className="agent-msg">{line}</div>
                </div>
                <div className="agent-ts">
                  <span>{last?.ts ? formatTime(last.ts) : '\u2014'}</span>
                  <span className="agent-heartbeat-text">events {crewSignals[role]}</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="tape-section">
        <div className="section-bar">
          <div className="section-label">FLOOR TAPE</div>
          <Badge variant="ok">live</Badge>
        </div>
        <div className="tape-scroll" ref={tapeRef} aria-label="event tape">
          {tape.map((entry, i) => {
            const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
            return (
              <div className={`tape-line ${i === 0 ? 'hot' : ''} ${levelClass}`} key={`${i}-${entry.ts}`}>
                <span className="tape-marker">{i === 0 ? '\u25B8' : '\u00A0'}</span>
                <span className="tape-ts">{formatTime(entry.ts)}</span>
                {entry.role && (
                  <span className="tape-role">[{entry.role.slice(0, 3).toUpperCase()}]</span>
                )}
                <span className="tape-msg">{entry.line}</span>
                {i === 0 && <span className="tape-cursor">{'\u2588'}</span>}
              </div>
            )
          })}
        </div>
      </section>

      <footer className="floor-footer">
        <div className="footer-line">
          <span className="footer-sep">{'\u2500'.repeat(3)}</span>
          <span className="footer-text">x402 agent access</span>
          <span className="footer-sep">{'\u2500'.repeat(3)}</span>
        </div>
        <div className="footer-url">{apiUrl('/v1/agent/analysis/latest')}</div>
      </footer>
    </main>
  )
}
