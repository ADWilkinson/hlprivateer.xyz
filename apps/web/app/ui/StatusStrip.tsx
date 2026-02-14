import { AsciiBadge } from './ascii-kit'
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionStripClass, statusCellClass } from './ascii-style'
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

const LED_CLASS_BY_STATE = {
  ok: 'bg-hlpPositive dark:bg-hlpPositiveDark shadow-[0_0_8px_rgba(47,139,103,0.35)] dark:shadow-[0_0_8px_rgba(86,207,173,0.34)] animate-hlp-led',
  warn: 'bg-hlpWarning dark:bg-hlpWarningDark shadow-[0_0_8px_rgba(180,136,68,0.35)] dark:shadow-[0_0_8px_rgba(223,190,112,0.34)] animate-hlp-led',
  danger: 'bg-hlpNegative dark:bg-hlpNegativeDark shadow-[0_0_8px_rgba(185,93,105,0.35)] dark:shadow-[0_0_8px_rgba(225,141,152,0.34)] animate-hlp-led',
} as const

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
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span>FLOOR STATUS</span>
        <AsciiBadge tone='info' variant='angle'>
          telemetry layer
        </AsciiBadge>
      </div>

      <div className='grid grid-cols-1 border-x border-b border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface dark:bg-hlpSurfaceDark gap-px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'>
        <div className={statusCellClass}>
          <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>MODE</span>
          <span className='text-[11px] font-bold'>{snapshot.mode}</span>
        </div>
        <div className={statusCellClass}>
          <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>WS</span>
          <span
            className={`text-[11px] font-bold ${
              wsState === 'OPEN' ? 'text-hlpPositive dark:text-hlpPositiveDark' : 'text-hlpNegative dark:text-hlpNegativeDark'
            }`}
          >
            {wsState}
          </span>
        </div>
        <div className={statusCellClass}>
          <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>HEALTH</span>
          <span className='flex items-center gap-2'>
            <span className={`h-1.5 w-1.5 rounded-full ${LED_CLASS_BY_STATE[health]}`} />
            <span className='text-[11px] font-bold'>{snapshot.healthCode}</span>
          </span>
        </div>
        <div className={statusCellClass}>
          <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>DRIFT</span>
          <span className='flex items-center gap-2'>
            <span className={`h-1.5 w-1.5 rounded-full ${LED_CLASS_BY_STATE[drift]}`} />
            <span className='text-[11px] font-bold'>{snapshot.driftState}</span>
          </span>
        </div>
        <div className={statusCellClass}>
          <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>FEED AGE</span>
          <span className={`text-[11px] font-bold ${isFeedStale ? 'text-hlpNegative dark:text-hlpNegativeDark' : ''}`}>
            {formatAge(Math.max(0, snapshotAgeMs))}
          </span>
        </div>
        <div className={statusCellClass}>
          <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>DECK HEARTBEAT</span>
          <span className='text-[11px] font-bold'>{formatAge(Math.max(0, heartbeatAgeMs))}</span>
        </div>
      </div>

      <div className={sectionStripClass}>
        <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark flex items-center gap-1'>
          <span>ops stream:</span>
          <span className='h-1.5 w-1.5 rounded-full bg-hlpPositive/80 dark:bg-hlpPositiveDark/80 animate-hlp-led' />
        </span>
        <span className={inlineBadgeClass}>exchange=HYPERLIQUID</span>
        <span className={inlineBadgeClass}>quietSignals={suppressedNoAction}</span>
        <span className={inlineBadgeClass}>riskDenied={riskDeniedCount}</span>
        {riskDeniedSuppressed > 0 ? <span className={inlineBadgeClass}>riskDeniedSuppressed={riskDeniedSuppressed}</span> : null}
        <span className={inlineBadgeClass}>feedAgeMs={deckFeedAgeMs || '--'}ms</span>
        <span className={inlineBadgeClass}>missing={deckMissing}</span>
        <span className={inlineBadgeClass}>status=LIVE</span>
        <span className={inlineBadgeClass}>
          <AsciiBadge
            tone={isFeedStale ? 'warning' : 'positive'}
            variant='curly'
            className={isFeedStale ? 'text-hlpWarning dark:text-hlpWarningDark' : 'text-hlpPositive dark:text-hlpPositiveDark'}
          >
            {isFeedStale ? 'HEARTBEAT DRIFT' : 'HEALTHY'}
          </AsciiBadge>
        </span>
        {riskDeniedReason ? <span className={inlineBadgeClass}>last risk denial: {riskDeniedReason}</span> : null}
      </div>
    </section>
  )
}
