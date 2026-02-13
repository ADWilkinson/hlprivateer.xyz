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

function crewLabel(role: CrewRole): string {
  if (role === 'scout') return 'SCOUT'
  if (role === 'research') return 'RESEARCH'
  if (role === 'strategist') return 'STRATEGIST'
  if (role === 'execution') return 'EXECUTION'
  if (role === 'risk') return 'RISK'
  if (role === 'scribe') return 'SCRIBE'
  return 'OPS'
}

function asciiLogo(): string {
  return [
    'HL PRIVATEER // TRADING FLOOR',
    '┌───────────────────────────────────────────────────────────────┐',
    '│  "We do not predict. We hard-gate."                             │',
    '│                                                                 │',
    '│  CREW: scout | research | strategist | execution | risk | ops   │',
    '│  EXCHANGE: Hyperliquid (HYPE vs basket)                         │',
    '│  PAYMENTS: x402 (facilitator-backed)                            │',
    '└───────────────────────────────────────────────────────────────┘'
  ].join('\n')
}

function renderAsciiChart(values: number[], width: number, height: number): { chart: string; min: number; max: number } {
  const trimmed = values.filter((v) => Number.isFinite(v)).slice(-Math.max(width, 2))
  if (trimmed.length < 2) {
    return { chart: '(warming up)', min: 0, max: 0 }
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
    if (grid[y] && grid[y]![x]) {
      grid[y]![x] = '*'
    }
  }

  const lines = grid.map((row) => row.join(''))
  const top = `max ${max.toFixed(3)}%`
  const bottom = `min ${min.toFixed(3)}%`
  return {
    chart: [`+${'-'.repeat(width)}+`, ...lines.map((line) => `|${line}|`), `+${'-'.repeat(width)}+`, `${top}  ${bottom}`].join(
      '\n'
    ),
    min,
    max
  }
}

