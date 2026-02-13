'use client'

import { useEffect, useState } from 'react'
import { apiUrl } from '../../lib/endpoints'

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

const COMMANDS = ['/status', '/positions', '/simulate', '/halt', '/resume', '/flatten', '/explain']

export default function OperatorFloor() {
  const [status, setStatus] = useState('INIT')
  const [token, setToken] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [command, setCommand] = useState('/status')
  const [pnl, setPnl] = useState('0.00')
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [log, setLog] = useState<string[]>([])
  const operatorHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }

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

    const fetchStatus = async () => {
      try {
        const snapshot = await fetch(apiUrl('/v1/public/floor-snapshot')).then((res) => res.json())
        setStatus(snapshot.mode)
        setPnl((snapshot.pnlPct ?? 0).toFixed(3))
      } catch {
        setLog((current) => ['status failed', ...current])
      }

      try {
        const positionsResponse = await fetch(apiUrl('/v1/operator/positions'), {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
        if (positionsResponse.ok) {
          setPositions(await positionsResponse.json())
        }
        const ordersResponse = await fetch(apiUrl('/v1/operator/orders'), {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
        if (ordersResponse.ok) {
          setOrders(await ordersResponse.json())
        }
      } catch {
        setLog((current) => ['operator load failed', ...current])
      }
    }

    const interval = setInterval(fetchStatus, 5000)
    void fetchStatus()
    return () => clearInterval(interval)
  }, [token])

  const submit = async () => {
    const response = await fetch(apiUrl('/v1/operator/command'), {
      method: 'POST',
      headers: operatorHeaders,
      body: JSON.stringify({ command, args: [], reason: 'operator ui' })
    })

    const body = await response.text()
    setLog((current) => [`${command}: ${body}`, ...current].slice(0, 40))
  }

  const modeBannerColor = status === 'HALT' || status === 'SAFE_MODE' ? '#8b1a1a' : '#1b6b42'

  return (
    <main style={{ padding: 20 }}>
      <h1>HL PRIVATEER OPERATOR FLOOR</h1>
      <div style={{ display: 'inline-block', padding: '4px 8px', border: '1px solid #355', background: '#152030', marginBottom: 8 }}>
        roles: {roles.length > 0 ? roles.join(', ') : 'none'}
      </div>
      <div style={{ padding: '6px 10px', background: modeBannerColor, marginBottom: 8 }}>
        state banner: {status}
      </div>
      <pre>
{`mode: ${status}
pnl: ${pnl}%`}
      </pre>
      <section>
        <h2>Command</h2>
        <div>
          <label>
            token{' '}
            <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="operator token" />
          </label>
          <select value={command} onChange={(event) => setCommand(event.target.value)}>
            {COMMANDS.map((entry) => (
              <option value={entry} key={entry}>
                {entry}
              </option>
            ))}
          </select>
          <button onClick={submit}>send</button>
        </div>
      </section>
      <section>
        <h2>Positions</h2>
        <pre>{JSON.stringify(positions, null, 2)}</pre>
      </section>
      <section>
        <h2>Orders</h2>
        <pre>{JSON.stringify(orders, null, 2)}</pre>
      </section>
      <section>
        <h2>Operator Log</h2>
        <pre>{log.join('\n')}</pre>
      </section>
      <section>
        <a href="/operator/replay">Open incident replay timeline</a>
      </section>
    </main>
  )
}
