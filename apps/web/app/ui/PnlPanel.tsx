import { AsciiCard, AsciiBadge } from 'react-ascii-ui'
import { formatTime, type Snapshot } from './floor-dashboard'

type PnlPanelProps = {
  snapshot: Snapshot
  chart: string
}

export function PnlPanel({ snapshot, chart }: PnlPanelProps) {
  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0

  return (
    <AsciiCard title='PROFIT / LOSS' className='panel-shell'>
      <section className='pnl-row'>
        <div className='pnl-hero'>
          <div className='pnl-label'>PORTFOLIO P&L</div>
          <div className={`pnl-value ${pnl < 0 ? 'negative' : ''}`}>
            {pnl >= 0 ? '+' : ''}
            {pnl.toFixed(3)}%
          </div>
          <div className='pnl-meta'>
            <span>HYPE vs basket</span>
            <span className='pnl-dot'>·</span>
            <span>{formatTime(snapshot.lastUpdateAt)}</span>
          </div>
          <div className='plan-meta-item mt-2.5'>
            <AsciiBadge color={snapshot.mode === 'SAFE_MODE' || snapshot.mode === 'HALT' ? 'error' : 'success'}>
              {snapshot.mode === 'SAFE_MODE' || snapshot.mode === 'HALT' ? 'RISK MODE' : 'TRADING READY'}
            </AsciiBadge>
          </div>
        </div>
        <div className='pnl-chart-panel'>
          <div className='section-label'>PNL TRAJECTORY</div>
          <pre className='chart'>{chart}</pre>
        </div>
      </section>
    </AsciiCard>
  )
}
