'use client'

import { useEffect, useState } from 'react'
import { apiUrl, wsUrl } from '../lib/endpoints'

interface Snapshot {
  mode: string
  pnlPct: number
  healthCode: string
  driftState: string
  lastUpdateAt: string
}

export default function PublicFloor() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [events, setEvents] = useState<string[]>(['booting public floor'])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      const res = await fetch(apiUrl('/v1/public/pnl'))
      if (res.ok) {
        const snapshot = await res.json()
        setSnapshot(snapshot)
      }
    }

    const connect = () => {
      if (!running) {
        return
      }

      try {
        socket = new WebSocket(wsUrl())
        socket.onopen = () => {
          socket?.send(JSON.stringify({ type: 'sub.add', channel: 'public' }))
          setEvents((current) => ['ws connected', ...current].slice(0, 20))
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
              setEvents((current) => [`${new Date().toISOString()} ${parsed.payload?.message || parsed.payload?.type || 'event'}`, ...current].slice(0, 20))
            }
          } catch (error) {
            setEvents((current) => [`failed to parse event: ${String(error)}`, ...current].slice(0, 20))
          }
        }
        socket.onclose = () => {
          if (!running) {
            return
          }

          setEvents((current) => ['ws disconnected, reconnecting', ...current].slice(0, 20))
          reconnectTimer = setTimeout(connect, 1500)
        }
        socket.onerror = () => {
          socket?.close()
        }
      } catch (error) {
        setEvents((current) => [`ws connect failed: ${String(error)}`, ...current].slice(0, 20))
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

  return (
    <main style={{ padding: 20 }}>
      <pre>{`HL PRIVATEER PUBLIC FLOOR`}</pre>
      <section>
        <pre>
{`mode: ${snapshot?.mode ?? 'INIT'}
PnL: ${(snapshot?.pnlPct ?? 0).toFixed(3)}%
health: ${snapshot?.healthCode ?? 'GREEN'}
state: ${snapshot?.driftState ?? 'IN_TOLERANCE'}`}
        </pre>
      </section>
      <section>
        <h3>Event Tape</h3>
        <pre style={{ maxHeight: 260, overflow: 'auto' }}>
          {events.map((event, index) => `#${index} ${event}\n`)}
        </pre>
      </section>
    </main>
  )
}
