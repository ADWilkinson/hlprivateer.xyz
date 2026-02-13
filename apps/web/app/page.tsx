'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiUrl, wsUrl } from '../lib/endpoints'

interface Snapshot {
  mode: string
  pnlPct: number
  healthCode: string
  driftState: string
  lastUpdateAt: string
}

interface Position {
  symbol: string
  side: string
  qty: number
  pnlUsd: number
  notionalUsd: number
  avgEntryPx: number
  markPx: number
  updatedAt: string
}

interface Order {
  orderId: string
  symbol: string
  side: string
  status: string
  notionalUsd: number
  filledQty: number
}

interface ReplayEvent {
  id: string
  ts: string
  actorType: string
  actorId: string
  action: string
  resource: string
  correlationId: string
  details: Record<string, unknown>
  stream?: string
  type?: string
  source?: string
  payload?: unknown
}

interface ReplayResponse {
  events: ReplayEvent[]
  count?: number
  from: string
  to: string
  correlationId?: string
  resource?: string
  ok?: boolean
}

type WsState = 'CONNECTING' | 'OPEN' | 'CLOSED'
type SideTab = 'operator' | 'replay' | 'about'

const COMMANDS = ['/status', '/positions', '/simulate', '/halt', '/resume', '/flatten', '/explain']

const nowInputValue = (): string => {
  const now = new Date()
  return now.toISOString().slice(0, 16)
}

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

function setHash(next: SideTab) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.hash = next === 'operator' ? '#operator' : next === 'replay' ? '#replay' : '#about'
  window.history.replaceState({}, '', url.toString())
}

function tabFromHash(): SideTab | null {
  if (typeof window === 'undefined') return null
  const raw = String(window.location.hash ?? '').replace('#', '').trim().toLowerCase()
  if (raw === 'operator') return 'operator'
  if (raw === 'replay') return 'replay'
  if (raw === 'about') return 'about'
  return null
}

function asciiLogo(): string {
  return [
    'HL PRIVATEER // PUBLIC FLOOR',
    '┌───────────────────────────────────────────────┐',
    '│   _   _ _         _      _                    │',
    '│  | | | | |  ___  | |    (_) ___  _ __         │',
    '│  | |_| | | / _ \\ | |    | |/ _ \\| \\u0027__|        │',
    '│  |  _  | || (_) || |___ | | (_) | |           │',
    '│  |_| |_|_| \\___/ |_____||_|\\___/|_|           │',
    '│                                               │',
    '│  Signals: PnL | Mode | Drift | Event Tape     │',
    '│  Deck:    Operator | Replay | About           │',
    '└───────────────────────────────────────────────┘'
  ].join('\\n')
}

