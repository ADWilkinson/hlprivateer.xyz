import { useMemo } from 'react'
import dynamic from 'next/dynamic'

const Liveline = dynamic(() => import('liveline').then((m) => m.Liveline), { ssr: false })
import { AsciiBadge } from './ascii-kit'
import {
  cardClass,
  collapsibleHeaderClass,
  inverseControlClass,
  monitorClass,
  panelBodyPad,
  panelHeaderPad,
  skeletonPulseClass,
} from './ascii-style'
import { type Snapshot } from './floor-dashboard'

const PNL_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
  minimumFractionDigits: 3,
})
const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

type TrajectoryPoint = { ts: string; pnlPct: number }
type AccountValuePoint = { ts: string; accountValueUsd: number }

type PnlPanelProps = {
  snapshot: Snapshot
  trajectory?: TrajectoryPoint[]
  accountValueTrajectory?: AccountValuePoint[]
  isLoading?: boolean
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
}

function formatPnl(v: number): string {
  return `${v >= 0 ? '+' : ''}${PNL_FORMAT.format(v)}%`
}

export function PnlPanel({
  snapshot,
  trajectory = [],
  accountValueTrajectory = [],
  isLoading = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'pnl',
}: PnlPanelProps) {
  const pnlData = useMemo(
    () =>
      trajectory
        .map((p) => ({ time: Date.parse(p.ts), value: p.pnlPct }))
        .filter((p) => Number.isFinite(p.time)),
    [trajectory],
  )

  const accountValueData = useMemo(
    () =>
      accountValueTrajectory
        .map((p) => ({ time: Date.parse(p.ts), value: p.accountValueUsd }))
        .filter((p) => Number.isFinite(p.time)),
    [accountValueTrajectory],
  )

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle pnl trajectory panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className='uppercase tracking-[0.24em]'>PNL TRAJECTORY</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>{isCollapsed ? '+' : '\u2212'}</span>
          <AsciiBadge tone='inverse'>performance stream</AsciiBadge>
        </div>
      </button>

      <div id={`section-${sectionId}`} hidden={isCollapsed}>
        {!isCollapsed && (
          <div className={`${panelBodyPad} grid gap-3`}>
            {isLoading ? (
              <div className='grid min-h-[204px] items-center gap-3 bg-hlpSurface/80 p-3 text-[11px] text-hlpMuted'>
                <div className='text-[11px] uppercase tracking-[0.18em]'>trajectory warming</div>
                <span className={`h-4 w-44 ${skeletonPulseClass}`} />
                <span className='inline-block h-32 w-full bg-hlpSurface animate-pulse' />
              </div>
            ) : (
              <div className='grid gap-2 xl:grid-cols-2'>
                <article className={monitorClass} aria-label='market-pnl'>
                  <div className={`flex flex-wrap items-start border-b border-hlpBorder ${panelBodyPad} ${panelHeaderPad}`}>
                    <span className='text-[10px] sm:text-[9px] uppercase tracking-[0.24em] text-hlpMuted'>
                      MARKET PNL OVER TIME
                    </span>
                  </div>
                  <div className='h-[262px]'>
                    <Liveline
                      data={pnlData}
                      value={snapshot.pnlPct ?? 0}
                      theme='light'
                      color='#2D8544'
                      momentum={true}
                      referenceLine={{ value: 0, label: '0%' }}
                      formatValue={formatPnl}
                      window={2400}
                    />
                  </div>
                </article>

                <article className={monitorClass} aria-label='account-value'>
                  <div className={`flex flex-wrap items-start border-b border-hlpBorder ${panelBodyPad} ${panelHeaderPad}`}>
                    <span className='text-[10px] sm:text-[9px] uppercase tracking-[0.24em] text-hlpMuted'>
                      ACCOUNT VALUE OVER TIME
                    </span>
                  </div>
                  <div className='h-[262px]'>
                    <Liveline
                      data={accountValueData}
                      value={snapshot.accountValueUsd ?? 0}
                      theme='light'
                      color='#0066CC'
                      formatValue={(v) => USD_FORMAT.format(v)}
                      window={2400}
                    />
                  </div>
                </article>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
