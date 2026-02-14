import { AsciiBadge } from './ascii-kit'
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionStripClass, skeletonPulseClass, statusCellClass } from './ascii-style'
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
  heartbeatAgeMs: number
  snapshotAgeMs: number
  deckFeedAgeMs: number
  deckMissing: number
  isLoading?: boolean
}

const LED_CLASS_BY_STATE = {
  ok: 'bg-hlpPositive dark:bg-hlpPositiveDark shadow-[0_0_8px_rgba(0,114,181,0.35)] dark:shadow-[0_0_8px_rgba(89,244,244,0.35)] animate-hlp-led',
  warn: 'bg-hlpWarning dark:bg-hlpWarningDark shadow-[0_0_8px_rgba(220,127,90,0.32)] dark:shadow-[0_0_8px_rgba(239,160,128,0.30)] animate-hlp-led',
  danger: 'bg-hlpNegative dark:bg-hlpNegativeDark shadow-[0_0_8px_rgba(181,111,106,0.32)] dark:shadow-[0_0_8px_rgba(229,163,154,0.30)] animate-hlp-led',
} as const

export function StatusStrip({
  snapshot,
  wsState,
  suppressedNoAction,
  riskDeniedCount,
  heartbeatAgeMs,
  snapshotAgeMs,
  deckFeedAgeMs,
  deckMissing,
  isLoading = false,
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

      <div className='grid min-h-0 grid-cols-2 border-x border-b border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface dark:bg-hlpSurfaceDark gap-px sm:grid-cols-3 lg:grid-cols-6'>
        {isLoading ? (
          <>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>MODE</span>
              <span className={`h-3 w-20 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>WS</span>
              <span className={`h-3 w-16 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>HEALTH</span>
              <span className={`h-3 w-14 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>DRIFT</span>
              <span className={`h-3 w-14 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>FEED AGE</span>
              <span className={`h-3 w-14 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>DECK HEARTBEAT</span>
              <span className={`h-3 w-24 rounded-sm ${skeletonPulseClass}`} />
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className={sectionStripClass}>
        {isLoading ? (
          <>
            <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>reconciling links…</span>
            <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
            <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
            <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
          </>
        ) : (
          <>
            <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>live stream</span>
            <span className={inlineBadgeClass}>risk denied {riskDeniedCount}</span>
            <span className={inlineBadgeClass}>suppressed {suppressedNoAction}</span>
            <span className={inlineBadgeClass}>status {isFeedStale ? 'DEGRADED' : 'LIVE'}</span>
            <span className={inlineBadgeClass}>missing={deckMissing}</span>
          </>
        )}
      </div>
    </section>
  )
}