function PublicPanel({
  snapshot,
  events,
  wsState
}: {
  snapshot: Snapshot
  events: string[]
  wsState: WsState
}) {
  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0

  return (
    <section className='panel'>
      <div className='panelHeader'>
        <div className='panelTitle'>Public Floor</div>
        <div className='panelBadges'>
          <Badge variant={badgeVariantForHealth(snapshot.healthCode)}>{`health:${snapshot.healthCode}`}</Badge>
          <Badge variant={badgeVariantForDrift(snapshot.driftState)}>{`drift:${snapshot.driftState}`}</Badge>
          <Badge variant={badgeVariantForWs(wsState)}>{`ws:${wsState}`}</Badge>
        </div>
      </div>
      <div className='panelBody'>
        <div className='kv'>
          <div className='kvLabel'>mode</div>
          <div className='kvValue'>{snapshot.mode}</div>
          <div className='kvLabel'>pnl</div>
          <div className='kvValue'>{pnl.toFixed(3)}%</div>
          <div className='kvLabel'>updated</div>
          <div className='kvValue'>{snapshot.lastUpdateAt}</div>
        </div>
        <div className='tape' aria-label='event tape'>
          {events.map((entry, index) => (
            <span className={`tapeLine ${index === 0 ? 'hot' : ''}`} key={`${index}-${entry.slice(0, 24)}`}>
              {`#${index} ${entry}`}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function OperatorDeck({
  token,
  onTokenChange,
  snapshot
}: {
  token: string
  onTokenChange: (value: string) => void
  snapshot: Snapshot
}) {
  const [roles, setRoles] = useState<string[]>([])
  const [command, setCommand] = useState(COMMANDS[0] ?? '/status')
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string>('')

  const operatorHeaders = useMemo(() => {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }, [token])

  useEffect(() => {
    try {
      const payload = token.split('.')[1]
      if (!payload) {
        setRoles([])
      } else {
        const parsed = JSON.parse(atob(payload)) as { roles?: string[] }
        setRoles(Array.isArray(parsed.roles) ? parsed.roles : [])
      }
    } catch {
      setRoles([])
    }
  }, [token])

  useEffect(() => {
    let running = true
    setError('')

    const fetchOperator = async () => {
      if (!token) {
        setPositions([])
        setOrders([])
        return
      }

      try {
        const positionsResponse = await fetch(apiUrl('/v1/operator/positions'), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (positionsResponse.ok && running) {
          setPositions(await positionsResponse.json())
        }
      } catch (err) {
        if (running) setError(`positions load failed: ${String(err)}`)
      }

      try {
        const ordersResponse = await fetch(apiUrl('/v1/operator/orders'), {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (ordersResponse.ok && running) {
          setOrders(await ordersResponse.json())
        }
      } catch (err) {
        if (running) setError(`orders load failed: ${String(err)}`)
      }
    }

    const interval = setInterval(() => void fetchOperator(), 5000)
    void fetchOperator()

    return () => {
      running = false
      clearInterval(interval)
    }
  }, [token])

  const submit = async () => {
    setError('')
    try {
      const response = await fetch(apiUrl('/v1/operator/command'), {
        method: 'POST',
        headers: operatorHeaders,
        body: JSON.stringify({ command, args: [], reason: 'operator ui' })
      })

      const body = await response.text()
      setLog((current) => [`${command}: ${body}`, ...current].slice(0, 40))
      if (!response.ok) {
        setError(body)
      }
    } catch (err) {
      setError(String(err))
    }
  }

  const modeVariant = snapshot.mode === 'HALT' || snapshot.mode === 'SAFE_MODE' ? 'danger' : snapshot.mode === 'IN_TRADE' ? 'warn' : 'ok'

  return (
    <div className='form'>
      <div className='panelBadges'>
        <Badge variant={modeVariant}>{`mode:${snapshot.mode}`}</Badge>
        <Badge variant='ok'>{`roles:${roles.length > 0 ? roles.join(',') : 'none'}`}</Badge>
      </div>

      <label className='label'>
        operator jwt
        <input className='input' value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder='paste operator token (JWT)' />
      </label>

      <div className='row'>
        <label className='label'>
          command
          <select className='select' value={command} onChange={(event) => setCommand(event.target.value)}>
            {COMMANDS.map((entry) => (
              <option value={entry} key={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <div className='label'>
          execute
          <div className='btnRow'>
            <button className='btn' onClick={() => void submit()}>
              SEND
            </button>
            <button className='btn secondary' onClick={() => setHash('replay')}>
              REPLAY
            </button>
          </div>
        </div>
      </div>

      {error && <div className='dangerText'>{error}</div>}

      <div className='monoBox'>
        <div className='muted'>{`positions=${positions.length} orders=${orders.length}`}</div>
        <pre style={{ margin: 0 }}>{JSON.stringify({ positions, orders }, null, 2)}</pre>
      </div>

      <div className='monoBox'>
        <div className='muted'>operator log</div>
        <pre style={{ margin: 0 }}>{log.join('\n')}</pre>
      </div>
    </div>
  )
}

function ReplayPanel({ token }: { token: string }) {
  const [from, setFrom] = useState<string>(() => new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16))
  const [to, setTo] = useState<string>(nowInputValue)
  const [correlationId, setCorrelationId] = useState('')
  const [resource, setResource] = useState('')
  const [limit, setLimit] = useState(200)
  const [events, setEvents] = useState<ReplayEvent[]>([])
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setError('')
    const q = new URLSearchParams({
      from: from ? new Date(from).toISOString() : nowInputValue(),
      to: to ? new Date(to).toISOString() : nowInputValue(),
      limit: String(limit)
    })

    if (correlationId) {
      q.set('correlationId', correlationId)
    }

    if (resource) {
      q.set('resource', resource)
    }

    const response = await fetch(`${apiUrl('/v1/operator/replay')}?${q.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!response.ok) {
      setError(await response.text())
      return
    }

    const raw = (await response.json()) as ReplayResponse
    setEvents(Array.isArray(raw.events) ? raw.events : [])
    setSummary(
      `from ${raw.from} to ${raw.to} ${raw.resource ? `resource ${raw.resource}` : ''} ${raw.correlationId ? `correlation ${raw.correlationId}` : ''}`
    )
  }

  const exportBundle = async () => {
    setError('')
    const q = new URLSearchParams({
      from: from ? new Date(from).toISOString() : nowInputValue(),
      to: to ? new Date(to).toISOString() : nowInputValue(),
      limit: String(limit)
    })

    if (correlationId) {
      q.set('correlationId', correlationId)
    }

    if (resource) {
      q.set('resource', resource)
    }

    const response = await fetch(`${apiUrl('/v1/operator/replay/export')}?${q.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!response.ok) {
      setError(await response.text())
      return
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    link.href = url
    link.download = `replay-${stamp}.json`
    link.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className='form'>
      <div className='muted'>
        This is admin-only. If you get 403, your operator JWT needs the admin role.
      </div>

      <div className='row'>
        <label className='label'>
          from (utc)
          <input className='input' type='datetime-local' value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className='label'>
          to (utc)
          <input className='input' type='datetime-local' value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>

      <label className='label'>
        correlation id (optional)
        <input className='input' value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} />
      </label>

      <label className='label'>
        resource/stream (optional)
        <input className='input' value={resource} onChange={(event) => setResource(event.target.value)} placeholder='hlp.audit.events' />
      </label>

      <label className='label'>
        limit
        <input className='input' type='number' min={1} max={5000} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
      </label>

      <div className='btnRow'>
        <button className='btn secondary' onClick={() => void load()}>
          LOAD
        </button>
        <button className='btn' onClick={() => void exportBundle()}>
          EXPORT
        </button>
      </div>

      {summary && <div className='muted'>{summary}</div>}
      {error && <div className='dangerText'>{error}</div>}

      <div className='monoBox'>
        <div className='muted'>{`events=${events.length}`}</div>
        <pre style={{ margin: 0 }}>
          {events
            .map((entry) => `${entry.ts} ${entry.action} ${entry.resource} ${entry.actorType}:${entry.actorId}`)
            .join('\n')}
        </pre>
      </div>

      <div className='monoBox'>
        <div className='muted'>payloads</div>
        <pre style={{ margin: 0 }}>{JSON.stringify(events, null, 2)}</pre>
      </div>
    </div>
  )
}

function AboutPanel() {
  return (
    <div className='form'>
      <div className='monoBox'>
        <pre style={{ margin: 0 }}>
{`WHAT IS THIS

HL Privateer is a public-facing "trading floor" UI plus an operator-controlled runtime.
The backend is built around Redis Streams events, deterministic risk gates, and an audit/replay trail.

PUBLIC
- UI: https://hlprivateer.xyz
- API: ${apiUrl('/v1/public/pnl')}
- WS:  ${wsUrl()}

OPERATOR
- Paste an operator JWT to use /halt /resume /flatten and inspect positions/orders.

NOTE ON EXCHANGE CONNECTIVITY
- Market data + execution are currently operating in sim mode on this deployment.
- Hyperliquid integration exists as a scaffold, but is not wired for live trading yet.`}
        </pre>
      </div>
      <div className='muted'>
        Tip: append <code>#operator</code>, <code>#replay</code>, or <code>#about</code> to the URL to deep-link tabs.
      </div>
    </div>
  )
}

export default function DeckPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    mode: 'INIT',
    pnlPct: 0,
    healthCode: 'GREEN',
    driftState: 'IN_TOLERANCE',
    lastUpdateAt: new Date().toISOString()
  }))
  const [events, setEvents] = useState<string[]>(['booting public floor'])
  const [wsState, setWsState] = useState<WsState>('CONNECTING')
  const [sideTab, setSideTab] = useState<SideTab>('operator')
  const [operatorToken, setOperatorToken] = useState('')

  const logo = useMemo(() => asciiLogo(), [])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      const res = await fetch(apiUrl('/v1/public/pnl'))
      if (res.ok) {
        const snapshot = await res.json()
        setSnapshot(snapshot as Snapshot)
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
          setEvents((current) => ['ws connected', ...current].slice(0, 24))
        }
        socket.onmessage = (event) => {
          if (!running) {
            return
          }

          try {
            const parsed = JSON.parse(event.data as string) as { type: string; payload: any; channel?: string }
            if (parsed.type === 'event' && parsed.channel === 'public') {
              if (parsed.payload?.type === 'STATE_UPDATE') {
                setSnapshot(parsed.payload)
              }
              setEvents((current) => [`${new Date().toISOString()} ${parsed.payload?.message || parsed.payload?.type || 'event'}`, ...current].slice(0, 24))
            }
          } catch (error) {
            setEvents((current) => [`failed to parse event: ${String(error)}`, ...current].slice(0, 24))
          }
        }
        socket.onclose = () => {
          if (!running) {
            return
          }

          setWsState('CLOSED')
          setEvents((current) => ['ws disconnected, reconnecting', ...current].slice(0, 24))
          reconnectTimer = setTimeout(connect, 1500)
        }
        socket.onerror = () => {
          socket?.close()
        }
      } catch (error) {
        setWsState('CLOSED')
        setEvents((current) => [`ws connect failed: ${String(error)}`, ...current].slice(0, 24))
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

  useEffect(() => {
    const apply = () => {
      const fromHash = tabFromHash()
      if (fromHash) {
        setSideTab(fromHash)
      }
    }

    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  const setTab = (tab: SideTab) => {
    setSideTab(tab)
    setHash(tab)
  }

  return (
    <main className='deck'>
      <header className='hero'>
        <div className='heroTop'>
          <pre className='logo'>{logo}</pre>
          <div>
            <div className='subline'>Public floor. Operator deck. Replay timeline.</div>
            <div className='subline'>{`api=${apiUrl('')} ws=${wsUrl()}`}</div>
          </div>
        </div>
      </header>

      <div className='grid'>
        <PublicPanel snapshot={snapshot} events={events} wsState={wsState} />

        <section className='panel panelAlt'>
          <div className='tabs' role='tablist' aria-label='deck tabs'>
            <button className='tab' role='tab' aria-selected={sideTab === 'operator'} onClick={() => setTab('operator')}>
              OPERATOR
            </button>
            <button className='tab' role='tab' aria-selected={sideTab === 'replay'} onClick={() => setTab('replay')}>
              REPLAY
            </button>
            <button className='tab' role='tab' aria-selected={sideTab === 'about'} onClick={() => setTab('about')}>
              ABOUT
            </button>
          </div>
          <div className='panelBody'>
            {sideTab === 'operator' && <OperatorDeck token={operatorToken} onTokenChange={setOperatorToken} snapshot={snapshot} />}
            {sideTab === 'replay' && <ReplayPanel token={operatorToken} />}
            {sideTab === 'about' && <AboutPanel />}
          </div>
        </section>
      </div>
    </main>
  )
}