export default function DeckPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    mode: 'INIT',
    pnlPct: 0,
    healthCode: 'GREEN',
    driftState: 'IN_TOLERANCE',
    lastUpdateAt: new Date().toISOString()
  }))
  const [tape, setTape] = useState<TapeEntry[]>([
    { ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: 'booting floor' }
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
    ops: null
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
    // keep "top" newest line visible on small viewports
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
      if (!Number.isFinite(pnlPct)) {
        return
      }

      const ts = typeof payload.lastUpdateAt === 'string' ? payload.lastUpdateAt : new Date().toISOString()
      const now = Date.now()
      if (now - lastPnlSampleAtRef.current < 8000) {
        return
      }
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
        // ignore
      }
    }

    const connect = () => {
      if (!running) {
        return
      }

      try {
        setWsState('CONNECTING')
        socket = new WebSocket(wsUrl())

        socket.onopen = () => {
          socket?.send(JSON.stringify({ type: 'sub.add', channel: 'public' }))
          setWsState('OPEN')
          pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: 'ws connected' })
        }

        socket.onmessage = (event) => {
          if (!running) {
            return
          }

          try {
            const parsed = JSON.parse(event.data as string) as { type: string; payload: any; channel?: string }
            if (parsed.type !== 'event' || parsed.channel !== 'public') {
              return
            }

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
              if (!line) {
                return
              }

              pushTape({ ts, role, level, line })
              return
            }
          } catch (error) {
            pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'WARN', line: `ws parse error: ${String(error).slice(0, 120)}` })
          }
        }

        socket.onclose = () => {
          if (!running) {
            return
          }
          setWsState('CLOSED')
          pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'WARN', line: 'ws disconnected, reconnecting' })
          reconnectTimer = setTimeout(connect, 1500)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch (error) {
        setWsState('CLOSED')
        pushTape({ ts: new Date().toISOString(), role: 'ops', level: 'WARN', line: `ws connect failed: ${String(error).slice(0, 120)}` })
        reconnectTimer = setTimeout(connect, 1500)
      }
    }

    void load()
    connect()

    return () => {
      running = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      if (socket && socket.readyState < 2) {
        socket.close()
      }
    }
  }, [])

  const crewNow = Date.now()

  return (
    <main className='deck'>
      <header className='hero'>
        <div className='heroTop'>
          <pre className='logo' aria-label='HL Privateer logo'>
            {logo}
          </pre>
          <div className='heroAside'>
            <div className='subline'>Public-only floor. Strategy execution is autonomous and hard-gated.</div>
            <div className='subline'>{`api=${apiUrl('')} ws=${wsUrl()}`}</div>
          </div>
        </div>
      </header>

      <section className='panel'>
        <div className='panelHeader'>
          <div className='panelTitle'>Bridge</div>
          <div className='panelBadges'>
            <Badge variant={badgeVariantForHealth(snapshot.healthCode)}>{`health:${snapshot.healthCode}`}</Badge>
            <Badge variant={badgeVariantForDrift(snapshot.driftState)}>{`drift:${snapshot.driftState}`}</Badge>
            <Badge variant={badgeVariantForWs(wsState)}>{`ws:${wsState}`}</Badge>
          </div>
        </div>
        <div className='panelBody'>
          <div className='bridgeGrid'>
            <div className='kv'>
              <div className='kvLabel'>mode</div>
              <div className='kvValue'>{snapshot.mode}</div>
              <div className='kvLabel'>pnl</div>
              <div className='kvValue hlp-pnl'>{pnl.toFixed(3)}%</div>
              <div className='kvLabel'>updated</div>
              <div className='kvValue'>{snapshot.lastUpdateAt}</div>
              <div className='kvLabel'>exchange</div>
              <div className='kvValue'>hyperliquid</div>
            </div>

            <div className='monoBox'>
              <div className='muted'>pnl chart (since page load)</div>
              <pre className='chart'>{chart}</pre>
            </div>
          </div>
        </div>
      </section>

      <div className='grid3'>
        <section className='panel panelAlt'>
          <div className='panelHeader'>
            <div className='panelTitle'>Crew</div>
            <div className='panelBadges'>
              <Badge variant='ok'>agentic</Badge>
            </div>
          </div>
          <div className='panelBody'>
            <div className='crew'>
              {CREW.map((role) => {
                const last = crewLast[role]
                const lastMs = last?.ts ? Date.parse(last.ts) : 0
                const active = lastMs > 0 && crewNow - lastMs < 90_000
                const variant = active ? 'ok' : 'warn'
                const line = last?.line ? last.line : '...'
                const level = last?.level ?? 'INFO'
                return (
                  <div className='crewRow' key={role}>
                    <div className='crewLeft'>
                      <Badge variant={variant}>{crewLabel(role)}</Badge>
                      <span className={`crewLevel ${String(level).toLowerCase()}`}>{level}</span>
                    </div>
                    <div className='crewRight'>
                      <div className='crewLine'>{line}</div>
                      <div className='crewMeta'>{last?.ts ?? ''}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className='panel'>
          <div className='panelHeader'>
            <div className='panelTitle'>Tape</div>
            <div className='panelBadges'>
              <Badge variant='ok'>live</Badge>
            </div>
          </div>
          <div className='panelBody'>
            <div className='tape' ref={tapeRef} aria-label='event tape'>
              {tape.map((entry, index) => {
                const role = entry.role ? `[${entry.role}] ` : ''
                const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
                const rendered = `${entry.ts} ${role}${entry.line}`.trim()
                return (
                  <span className={`tapeLine ${index === 0 ? 'hot' : ''} ${levelClass}`} key={`${index}-${rendered.slice(0, 32)}`}>
                    {rendered}
                  </span>
                )
              })}
            </div>
          </div>
        </section>
      </div>

      <footer className='footer'>
        <div className='muted'>
          External agents can purchase paid routes via x402: <span className='mono'>{apiUrl('/v1/agent/analysis/latest')}</span>
        </div>
      </footer>
    </main>
  )
}

