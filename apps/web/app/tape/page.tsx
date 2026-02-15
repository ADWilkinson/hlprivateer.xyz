'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { apiUrl, wsUrl } from '../../lib/endpoints'
import { AsciiBackground } from '../ui/AsciiBackground'
import { cardClass, cardHeaderClass, pageShellClass } from '../ui/ascii-style'
import { TapeSection } from '../ui/TapeSection'
import { normalizeTapeLinePrefix, shouldSuppressTapeLine, type TapeEntry, TAPE_DISPLAY_LIMIT } from '../ui/floor-dashboard'

function parseTapeEntry(input: unknown): TapeEntry | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const line = typeof record.line === 'string' ? record.line.trim() : ''
  if (!line) return null

  return {
    ts: typeof record.ts === 'string' ? record.ts : new Date().toISOString(),
    role: typeof record.role === 'string' ? record.role : undefined,
    level: record.level === 'WARN' || record.level === 'ERROR' ? record.level : 'INFO',
    line
  }
}

function stripStatusPrefix(line: string): string {
  return normalizeTapeLinePrefix(line).trim()
}

export default function TapePage() {
  const [tape, setTape] = useState<TapeEntry[]>([
    { ts: new Date().toISOString(), role: 'ops', level: 'INFO', line: 'tape stream online' },
  ])
  const [isLoading, setIsLoading] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const seenRef = useRef<Set<string>>(new Set())
  const tapeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    seenRef.current = new Set()
    const seenCount = tape.map((entry) => `${entry.ts}|${entry.line}`).slice(0, 16)
    for (const item of seenCount) seenRef.current.add(item)
  }, [])

  useEffect(() => {
    tapeRef.current?.scrollTo({ top: 0 })
  }, [tape])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const shouldRender = (entry: TapeEntry): boolean => {
      const normalizedLine = stripStatusPrefix(entry.line)
      if (normalizedLine.startsWith('floor status ') || normalizedLine.startsWith('system status ') || normalizedLine.startsWith('deck status ')) {
        return false
      }
      if (shouldSuppressTapeLine(normalizedLine)) {
        return false
      }
      const signature = `${entry.ts}|${entry.role || ''}|${entry.level}|${normalizedLine.toLowerCase()}`
      if (seenRef.current.has(signature)) {
        return false
      }
      seenRef.current.add(signature)
      if (seenRef.current.size > 300) {
        seenRef.current = new Set(Array.from(seenRef.current).slice(-150))
      }
      return true
    }

    const ingest = (entry: TapeEntry) => {
      if (!shouldRender(entry)) return
      setTape((current) => [entry, ...current].slice(0, TAPE_DISPLAY_LIMIT))
    }

    const load = async () => {
      try {
        const response = await fetch(apiUrl('/v1/public/floor-tape'))
        if (!response.ok) return
        const raw = await response.json()
        if (!Array.isArray(raw)) return
        const loaded = raw
          .map(parseTapeEntry)
          .filter((entry): entry is TapeEntry => entry !== null)
          .reverse()
          .filter(shouldRender)
        if (loaded.length > 0) {
          setTape(loaded)
        }
      } catch {
        // ignore one-shot startup failures; live websocket still handles updates
      } finally {
        if (running) {
          setIsLoading(false)
        }
      }
    }

    const connect = () => {
      if (!running) return

      socket = new WebSocket(wsUrl())
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'sub.add', channel: 'public' }))
      }

      socket.onmessage = (event) => {
        if (!running) return
        try {
          const parsed = JSON.parse(event.data as string) as Record<string, unknown>
          const payload =
            typeof parsed.payload === 'object' && parsed.payload !== null ? (parsed.payload as Record<string, unknown>) : null
          const payloadType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : ''
          const envelopeType = typeof payload?.type === 'string' ? payload.type.trim().toLowerCase() : ''

          if (parsed.channel && typeof parsed.channel !== 'string') {
            return
          }

          if (parsed.channel === 'public' && envelopeType === 'floor_tape' && payload) {
            const entry = parseTapeEntry(payload)
            if (entry) {
              ingest(entry)
            }
            return
          }

          if (payload && (envelopeType === 'state_update' || envelopeType === 'snapshot')) {
            const message =
              typeof payload.message === 'string'
                ? payload.message
                : payloadType === 'floor_tape'
                  ? ''
                  : ''
            if (message) {
              ingest({
                ts: typeof payload.ts === 'string' ? payload.ts : new Date().toISOString(),
                role: 'ops',
                level: 'INFO',
                line: message
              })
            }
            return
          }

          const entry = parseTapeEntry(payload ?? parsed)
          if (entry) {
            ingest(entry)
          }
        } catch {
          // keep channel resilient
        }
      }

      socket.onclose = () => {
        if (!running) return
        const retry = setTimeout(connect, 1500)
        reconnectTimer = retry
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    void load()
    connect()

    return () => {
      running = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (socket && socket.readyState < 2) {
        socket.close()
      }
    }
  }, [])

  return (
    <>
      <AsciiBackground />
      <main className={pageShellClass}>
        <section className={cardClass}>
          <div className={cardHeaderClass}>
            <div>live tape stream</div>
            <div className='flex items-center gap-2'>
              <Link href='/' className='border border-hlpBorder px-2 py-1 text-[9px] uppercase tracking-[0.16em]'>
                Back
              </Link>
              <span className='text-hlpMuted'>{tape.length} entries</span>
            </div>
          </div>
          <TapeSection
            tape={tape}
            tapeRef={tapeRef}
            isLoading={isLoading}
            isCollapsed={isCollapsed}
            onToggle={() => setIsCollapsed((value) => !value)}
            sectionId='tape-page'
          />
        </section>
      </main>
    </>
  )
}
