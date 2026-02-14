import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import {
  badgeVariantForDrift,
  badgeVariantForHealth,
  type Snapshot,
  type WsState,
  formatAge,
} from './floor-dashboard'

type StatusStripProps = {
  snapshot: Snapshot
  wsState: WsState
  suppressedNoAction: number
  riskDeniedCount: number
  riskDeniedReason: string
  heartbeatAgeMs: number
  snapshotAgeMs: number
  deckFeedAgeMs: number
  deckMissing: number
}

function Led({ variant }: { variant: 'ok' | 'warn' | 'danger' }) {
  const variantClass = {
    ok: 'bg-[var(--positive)] shadow-[0_0_6px_color-mix(in_srgb,_var(--positive)_35%,_transparent)] animate-[led-pulse_3s_ease-in-out_infinite]',
    warn: 'bg-[var(--amber)] shadow-[0_0_6px_color-mix(in_srgb,_var(--amber)_35%,_transparent)] animate-[led-pulse_2s_ease-in-out_infinite]',
    danger: 'bg-[var(--negative)] shadow-[0_0_6px_color-mix(in_srgb,_var(--negative)_35%,_transparent)] animate-[led-pulse_1s_ease-in-out_infinite]',
  }[variant]

  return <span className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${variantClass}`} />
}

export function StatusStrip({
  snapshot,
  wsState,
  suppressedNoAction,
  riskDeniedCount,
  riskDeniedReason,
  heartbeatAgeMs,
  snapshotAgeMs,
  deckFeedAgeMs,
  deckMissing,
}: StatusStripProps) {
  const health = badgeVariantForHealth(snapshot.healthCode)
  const drift = badgeVariantForDrift(snapshot.driftState)
  const isFeedStale = snapshotAgeMs > 12_000

  return (
    <AsciiCard
      title='FLOOR STATUS'
      className='border border-[var(--border)] bg-[var(--bg-raised)] rounded-[var(--r)] shadow-[var(--panel-shadow)] text-[var(--fg)]'
    >
      <div className='grid grid-cols-1 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'>
        <div className='flex items-center justify-between gap-2 bg-[var(--bg-raised)] px-3 py-2 min-h-[34px]'>
          <span className='text-[8px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>MODE</span>
          <span className='text-[11px] font-bold text-[var(--fg)]'>{snapshot.mode}</span>
        </div>
        <div className='flex items-center justify-between gap-2 bg-[var(--bg-raised)] px-3 py-2 min-h-[34px]'>
          <span className='text-[8px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>WS</span>
          <span className={`text-[11px] font-bold ${wsState === 'OPEN' ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>{wsState}</span>
        </div>
        <div className='flex items-center justify-between gap-2 bg-[var(--bg-raised)] px-3 py-2 min-h-[34px]'>
          <span className='text-[8px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>HEALTH</span>
          <Led variant={health} />
          <span className='text-[11px] font-bold text-[var(--fg)]'>{snapshot.healthCode}</span>
        </div>
        <div className='flex items-center justify-between gap-2 bg-[var(--bg-raised)] px-3 py-2 min-h-[34px]'>
          <span className='text-[8px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>DRIFT</span>
          <Led variant={drift} />
          <span className='text-[11px] font-bold text-[var(--fg)]'>{snapshot.driftState}</span>
        </div>
        <div className='flex items-center justify-between gap-2 bg-[var(--bg-raised)] px-3 py-2 min-h-[34px]'>
          <span className='text-[8px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>FEED AGE</span>
          <span className={`text-[11px] font-bold ${isFeedStale ? 'text-[var(--negative)]' : 'text-[var(--fg)]'}`}>{formatAge(Math.max(0, snapshotAgeMs))}</span>
        </div>
        <div className='flex items-center justify-between gap-2 bg-[var(--bg-raised)] px-3 py-2 min-h-[34px]'>
          <span className='text-[8px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>DECK HEARTBEAT</span>
          <span className='text-[11px] font-bold text-[var(--fg)]'>{formatAge(Math.max(0, heartbeatAgeMs))}</span>
        </div>
      </div>
      <div className='flex flex-wrap gap-1.5 border-t border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2'>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>exchange=HYPERLIQUID</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>quietSignals={suppressedNoAction}</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>riskDenied={riskDeniedCount}</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>feedAgeMs={deckFeedAgeMs || '--'}ms</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>missing={deckMissing}</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>status=LIVE</span>
        <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>
          <AsciiBadge color={isFeedStale ? 'warning' : 'success'}>{isFeedStale ? 'HEARTBEAT DRIFT' : 'HEALTHY'}</AsciiBadge>
        </span>
        {riskDeniedReason ? <span className='border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'>last risk denial: {riskDeniedReason}</span> : null}
      </div>
    </AsciiCard>
  )
}
