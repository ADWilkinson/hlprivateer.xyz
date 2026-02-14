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
  return <span className={`led ${variant}`} />
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
    <AsciiCard title='FLOOR STATUS' className='panel-card' style={{ padding: 0, backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border)' }}>
      <div className='strip'>
        <div className='strip-item'>
          <span className='strip-label'>MODE</span>
          <span className='strip-value'>{snapshot.mode}</span>
        </div>
        <span className='strip-sep'>│</span>
        <div className='strip-item'>
          <span className='strip-label'>WS</span>
          <span className={`strip-value ${wsState === 'OPEN' ? 'ok' : 'warn'}`}>{wsState}</span>
        </div>
        <span className='strip-sep'>│</span>
        <div className='strip-item'>
          <span className='strip-label'>HEALTH</span>
          <Led variant={health} />
          <span className='strip-value'>{snapshot.healthCode}</span>
        </div>
        <span className='strip-sep'>│</span>
        <div className='strip-item'>
          <span className='strip-label'>DRIFT</span>
          <Led variant={drift} />
          <span className='strip-value'>{snapshot.driftState}</span>
        </div>
        <span className='strip-sep'>│</span>
        <div className='strip-item'>
          <span className='strip-label'>FEED AGE</span>
          <span className={`strip-value ${isFeedStale ? 'warn' : ''}`}>{formatAge(Math.max(0, snapshotAgeMs))}</span>
        </div>
        <span className='strip-sep'>│</span>
        <div className='strip-item'>
          <span className='strip-label'>DECK HEARTBEAT</span>
          <span className='strip-value'>{formatAge(Math.max(0, heartbeatAgeMs))}</span>
        </div>
      </div>
      <div className='plan-meta' style={{ padding: '6px 12px 10px' }}>
        <span className='plan-meta-item'>exchange=HYPERLIQUID</span>
        <span className='plan-meta-item'>quietSignals={suppressedNoAction}</span>
        <span className='plan-meta-item'>riskDenied={riskDeniedCount}</span>
        <span className='plan-meta-item'>feedAgeMs={deckFeedAgeMs || '--'}ms</span>
        <span className='plan-meta-item'>missing={deckMissing}</span>
        <span className='plan-meta-item'>status=LIVE</span>
        <span className='plan-meta-item'>
          <AsciiBadge color={isFeedStale ? 'warning' : 'success'}>{isFeedStale ? 'HEARTBEAT DRIFT' : 'HEALTHY'}</AsciiBadge>
        </span>
        {riskDeniedReason ? <span className='plan-meta-item'>last risk denial: {riskDeniedReason}</span> : null}
      </div>
    </AsciiCard>
  )
}
