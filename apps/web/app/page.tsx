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

const CREW: CrewRole[] = ['scout', 'research', 'strategist', 'execution', 'risk', 'scribe', 'ops']

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

function badgeVariantForWs(ws: WsState): 'ok' | 'warn' | 'danger' {
  if (ws === 'OPEN') return 'ok'
  if (ws === 'CONNECTING') return 'warn'
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

function asciiLogo(): string {
  return [
    '\u256B \u256B\u256B  \u250F\u2501\u2513\u250F\u2501\u2513\u256B\u256B \u256B\u250F\u2501\u2513\u257A\u2533\u2578\u250F\u2501\u2578\u250F\u2501\u2578\u250F\u2501\u2513',
    '\u2523\u2501\u252B\u2503  \u2523\u2501\u251B\u2523\u2533\u251B\u2503\u2503\u250F\u251B\u2523\u2501\u252B \u2503 \u2523\u2578 \u2523\u2578 \u2523\u2533\u251B',
    '\u2579 \u2579\u2517\u2501\u2578\u2579  \u2579\u2517\u2578\u2579\u2517\u251B \u2579 \u2579 \u2579 \u2517\u2501\u2578\u2517\u2501\u2578\u2579\u2517\u2578',
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

  const logo = useMemo(() => asciiLogo(), [])
  const tapeRef = useRef<HTMLDivElement | null>(null)
  const lastPnlSampleAtRef = useRef<number>(0)

  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0

  const chart = useMemo(() => {
    const values = pnlSeries.map((point) => point.pnlPct)
    return renderAsciiChart(values, 64, 12).chart
  }, [pnlSeries])

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
              samplePnl(payload)
              const message = typeof payload.message === 'string' ? payload.message : ''
              if (message) {
                pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: message })
              }
              return
            }

            if (payloadType === 'FLOOR_TAPE') {
              const ts = typeof payload.ts === 'string' ? payload.ts : new Date().toISOString()
              const role = typeof payload.role === 'string' ? payload.role : undefined
              const level = payload.level === 'WARN' || payload.level === 'ERROR' ? payload.level : ('INFO' as const)
              const line = typeof payload.line === 'string' ? payload.line : ''
              if (!line) return

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

  const crewNow = Date.now()
  const modeClass = `mode-${snapshot.mode.toLowerCase().replace(/_/g, '-')}`

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
          <div className="header-live">
            <Led variant={badgeVariantForWs(wsState)} />
            <span className="header-live-text">{wsState === 'OPEN' ? 'LIVE' : wsState}</span>
          </div>
          <div className="header-subtitle">TRADING FLOOR</div>
          <div className="header-tagline">&quot;We do not predict. We hard-gate.&quot;</div>
          <div className="header-endpoints">{apiUrl('')}</div>
        </div>
      </header>

      <div className="strip">
        <div className="strip-item">
          <span className="strip-label">MODE</span>
          <span className={`strip-value ${modeClass}`}>{snapshot.mode}</span>
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

      <section className="crew-section">
        <div className="section-bar">
          <div className="section-label">CREW STATIONS</div>
          <Badge variant="ok">7 agents</Badge>
        </div>
        <div className="crew-grid">
          {CREW.map((role) => {
            const last = crewLast[role]
            const lastMs = last?.ts ? Date.parse(last.ts) : 0
            const active = lastMs > 0 && crewNow - lastMs < 90_000
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
                  <div className="agent-msg">{line}</div>
                </div>
                <div className="agent-ts">{last?.ts ? formatTime(last.ts) : '\u2014'}</div>
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
