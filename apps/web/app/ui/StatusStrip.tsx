import { AsciiBadge } from './ascii-kit'
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionStripClass, skeletonPulseClass, statusCellClass } from './ascii-style'
import {
  badgeVariantForDrift,
  badgeVariantForHealth,
  driftStatusLabel,
  healthStatusLabel,
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
  ok: 'bg-hlpHealthy animate-hlp-led',
  warn: 'bg-hlpWarning animate-hlp-led',
  danger: 'bg-hlpNegative animate-hlp-led',
} as const

const LED_TEXT_BY_STATE = {
  ok: 'text-hlpHealthy',
  warn: 'text-hlpWarning',
  danger: 'text-hlpNegative',
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
  const healthLabel = healthStatusLabel(snapshot.healthCode)
  const driftLabel = driftStatusLabel(snapshot.driftState)
  const isFeedStale = snapshotAgeMs > 12_000

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span>FLOOR STATUS</span>
        <AsciiBadge tone='info' variant='angle'>
          telemetry layer
        </AsciiBadge>
      </div>

      <div className='grid min-h-0 grid-cols-2 border-x border-b border-hlpBorder bg-hlpSurface gap-px sm:grid-cols-3 lg:grid-cols-6'>
        {isLoading ? (
          <>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>MODE</span>
              <span className={`h-3 w-20 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>WS</span>
              <span className={`h-3 w-16 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>HEALTH</span>
              <span className={`h-3 w-14 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>DRIFT</span>
              <span className={`h-3 w-14 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>FEED AGE</span>
              <span className={`h-3 w-14 rounded-sm ${skeletonPulseClass}`} />
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>DECK HEARTBEAT</span>
              <span className={`h-3 w-24 rounded-sm ${skeletonPulseClass}`} />
            </div>
          </>
        ) : (
          <>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>MODE</span>
              <span className='text-[11px] font-bold'>{snapshot.mode}</span>
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>WS</span>
              <span
                className={`text-[11px] font-bold ${
                  wsState === 'OPEN' ? 'text-hlpHealthy' : 'text-hlpNegative'
                }`}
              >
                {wsState}
              </span>
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>HEALTH</span>
              <span className='flex items-center gap-2'>
                <span className={`h-1.5 w-1.5 rounded-full ${LED_CLASS_BY_STATE[health]}`} />
                <span className={`text-[11px] font-bold ${LED_TEXT_BY_STATE[health]}`}>{healthLabel}</span>
              </span>
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>DRIFT</span>
              <span className='flex items-center gap-2'>
                <span className={`h-1.5 w-1.5 rounded-full ${LED_CLASS_BY_STATE[drift]}`} />
                <span className='text-[11px] font-bold'>{driftLabel}</span>
              </span>
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>FEED AGE</span>
              <span className={`text-[11px] font-bold ${isFeedStale ? 'text-hlpNegative' : ''}`}>
                {formatAge(Math.max(0, snapshotAgeMs))}
              </span>
            </div>
            <div className={statusCellClass}>
              <span className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted'>DECK HEARTBEAT</span>
              <span className='text-[11px] font-bold'>{formatAge(Math.max(0, heartbeatAgeMs))}</span>
            </div>
          </>
        )}
      </div>

      <div className={sectionStripClass}>
        {isLoading ? (
          <>
            <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>reconciling links…</span>
            <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
            <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
            <span className={`${skeletonPulseClass} h-5 w-28 rounded-sm`} />
          </>
        ) : (
          <>
            <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>live stream</span>
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
