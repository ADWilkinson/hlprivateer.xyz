import { AsciiBadge } from 'react-ascii-ui'
import { formatTime, type Snapshot } from './floor-dashboard'
import { cardClass, cardHeaderClass, sectionTitleClass } from './ascii-style'

type PnlPanelProps = {
  snapshot: Snapshot
  chart: string
}

export function PnlPanel({ snapshot, chart }: PnlPanelProps) {
  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0
  const isHealthy = snapshot.mode !== 'SAFE_MODE' && snapshot.mode !== 'HALT'

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>PROFIT / LOSS</div>

      <section className='grid grid-cols-1 gap-2 xl:grid-cols-[minmax(220px,420px)_1fr]'>
        <div className='flex min-h-[164px] flex-col justify-center gap-2 border border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel dark:bg-hlpPanelDark rounded-hlp p-6'>
          <div className={sectionTitleClass}>PORTFOLIO P&L</div>
          <div
            className={`text-[34px] leading-none font-bold tracking-[-0.01em] ${
              pnl < 0 ? 'text-hlpNegative dark:text-hlpNegativeDark' : 'text-hlpPositive dark:text-hlpPositiveDark'
            }`}
          >
            {pnl >= 0 ? '+' : ''}
            {pnl.toFixed(3)}%
          </div>
          <div className='mt-2 flex items-center gap-1.5 text-[10px] text-hlpMuted dark:text-hlpMutedDark'>
            <span>HYPE vs basket</span>
            <span className='opacity-40'>·</span>
            <span>{formatTime(snapshot.lastUpdateAt)}</span>
          </div>
          <div className='mt-2'>
            <AsciiBadge color={isHealthy ? 'success' : 'error'} className={isHealthy ? 'text-hlpPositive dark:text-hlpPositiveDark' : 'text-hlpNegative dark:text-hlpNegativeDark'}>
              {isHealthy ? 'TRADING READY' : 'RISK MODE'}
            </AsciiBadge>
          </div>
        </div>

        <div className='border border-hlpBorder dark:border-hlpBorderDark rounded-hlp bg-hlpPanel dark:bg-hlpPanelDark p-3'>
          <div className={sectionTitleClass}>PNL TRAJECTORY</div>
          <pre className='m-0 max-h-[168px] overflow-x-auto overflow-y-auto whitespace-pre text-[11px] leading-[1.15] text-hlpMuted dark:text-hlpMutedDark'>{chart}</pre>
        </div>
      </section>
    </section>
  )
}
