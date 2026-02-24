'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiUrl } from '../../lib/endpoints'

type TapeLine = {
  ts?: string
  role?: string
  level?: 'INFO' | 'WARN' | 'ERROR'
  line?: string
}

type Position = {
  symbol?: string
  side?: string
  entryPrice?: number
  markPrice?: number
  pnlUsd?: number
  pnlPct?: number
  notionalUsd?: number
}

type FloorSnapshot = {
  mode?: string
  pnlPct?: number
  healthCode?: string
  openPositions?: Position[]
  openPositionCount?: number
  openPositionNotionalUsd?: number
  recentTape?: TapeLine[]
  lastUpdateAt?: string
}

const POLL_MS = 5_000

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function fmtPct(value: unknown): string {
  const num = asNumber(value)
  if (num === null) return '--'
  return `${num.toFixed(2)}%`
}

function fmtUsd(value: unknown): string {
  const num = asNumber(value)
  if (num === null) return '--'
  return `$${num.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function fmtTs(value: unknown): string {
  if (typeof value !== 'string' || !value) return '--'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return '--'
  return new Date(parsed).toLocaleString()
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  await navigator.clipboard.writeText(value)
}

function normalizeSnapshot(input: unknown): FloorSnapshot {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const positionsRaw = Array.isArray(raw.openPositions) ? raw.openPositions : []
  const positions = positionsRaw
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Position)
  const tapeRaw = Array.isArray(raw.recentTape) ? raw.recentTape : []
  const tape = tapeRaw
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as TapeLine)

  return {
    mode: typeof raw.mode === 'string' ? raw.mode : undefined,
    pnlPct: asNumber(raw.pnlPct) ?? undefined,
    healthCode: typeof raw.healthCode === 'string' ? raw.healthCode : undefined,
    openPositions: positions,
    openPositionCount: asNumber(raw.openPositionCount) ?? positions.length,
    openPositionNotionalUsd: asNumber(raw.openPositionNotionalUsd) ?? undefined,
    recentTape: tape,
    lastUpdateAt: typeof raw.lastUpdateAt === 'string' ? raw.lastUpdateAt : undefined
  }
}

type SectionCardProps = {
  title: string
  subtitle?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

function SectionCard({ title, subtitle, open, onToggle, children }: SectionCardProps) {
  return (
    <section className='mt-6 rounded-md border border-zinc-200 bg-white p-4'>
      <button
        type='button'
        onClick={onToggle}
        className='flex w-full items-center justify-between gap-3 rounded-md text-left'
      >
        <div>
          <div className='text-sm font-semibold uppercase text-zinc-600'>{title}</div>
          {subtitle && <div className='mt-1 text-xs text-zinc-500'>{subtitle}</div>}
        </div>
        <span className='rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700'>
          {open ? 'hide' : 'show'}
        </span>
      </button>
      {open && <div className='mt-3'>{children}</div>}
    </section>
  )
}

export default function FloorPage() {
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null)
  const [tape, setTape] = useState<TapeLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPositions, setShowPositions] = useState(true)
  const [showTape, setShowTape] = useState(true)
  const [showAgentAccess, setShowAgentAccess] = useState(true)

  useEffect(() => {
    let stopped = false

    const refresh = async () => {
      try {
        const [snapshotRes, tapeRes] = await Promise.all([
          fetch(apiUrl('/v1/public/floor-snapshot'), { cache: 'no-store' }),
          fetch(apiUrl('/v1/public/floor-tape'), { cache: 'no-store' })
        ])

        if (!snapshotRes.ok) {
          throw new Error(`floor snapshot failed (${snapshotRes.status})`)
        }

        const snapshotJson = await snapshotRes.json()
        const normalized = normalizeSnapshot(snapshotJson)
        const tapeJson = tapeRes.ok ? await tapeRes.json() : []
        const tapeLines = Array.isArray(tapeJson)
          ? tapeJson.filter((item) => item && typeof item === 'object').map((item) => item as TapeLine)
          : []

        if (!stopped) {
          setSnapshot(normalized)
          setTape(tapeLines.slice(-40).reverse())
          setError(null)
          setLoading(false)
        }
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  const positions = useMemo(() => snapshot?.openPositions ?? [], [snapshot])
  const handshakeUrl = apiUrl('/v1/agent/handshake')
  const verifyUrl = apiUrl('/v1/agent/verify')
  const streamSnapshotUrl = apiUrl('/v1/agent/stream/snapshot')
  const x402WellKnownUrl = 'https://hlprivateer.xyz/.well-known/x402'
  const agentRegistrationUrl = 'https://hlprivateer.xyz/.well-known/agent-registration.json'
  const agentsDiscoveryUrl = 'https://hlprivateer.xyz/.well-known/agents.json'
  const x402QuickstartUrl = 'https://hlprivateer.xyz/docs/X402_SELLER_QUICKSTART.md'
  const handshakeCurl = `curl -s ${handshakeUrl} \\
  -H 'content-type: application/json' \\
  -d '{
    "agentId": "agent-demo",
    "requestedTier": "tier1",
    "proof": "bootstrap-proof-token"
  }'`
  const verifyCurl = `curl -s ${verifyUrl} \\
  -H 'content-type: application/json' \\
  -d '{
    "challengeId": "<challengeId>",
    "proof": {
      "challengeId": "<challengeId>",
      "agentId": "agent-demo",
      "tier": "tier1",
      "nonce": "<nonce-from-handshake>",
      "paidAmountUsd": 1,
      "paidAt": "2026-02-23T00:00:00.000Z",
      "signature": "<signature>"
    }
  }'`
  const paidReadCurl = `curl -s ${streamSnapshotUrl} \\
  -H 'x-agent-entitlement: <challengeId>'`

  return (
    <main id='main-content' className='mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8'>
      <div className='mb-6 flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>HL Privateer Floor</h1>
          <p className='mt-1 text-sm text-zinc-500'>Core fund monitor: mode, pnl, positions, tape.</p>
        </div>
        <div className='text-xs text-zinc-500'>polling every {Math.round(POLL_MS / 1000)}s</div>
      </div>

      {error && (
        <div className='mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700'>
          {error}
        </div>
      )}

      <section className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        <div className='rounded-md border border-zinc-200 bg-white p-3'>
          <div className='text-xs uppercase text-zinc-500'>mode</div>
          <div className='mt-1 text-lg font-semibold'>{snapshot?.mode ?? '--'}</div>
        </div>
        <div className='rounded-md border border-zinc-200 bg-white p-3'>
          <div className='text-xs uppercase text-zinc-500'>health</div>
          <div className='mt-1 text-lg font-semibold'>{snapshot?.healthCode ?? '--'}</div>
        </div>
        <div className='rounded-md border border-zinc-200 bg-white p-3'>
          <div className='text-xs uppercase text-zinc-500'>pnl</div>
          <div className='mt-1 text-lg font-semibold'>{fmtPct(snapshot?.pnlPct)}</div>
        </div>
        <div className='rounded-md border border-zinc-200 bg-white p-3'>
          <div className='text-xs uppercase text-zinc-500'>positions</div>
          <div className='mt-1 text-lg font-semibold'>{snapshot?.openPositionCount ?? positions.length}</div>
        </div>
        <div className='rounded-md border border-zinc-200 bg-white p-3'>
          <div className='text-xs uppercase text-zinc-500'>gross notional</div>
          <div className='mt-1 text-lg font-semibold'>{fmtUsd(snapshot?.openPositionNotionalUsd)}</div>
        </div>
      </section>

      <SectionCard
        title='Open Positions'
        subtitle='Current exposure across symbols'
        open={showPositions}
        onToggle={() => setShowPositions((value) => !value)}
      >
        {loading ? (
          <div className='text-sm text-zinc-500'>loading...</div>
        ) : positions.length === 0 ? (
          <div className='text-sm text-zinc-500'>no open positions</div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead>
                <tr className='border-b border-zinc-200 text-left text-xs uppercase text-zinc-500'>
                  <th className='px-2 py-2'>symbol</th>
                  <th className='px-2 py-2'>side</th>
                  <th className='px-2 py-2'>entry</th>
                  <th className='px-2 py-2'>mark</th>
                  <th className='px-2 py-2'>pnl usd</th>
                  <th className='px-2 py-2'>pnl %</th>
                  <th className='px-2 py-2'>notional</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position, index) => (
                  <tr key={`${position.symbol ?? 'unknown'}-${index}`} className='border-b border-zinc-100'>
                    <td className='px-2 py-2 font-medium'>{position.symbol ?? '--'}</td>
                    <td className='px-2 py-2'>{position.side ?? '--'}</td>
                    <td className='px-2 py-2'>{fmtUsd(position.entryPrice)}</td>
                    <td className='px-2 py-2'>{fmtUsd(position.markPrice)}</td>
                    <td className='px-2 py-2'>{fmtUsd(position.pnlUsd)}</td>
                    <td className='px-2 py-2'>{fmtPct(position.pnlPct)}</td>
                    <td className='px-2 py-2'>{fmtUsd(position.notionalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title='Recent Tape'
        subtitle='Latest desk and agent activity lines'
        open={showTape}
        onToggle={() => setShowTape((value) => !value)}
      >
        <div className='space-y-2'>
          {(tape.length > 0 ? tape : snapshot?.recentTape ?? []).slice(0, 30).map((entry, index) => (
            <div key={`${entry.ts ?? 'na'}-${index}`} className='rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm'>
              <div className='mb-1 flex items-center justify-between gap-2 text-xs text-zinc-500'>
                <span>{entry.role ?? 'system'}</span>
                <span>{fmtTs(entry.ts)}</span>
              </div>
              <div className='text-zinc-900'>{entry.line ?? '--'}</div>
            </div>
          ))}
          {!loading && (tape.length === 0 && (snapshot?.recentTape ?? []).length === 0) && (
            <div className='text-sm text-zinc-500'>no tape lines yet</div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title='Agent Access (x402)'
        subtitle='POST handshake and verify, then read with x-agent-entitlement'
        open={showAgentAccess}
        onToggle={() => setShowAgentAccess((value) => !value)}
      >
        <div className='grid gap-3 lg:grid-cols-3'>
          <div className='rounded-md border border-zinc-200 bg-zinc-50 p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <div className='font-mono text-[11px] font-semibold uppercase text-zinc-600'>POST /v1/agent/handshake</div>
              <button
                type='button'
                onClick={() => void copyToClipboard(handshakeCurl)}
                className='shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100'
              >
                copy
              </button>
            </div>
            <pre className='whitespace-pre-wrap break-all rounded bg-white p-2 text-[11px] leading-5 text-zinc-800'><code>{handshakeCurl}</code></pre>
          </div>

          <div className='rounded-md border border-zinc-200 bg-zinc-50 p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <div className='font-mono text-[11px] font-semibold uppercase text-zinc-600'>POST /v1/agent/verify</div>
              <button
                type='button'
                onClick={() => void copyToClipboard(verifyCurl)}
                className='shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100'
              >
                copy
              </button>
            </div>
            <pre className='whitespace-pre-wrap break-all rounded bg-white p-2 text-[11px] leading-5 text-zinc-800'><code>{verifyCurl}</code></pre>
          </div>

          <div className='rounded-md border border-zinc-200 bg-zinc-50 p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <div className='font-mono text-[11px] font-semibold uppercase text-zinc-600'>GET /v1/agent/stream/snapshot</div>
              <button
                type='button'
                onClick={() => void copyToClipboard(paidReadCurl)}
                className='shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100'
              >
                copy
              </button>
            </div>
            <pre className='whitespace-pre-wrap break-all rounded bg-white p-2 text-[11px] leading-5 text-zinc-800'><code>{paidReadCurl}</code></pre>
          </div>
        </div>

        <div className='mt-4 grid gap-2 text-sm sm:grid-cols-2'>
          <a href={x402WellKnownUrl} target='_blank' rel='noreferrer' className='rounded border border-zinc-200 px-2 py-1 font-mono text-blue-700 hover:bg-zinc-50 hover:underline'>/.well-known/x402</a>
          <a href={agentsDiscoveryUrl} target='_blank' rel='noreferrer' className='rounded border border-zinc-200 px-2 py-1 font-mono text-blue-700 hover:bg-zinc-50 hover:underline'>/.well-known/agents.json</a>
          <a href={agentRegistrationUrl} target='_blank' rel='noreferrer' className='rounded border border-zinc-200 px-2 py-1 font-mono text-blue-700 hover:bg-zinc-50 hover:underline'>/.well-known/agent-registration.json</a>
          <a href={x402QuickstartUrl} target='_blank' rel='noreferrer' className='rounded border border-zinc-200 px-2 py-1 font-mono text-blue-700 hover:bg-zinc-50 hover:underline'>x402 quickstart docs</a>
        </div>
      </SectionCard>

      <div className='mt-4 text-xs text-zinc-500'>last update: {fmtTs(snapshot?.lastUpdateAt)}</div>
    </main>
  )
}
