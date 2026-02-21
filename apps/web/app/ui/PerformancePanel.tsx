import { AsciiBadge } from './ascii-kit'
import {
  cardClass,
  collapsibleHeaderClass,
  inverseControlClass,
  panelBodyPad,
  skeletonPulseClass,
} from './ascii-style'
import type { PerformanceAttribution } from './floor-dashboard'

const PCT_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--'
  const hours = Math.floor(ms / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function pctStr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${PCT_FMT.format(value)}%`
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className='flex flex-col gap-0.5 min-w-[80px]'>
      <span className='text-[8px] uppercase tracking-[0.18em] text-hlpDim'>{label}</span>
      <span className={`text-[13px] font-semibold tracking-[0.02em] ${color ?? 'text-hlpFg'}`}>{value}</span>
    </div>
  )
}

type PerformancePanelProps = {
  data: PerformanceAttribution | null
  isLoading?: boolean
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
}

export function PerformancePanel({
  data,
  isLoading = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'performance',
}: PerformancePanelProps) {
  const hasData = data && data.totalTrades > 0
  const winColor = hasData && data.winRate >= 0.5 ? 'text-hlpPositive' : 'text-hlpNegative'

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle performance attribution panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className='uppercase tracking-[0.24em]'>PERFORMANCE ATTRIBUTION</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>
            {isCollapsed ? '+' : '\u2212'}
          </span>
          <AsciiBadge tone='inverse'>trade journal</AsciiBadge>
        </div>
      </button>

      <div id={`section-${sectionId}`} hidden={isCollapsed}>
        {!isCollapsed && (
          <div className={`${panelBodyPad} space-y-3`}>
            {isLoading ? (
              <div className='space-y-2'>
                <span className={`block h-4 w-48 ${skeletonPulseClass}`} />
                <span className={`block h-4 w-32 ${skeletonPulseClass}`} />
              </div>
            ) : !hasData ? (
              <div className='text-[10px] text-hlpMuted uppercase tracking-[0.16em] py-3'>
                no closed trades yet — waiting for trade journal data
              </div>
            ) : (
              <>
                <div className='flex flex-wrap gap-x-6 gap-y-2 border-b border-hlpBorder pb-2'>
                  <StatCell label='Total Trades' value={String(data.totalTrades)} />
                  <StatCell label='Win Rate' value={`${PCT_FMT.format(data.winRate * 100)}%`} color={winColor} />
                  <StatCell label='Wins' value={String(data.wins)} color='text-hlpPositive' />
                  <StatCell label='Losses' value={String(data.losses)} color='text-hlpNegative' />
                  <StatCell label='Avg Win' value={pctStr(data.avgWinPct)} color='text-hlpPositive' />
                  <StatCell label='Avg Loss' value={pctStr(data.avgLossPct)} color='text-hlpNegative' />
                  <StatCell label='Avg Hold' value={formatMs(data.avgHoldMs)} />
                </div>

                <div className='flex flex-wrap gap-x-6 gap-y-2'>
                  {data.bestTrade && (
                    <StatCell
                      label='Best Trade'
                      value={`${data.bestTrade.symbol} ${pctStr(data.bestTrade.pnlPct)}`}
                      color='text-hlpPositive'
                    />
                  )}
                  {data.worstTrade && (
                    <StatCell
                      label='Worst Trade'
                      value={`${data.worstTrade.symbol} ${pctStr(data.worstTrade.pnlPct)}`}
                      color='text-hlpNegative'
                    />
                  )}
                </div>

                {data.recentClosed.length > 0 && (
                  <div className='border-t border-hlpBorder pt-2'>
                    <div className='text-[8px] uppercase tracking-[0.18em] text-hlpDim mb-1'>Recent Closed</div>
                    <div className='space-y-0.5'>
                      {data.recentClosed.slice(-8).reverse().map((trade, i) => {
                        const pnl = trade.realizedPnlPct
                        const color = pnl != null && pnl > 0 ? 'text-hlpPositive' : pnl != null && pnl < 0 ? 'text-hlpNegative' : 'text-hlpMuted'
                        return (
                          <div key={i} className='flex items-center gap-2 text-[10px]'>
                            <span className='text-hlpMuted w-10'>{trade.side}</span>
                            <span className='text-hlpFg w-14'>{trade.symbol}</span>
                            <span className={`${color} w-16 text-right`}>{pctStr(pnl)}</span>
                            <span className='text-hlpDim'>{trade.exitReason ?? '--'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
