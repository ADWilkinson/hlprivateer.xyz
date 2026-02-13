'use client'

import { useEffect, useState } from 'react'
import { apiUrl } from '../../../lib/endpoints'

interface ReplayEvent {
  id: string
  ts: string
  actorType: string
  actorId: string
  action: string
  resource: string
  correlationId: string
  details: Record<string, unknown>
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

const nowInputValue = (): string => {
  const now = new Date()
  return now.toISOString().slice(0, 16)
}

export default function ReplayTimeline() {
  const [token, setToken] = useState('')
  const [from, setFrom] = useState<string>(() => {
    const value = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16)
    return value
  })
  const [to, setTo] = useState<string>(nowInputValue)
  const [correlationId, setCorrelationId] = useState('')
  const [resource, setResource] = useState('')
  const [limit, setLimit] = useState(200)
  const [events, setEvents] = useState<ReplayEvent[]>([])
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void load()
  }, [])

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

    const raw = await response.json()
    const payload = raw as ReplayResponse
    setEvents(Array.isArray(payload.events) ? payload.events : [])
    setSummary(
      `from ${payload.from} to ${payload.to} ${payload.resource ? `resource ${payload.resource}` : ''} ${payload.correlationId ? `correlation ${payload.correlationId}` : ''}`
    )
  }

  const exportBundle = async () => {
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
    <main style={{ padding: 20 }}>
      <h1>HL PRIVATEER REPLAY TIMELINE</h1>
      <section style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <label>
          token
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder='operator token' />
        </label>
        <label>
          from
          <input type='datetime-local' value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          to
          <input type='datetime-local' value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          correlation id
          <input value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} />
        </label>
        <label>
          resource/stream
          <input value={resource} onChange={(event) => setResource(event.target.value)} placeholder='hlp.audit.events' />
        </label>
        <label>
          limit
          <input
            type='number'
            min={1}
            max={5000}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void load()}>Load Timeline</button>
          <button onClick={() => void exportBundle()}>Export Bundle</button>
        </div>
      </section>
      <section>
        <h2>Timeline</h2>
        {summary && <pre>{summary}</pre>}
        {error && <pre style={{ color: '#ff8080' }}>{error}</pre>}
        {events.length === 0 && <p>No events in selected window.</p>}
        <pre>{events.map((entry) => `${entry.ts} ${entry.action} ${entry.resource} ${entry.actorType}:${entry.actorId}`).join('\n')}</pre>
      </section>
      <section>
        <h2>Event Payloads</h2>
        <pre>{JSON.stringify(events, null, 2)}</pre>
      </section>
    </main>
  )
}
