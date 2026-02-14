import { AsciiBadge, AsciiTable } from './ascii-kit'
import { formatTime, type OpenPosition, type Snapshot } from './floor-dashboard'
import {
  cardClass,
  cardHeaderClass,
  inlineBadgeClass,
  monitorClass,
  panelBodyPad,
  panelBalancedPad,
  sectionStripClass,
  sectionTitleClass,
  skeletonPulseClass,
} from './ascii-style'

type TrajectoryStats = {
  min: number
  max: number
  first: number
  last: number
  delta: number
  deltaPct: number
  samples: number
}

type PnlPanelProps = {
  snapshot: Snapshot
  chart: string
  trajectory: TrajectoryStats
  isLoading?: boolean
}

function toFixed(value: number | undefined, digits = 2): string {
  return Number.isFinite(value ?? Number.NaN) ? (value ?? 0).toFixed(digits) : '0.00'
}

function toSigned(value: number | undefined, digits = 2): string {
  if (!Number.isFinite(value ?? Number.NaN)) return '0.00'
  const resolved = value ?? 0
  return `${resolved >= 0 ? '+' : ''}${toFixed(resolved, digits)}`
}

function formatUsd(value: number | undefined): string {
  if (!Number.isFinite(value ?? Number.NaN)) return '--'
  return `$${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

function positionSideTone(side: string | undefined): 'positive' | 'error' | 'warning' | 'neutral' {
  if (!side) return 'neutral'
  const normalized = side.toUpperCase()
  if (normalized === 'LONG' || normalized === 'BUY' || normalized === 'BULL') return 'positive'
  if (normalized === 'SHORT' || normalized === 'SELL' || normalized === 'BEAR') return 'error'
  return 'warning'
}

function safePnlClass(value: number | undefined): string {
  if (!Number.isFinite(value ?? Number.NaN)) return 'text-hlpMuted dark:text-hlpMutedDark'
  const resolved = value ?? 0
  return resolved >= 0 ? 'text-hlpPositive dark:text-hlpPositiveDark' : 'text-hlpNegative dark:text-hlpNegativeDark'
}

export function PnlPanel({ snapshot, chart, trajectory, isLoading = false }: PnlPanelProps) {
  const pnlPct = Number.isFinite(snapshot.pnlPct) ? snapshot.pnlPct : 0
  const isHealthy = snapshot.mode !== 'SAFE_MODE' && snapshot.mode !== 'HALT'
  const isLive = snapshot.mode !== 'INIT' && !Number.isNaN(Number(snapshot.pnlPct))
  const positions = snapshot.openPositions ?? []
  const positionRows = positions
    .slice()
    .sort((a, b) => Math.abs(b.pnlPct ?? b.pnlUsd ?? 0) - Math.abs(a.pnlPct ?? a.pnlUsd ?? 0))

  const positionCount =
    Number.isFinite(snapshot.openPositionCount ?? Number.NaN)
      ? (snapshot.openPositionCount as number)
      : positions.length
  const totalNotionalUsd = Number.isFinite(snapshot.openPositionNotionalUsd ?? Number.NaN)
    ? (snapshot.openPositionNotionalUsd as number)
    : positionRows.reduce((seed, row) => seed + (row.notionalUsd ?? 0), 0)
  const totalPnlUsd = positionRows.reduce((seed, row) => seed + (row.pnlUsd ?? 0), 0)
  const longRows = positionRows.filter((row) => {
    const side = row.side?.toUpperCase()
    return side === 'LONG' || side === 'BUY'
  }).length
  const shortRows = positionRows.length - longRows

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>PROFIT / LOSS</div>

      <section className={`grid gap-2 ${panelBalancedPad} xl:grid-cols-[minmax(280px,430px)_minmax(0,1fr)]`}>
        <article
          className={`flex min-h-[220px] flex-col gap-3 border border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel dark:bg-hlpPanelDark rounded-hlp ${panelBodyPad}`}
        >
          <div className='flex items-center justify-between gap-2'>
            <div className={sectionTitleClass}>PORTFOLIO SNAPSHOT</div>
            <AsciiBadge tone='info' className='text-hlpMuted dark:text-hlpMutedDark'>
              {isHealthy ? 'STRATEGIC READY' : 'SAFETY HOLD'}
            </AsciiBadge>
          </div>

          {isLoading ? (
            <>
              <div className={`h-9 w-40 rounded-sm ${skeletonPulseClass}`} />
              <div className='flex flex-wrap gap-2'>
                <span className={`h-5 w-28 rounded-sm ${skeletonPulseClass}`} />
                <span className={`h-5 w-24 rounded-sm ${skeletonPulseClass}`} />
                <span className={`h-5 w-32 rounded-sm ${skeletonPulseClass}`} />
              </div>
            </>
          ) : (
            <>
              <div
                className={`text-[35px] leading-none font-bold tracking-[-0.02em] ${isHealthy ? (pnlPct >= 0 ? 'text-hlpPositive dark:text-hlpPositiveDark' : 'text-hlpNegative dark:text-hlpNegativeDark') : 'text-hlpMuted dark:text-hlpMutedDark'}`}
              >
                {toSigned(pnlPct, 3)}%
              </div>

              <div className='space-y-2 text-[10px]'>
                <div className='flex flex-wrap items-center gap-2 text-hlpMuted dark:text-hlpMutedDark'>
                  <span>HYPE v BAG: {toSigned(trajectory.delta, 3)}%</span>
                  <span>·</span>
                  <span>MODE: {snapshot.mode}</span>
                  <span>·</span>
                  <span>LAST: {formatTime(snapshot.lastUpdateAt)}</span>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className={`inline-flex h-6 items-center rounded-sm border px-2 py-1 text-[10px] ${safePnlClass(trajectory.delta)}`}>
                    {trajectory.delta >= 0 ? '↗ TREND' : '↘ TREND'} {toSigned(trajectory.delta, 3)}%
                  </span>
                  <span className='inline-flex h-6 items-center rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/70 dark:bg-hlpSurfaceDark/65 px-2 py-1 text-[10px] text-hlpMuted dark:text-hlpMutedDark'>
                    LIVE WINDOW {trajectory.samples}
                  </span>
                  <AsciiBadge tone={isHealthy ? 'positive' : 'error'}>
                    {isHealthy ? 'LIVE DATA' : 'DEGRADED'} {isLive ? `· ${isHealthy ? 'TRADING' : 'PAUSED'}` : '· INIT'}
                  </AsciiBadge>
                </div>
              </div>
            </>
          )}
        </article>

        <article
          className={`flex min-h-[220px] flex-col border border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel dark:bg-hlpPanelDark rounded-hlp ${panelBodyPad}`}
        >
          <div className='flex items-center justify-between gap-2'>
            <div className={sectionTitleClass}>PNL TRAJECTORY</div>
            <AsciiBadge tone='info' className='text-hlpMuted dark:text-hlpMutedDark'>
              {trajectory.samples > 0 ? `WINDOW ${trajectory.samples}` : 'WARMUP'}
            </AsciiBadge>
          </div>
          {isLoading ? (
            <div className={`mt-2 min-h-0 flex-1 rounded-sm ${skeletonPulseClass}`} />
          ) : (
            <>
              <pre className='mt-2 min-h-0 flex-1 overflow-x-auto overflow-y-auto whitespace-pre rounded-sm border border-hlpBorder dark:border-hlpBorderDark p-2 text-[11px] leading-[1.4] text-hlpMuted dark:text-hlpMutedDark'>
                {chart}
              </pre>
              <div className={sectionStripClass}>
                <span className={inlineBadgeClass}>LOW {toSigned(trajectory.min, 3)}%</span>
                <span className={inlineBadgeClass}>HIGH {toSigned(trajectory.max, 3)}%</span>
                <span className={inlineBadgeClass}>FIRST {toSigned(trajectory.first, 3)}%</span>
                <span className={inlineBadgeClass}>LAST {toSigned(trajectory.last, 3)}%</span>
                <span className={inlineBadgeClass}>RETURN {toSigned(trajectory.deltaPct, 2)}%</span>
              </div>
            </>
          )}
        </article>
      </section>

      <section className={`${monitorClass} mt-2 flex flex-col`}>
        <div className={cardHeaderClass}>
          <span className={sectionTitleClass}>OPEN POSITIONS</span>
          <AsciiBadge tone={positions.length > 0 ? 'positive' : 'neutral'}>
            {isLoading ? 'SYNCING' : `${positionCount} LIVE`}
          </AsciiBadge>
        </div>
        {isLoading ? (
          <div className='min-h-0 flex-1 space-y-2 p-2'>
            <div className={`h-5 w-40 rounded-sm ${skeletonPulseClass}`} />
            <div className={`h-5 w-2/3 rounded-sm ${skeletonPulseClass}`} />
            <div className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
            <div className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
          </div>
        ) : (
          <>
            <AsciiTable
              columns={[
                {
                  key: 'symbol',
                  header: 'SYMBOL',
                  align: 'left',
                  render: (value: unknown) => (
                    <span className='font-semibold uppercase text-hlpFg dark:text-hlpFgDark'>{String(value || '--')}</span>
                  ),
                },
                {
                  key: 'side',
                  header: 'SIDE',
                  align: 'center',
                  render: (value: unknown) => {
                    const side = typeof value === 'string' ? value.toUpperCase() : '--'
                    return <AsciiBadge tone={positionSideTone(side)}>{side}</AsciiBadge>
                  },
                },
                {
                  key: 'size',
                  header: 'SIZE',
                  align: 'right',
                  width: '15%',
                  render: (value: unknown) => {
                    const size = typeof value === 'number' ? value : Number(value)
                    return <span>{Number.isFinite(size) ? size.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '--'}</span>
                  },
                },
                {
                  key: 'notionalUsd',
                  header: 'NOTIONAL',
                  align: 'right',
                  render: (value: unknown, row) => {
                    const computed = row.notionalUsd ?? row.size
                    return <span className='whitespace-nowrap'>{formatUsd(typeof computed === 'number' ? computed : Number(computed))}</span>
                  },
                },
                {
                  key: 'pnlUsd',
                  header: 'UNREALIZED',
                  align: 'right',
                  width: '16%',
                  render: (value: unknown) => {
                    const pnl = typeof value === 'number' ? value : Number(value)
                    return <span className={safePnlClass(pnl)}>{formatUsd(Number.isFinite(pnl) ? pnl : 0)}</span>
                  },
                },
                {
                  key: 'pnlPct',
                  header: 'PNL %',
                  align: 'right',
                  render: (value: unknown) => {
                    const pnl = typeof value === 'number' ? value : Number(value)
                    return <span className={safePnlClass(pnl)}>{toSigned(pnl, 2)}%</span>
                  },
                },
                {
                  key: 'entryPrice',
                  header: 'MARK',
                  align: 'right',
                  render: (_value, row) => {
                    const normalizedRow = row as Partial<OpenPosition>
                    const entryPrice = normalizedRow.entryPrice
                    const markPrice = normalizedRow.markPrice
                    const hasEntry = Number.isFinite(entryPrice ?? Number.NaN) && Number.isFinite(markPrice ?? Number.NaN)
                    if (!hasEntry) return <span>--</span>
                    const entryText = (entryPrice as number).toFixed(2)
                    const markText = (markPrice as number).toFixed(2)
                    return (
                      <span>
                        {entryText} / {markText}
                      </span>
                    )
                  },
                },
              ]}
              data={positionRows}
              className='min-h-0 flex-1 border-0 text-[9px] sm:text-[10px]'
            />
            <div className={sectionStripClass}>
              <span className={inlineBadgeClass}>LONGS {longRows}</span>
              <span className={inlineBadgeClass}>SHORTS {shortRows}</span>
                <span className={inlineBadgeClass}>OPEN NOTIONAL {formatUsd(totalNotionalUsd)}</span>
              <span className={inlineBadgeClass}>UNREALIZED PNL {formatUsd(totalPnlUsd)}</span>
            </div>
          </>
        )}
      </section>
    </section>
  )
}
