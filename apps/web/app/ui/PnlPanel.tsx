import { AsciiBadge } from './ascii-kit'
import { formatTime, type Snapshot } from './floor-dashboard'
import { cardClass, cardHeaderClass, sectionTitleClass, skeletonPulseClass } from './ascii-style'

type PnlPanelProps = {
  snapshot: Snapshot
  chart: string
  isLoading?: boolean
}

export function PnlPanel({ snapshot, chart, isLoading = false }: PnlPanelProps) {
  const pnl = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0
  const isHealthy = snapshot.mode !== 'SAFE_MODE' && snapshot.mode !== 'HALT'

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>PROFIT / LOSS</div>

      <section className='grid grid-cols-1 gap-2 xl:grid-cols-[minmax(220px,420px)_1fr] min-h-[300px]'>
        <div className='flex min-h-[150px] flex-col justify-center gap-2 border border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel dark:bg-hlpPanelDark rounded-hlp p-5'>
          <div className={sectionTitleClass}>PORTFOLIO P&L</div>
          {isLoading ? (
            <>
              <div className={`h-8 w-40 rounded-sm ${skeletonPulseClass}`} />
              <div className='mt-2 flex items-center gap-1.5'>
                <span className={`h-3 w-24 rounded-sm ${skeletonPulseClass}`} />
                <span className='opacity-40'>·</span>
                <span className={`h-3 w-20 rounded-sm ${skeletonPulseClass}`} />
              </div>
              <div className='mt-2'>
                <span className={`h-7 w-28 inline-block rounded-sm ${skeletonPulseClass}`} />
              </div>
            </>
          ) : (
            <>
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
                <AsciiBadge
                  tone={isHealthy ? 'positive' : 'error'}
                  className={isHealthy ? 'text-hlpPositive dark:text-hlpPositiveDark' : 'text-hlpNegative dark:text-hlpNegativeDark'}
                >
                  {isHealthy ? 'TRADING READY' : 'RISK MODE'}
                </AsciiBadge>
              </div>
            </>
          )}
        </div>

        <div className='flex min-h-[150px] flex-col rounded-hlp border border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel dark:bg-hlpPanelDark p-3'>
          <div className={sectionTitleClass}>PNL TRAJECTORY</div>
          {isLoading ? (
            <div className={`mt-2 min-h-0 flex-1 rounded-sm ${skeletonPulseClass}`} />
          ) : (
            <pre className='m-0 max-h-[168px] overflow-x-auto overflow-y-auto whitespace-pre text-[11px] leading-[1.15] text-hlpMuted dark:text-hlpMutedDark'>{chart}</pre>
          )}
        </div>
      </section>
    </section>
  )
}
