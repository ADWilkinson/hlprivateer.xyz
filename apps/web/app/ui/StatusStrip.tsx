import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import { cardClass, inlineBadgeClass, mutedPanelClass } from './ascii-style'
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
  riskDeniedSuppressed: number
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
  riskDeniedSuppressed,
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
      className={cardClass}
    >
      <div className='px-3 py-2 border-b border-[var(--border)] text-[9px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>FLOOR STATUS</div>
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
      <div className={`flex flex-wrap gap-1.5 border-t border-[var(--border)] px-3 py-2 ${mutedPanelClass}`}>
        <span className={inlineBadgeClass}>exchange=HYPERLIQUID</span>
        <span className={inlineBadgeClass}>quietSignals={suppressedNoAction}</span>
        <span className={inlineBadgeClass}>riskDenied={riskDeniedCount}</span>
        {riskDeniedSuppressed > 0 ? <span className={inlineBadgeClass}>riskDeniedSuppressed={riskDeniedSuppressed}</span> : null}
        <span className={inlineBadgeClass}>feedAgeMs={deckFeedAgeMs || '--'}ms</span>
        <span className={inlineBadgeClass}>missing={deckMissing}</span>
        <span className={inlineBadgeClass}>status=LIVE</span>
        <span className={inlineBadgeClass}>
          <AsciiBadge
            color={isFeedStale ? 'warning' : 'success'}
            className={isFeedStale ? 'text-[var(--amber)]' : 'text-[var(--positive)]'}
          >
            {isFeedStale ? 'HEARTBEAT DRIFT' : 'HEALTHY'}
          </AsciiBadge>
        </span>
        {riskDeniedReason ? <span className={inlineBadgeClass}>last risk denial: {riskDeniedReason}</span> : null}
      </div>
    </AsciiCard>
  )
}
