import { AsciiCard, AsciiBadge } from 'react-ascii-ui'
import { formatTime, type Snapshot } from './floor-dashboard'

type PnlPanelProps = {
  snapshot: Snapshot
  chart: string
}

export function PnlPanel({ snapshot, chart }: PnlPanelProps) {
  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0

  return (
    <AsciiCard
      title='PROFIT / LOSS'
      className='border border-[var(--border)] bg-[var(--bg-raised)] rounded-[var(--r)] shadow-[var(--panel-shadow)] text-[var(--fg)]'
    >
      <section className='grid grid-cols-1 gap-2 xl:grid-cols-[minmax(220px,420px)_1fr]'>
        <div className='flex flex-col justify-center gap-2 bg-[var(--bg-raised)] border border-[var(--border)] rounded-[var(--r)] p-6'>
          <div className='text-[9px] uppercase tracking-[0.25em] text-[var(--fg-muted)]'>PORTFOLIO P&L</div>
          <div
            className={`text-[34px] leading-none font-bold tracking-[-0.01em] ${
              pnl < 0 ? 'text-[var(--negative)] [text-shadow:0_0_12px_color-mix(in_srgb,_var(--negative)_15%,_transparent)]' : 'text-[var(--positive)] [text-shadow:0_0_12px_color-mix(in_srgb,_var(--positive)_15%,_transparent)]'
            }`}
          >
            {pnl >= 0 ? '+' : ''}
            {pnl.toFixed(3)}%
          </div>
          <div className='mt-2 flex items-center gap-1.5 text-[10px] text-[var(--fg-muted)]'>
            <span>HYPE vs basket</span>
            <span className='opacity-40'>·</span>
            <span>{formatTime(snapshot.lastUpdateAt)}</span>
          </div>
          <div className='mt-2.5'>
            <AsciiBadge color={snapshot.mode === 'SAFE_MODE' || snapshot.mode === 'HALT' ? 'error' : 'success'}>
              {snapshot.mode === 'SAFE_MODE' || snapshot.mode === 'HALT' ? 'RISK MODE' : 'TRADING READY'}
            </AsciiBadge>
          </div>
        </div>
        <div className='border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg-raised)] p-3'>
          <div className='mb-2 text-[9px] uppercase tracking-[0.25em] text-[var(--fg-muted)]'>PNL TRAJECTORY</div>
          <pre className='m-0 overflow-x-auto whitespace-pre text-[11px] leading-[1.15] text-[var(--fg-muted)]'>{chart}</pre>
        </div>
      </section>
    </AsciiCard>
  )
}
