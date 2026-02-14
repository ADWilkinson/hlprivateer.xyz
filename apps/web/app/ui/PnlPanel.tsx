import { useMemo } from 'react'
import { AsciiBadge } from './ascii-kit'
import {
  cardClass,
  cardHeaderClass,
  inverseControlClass,
  inlineBadgeClass,
  monitorClass,
  panelBodyPad,
  panelHeaderPad,
  panelRadiusSubtle,
  sectionStripClass,
  skeletonPulseClass,
} from './ascii-style'
import { type Snapshot } from './floor-dashboard'

const SMALL_PNL_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
  minimumFractionDigits: 3,
})
const ACCOUNT_VALUE_FORMAT = new Intl.NumberFormat('en-US', {
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

type SparklineMetric = {
  min: number
  max: number
  first: number
  last: number
  delta: number
  deltaPct: number
  samples: number
  path: string
  zeroY: number | null
  width: number
  height: number
}

function toSigned(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${SMALL_PNL_FORMAT.format(value)}%`
}

function toSignedUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${ACCOUNT_VALUE_FORMAT.format(value)}`
}

function toUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return ACCOUNT_VALUE_FORMAT.format(value)
}

function safePnlClass(value: number): string {
  if (value > 0) return 'text-hlpPositive'
  if (value < 0) return 'text-hlpNegative'
  return 'text-hlpMuted'
}

function buildSquareWavePath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return ''

  const segments = [`M ${points[0]!.x.toFixed(3)} ${points[0]!.y.toFixed(3)}`]

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (!previous || !current) continue

    const midX = (previous.x + current.x) / 2
    segments.push(`L ${midX.toFixed(3)} ${previous.y.toFixed(3)}`)
    segments.push(`L ${midX.toFixed(3)} ${current.y.toFixed(3)}`)
    segments.push(`L ${current.x.toFixed(3)} ${current.y.toFixed(3)}`)
  }

  return segments.join(' ')
}

function buildSparkline(values: number[], fallback: number | undefined): SparklineMetric {
  const numeric = values.filter((value) => Number.isFinite(value))
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined
  const ordered =
    numeric.length >= 2
      ? numeric
      : numeric.length === 1 && numeric[0] !== undefined
        ? [numeric[0], numeric[0]]
        : safeFallback !== undefined
          ? [safeFallback, safeFallback]
          : [0, 0]
  const pointCount = ordered.length
  const baseline = {
    min: 0,
    max: 0,
    first: 0,
    last: 0,
    delta: 0,
    deltaPct: 0,
    samples: numeric.length,
    path: '',
    zeroY: null,
    width: 100,
    height: 32,
  }

  if (numeric.length === 0 && safeFallback === undefined) {
    return baseline
  }

  const width = 100
  const height = 32
  const padX = 6
  const padY = 4
  const chartHeight = height - padY * 2
  const chartWidth = width - padX * 2
  const min = Math.min(...ordered)
  const max = Math.max(...ordered)
  const range = max - min || 1
  const getX = (index: number) => padX + (index / Math.max(1, pointCount - 1)) * chartWidth
  const getY = (value: number) => padY + (1 - (value - min) / range) * chartHeight

  const points = ordered.map((value, index) => ({ x: getX(index), y: getY(value) }))
  const path = buildSquareWavePath(points)
  const first = ordered[0] ?? 0
  const last = ordered[pointCount - 1] ?? 0
  const delta = last - first
  const base = Math.abs(first) > 0 ? Math.abs(first) : 1
  const deltaPct = (delta / base) * 100
  const zeroY = 0 <= max && 0 >= min ? getY(0) : null

  return {
    min,
    max,
    first,
    last,
    delta,
    deltaPct,
    samples: numeric.length,
    path,
    zeroY,
    width,
    height,
  }
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
  const pnlValues = trajectory.map((point) => point.pnlPct)
  const pnlStats = useMemo(() => buildSparkline(pnlValues, snapshot.pnlPct), [pnlValues, snapshot.pnlPct])
  const accountValueValues = accountValueTrajectory.map((point) => point.accountValueUsd)
  const accountValueStats = useMemo(
    () => buildSparkline(accountValueValues, snapshot.accountValueUsd),
    [accountValueValues, snapshot.accountValueUsd],
  )

  const SparklineCard = ({
    id,
    title,
    colorClass,
    fallbackValue,
    metricSuffix,
    renderLabelValue,
    stats,
  }: {
    id: string
    title: string
    colorClass: string
    fallbackValue: number | undefined
    metricSuffix: (value: number | undefined) => string
    renderLabelValue: (value: number | undefined) => string
    stats: SparklineMetric
  }) => (
    <article className={monitorClass} aria-label={id}>
      <div className={`flex items-center justify-between border-b border-hlpBorder ${panelBodyPad} ${panelHeaderPad}`}>
        <span className='text-[9px] uppercase tracking-[0.24em] text-hlpMuted'>{title}</span>
        <AsciiBadge tone='neutral' variant='angle' className='text-[8px] tracking-[0.16em]'>
          live sparkline
        </AsciiBadge>
      </div>
      <div className='px-3 pb-3 pt-2'>
        {isLoading ? (
          <div className='grid min-h-[190px] items-center gap-3 rounded-sm bg-hlpSurface/80 p-3 text-[11px] text-hlpMuted'>
            <div className='text-[11px] uppercase tracking-[0.18em]'>trajectory warming</div>
            <span className={`h-4 w-44 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
            <span className='inline-block h-32 w-full rounded-sm bg-hlpPanel/85 animate-pulse' />
          </div>
        ) : (
          <div className='relative h-[220px] w-full overflow-hidden rounded-sm border border-hlpBorder/55 bg-hlpPanel/95'>
            <svg
              viewBox={`0 0 ${stats.width} ${stats.height}`}
              preserveAspectRatio='none'
              className='h-full w-full'
            >
              {Array.from({ length: 5 }).map((_, index) => {
                const ratio = index / 4
                const y = ratio * 100
                return (
                  <line
                    key={`h-grid-${id}-${index}`}
                    x1='0'
                    x2={String(stats.width)}
                    y1={y}
                    y2={y}
                    className='stroke-hlpBorder/35'
                    strokeWidth='0.2'
                  />
                )
              })}

              {Array.from({ length: 8 }).map((_, index) => {
                const x = (index / 7) * 100
                return (
                  <line
                    key={`v-grid-${id}-${index}`}
                    x1={x}
                    x2={x}
                    y1='0'
                    y2={String(stats.height)}
                    className='stroke-hlpBorder/28'
                    strokeWidth='0.2'
                  />
                )
              })}

              {stats.zeroY !== null ? (
                <line
                  x1='0'
                  x2={String(stats.width)}
                  y1={stats.zeroY}
                  y2={stats.zeroY}
                  className='stroke-hlpWarning/40'
                  strokeWidth='0.15'
                  strokeDasharray='2 1'
                />
              ) : null}

              <path
                d={stats.path}
                fill='none'
                className={colorClass}
                strokeWidth='0.7'
                strokeLinecap='square'
                strokeLinejoin='miter'
              />
            </svg>
          </div>
        )}
      </div>
      <div className={sectionStripClass}>
        <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>range</span>
        <span className={inlineBadgeClass}>min={metricSuffix(stats.min)}</span>
        <span className={inlineBadgeClass}>max={metricSuffix(stats.max)}</span>
        <span className={inlineBadgeClass}>first={metricSuffix(stats.first)}</span>
        <span className={inlineBadgeClass}>last={metricSuffix(stats.last)}</span>
        <span className={inlineBadgeClass}>samples={stats.samples}</span>
        <span className={inlineBadgeClass}>latest={renderLabelValue(fallbackValue)}</span>
      </div>
    </article>
  )

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={`${cardHeaderClass} w-full cursor-pointer appearance-none bg-hlpSurface text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hlpBorder`}
        aria-label='Toggle pnl trajectory panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className='uppercase tracking-[0.24em]'>PNL TRAJECTORY</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>
            {isCollapsed ? '+' : '−'}
          </span>
          <AsciiBadge tone='inverse'>
            alpha stream
          </AsciiBadge>
        </div>
      </button>

      {!isCollapsed && <div className={`${panelBodyPad} grid gap-2`}>
        <article className={`${monitorClass} overflow-hidden`}>
          <div className={`flex min-h-[88px] flex-col gap-2 ${panelBodyPad}`}>
            <div className='flex flex-wrap items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='mb-1 text-[9px] uppercase tracking-[0.18em] text-hlpMuted'>MARKET PNL</div>
                <div className={`text-2xl font-bold tracking-[0.14em] ${safePnlClass(snapshot.pnlPct)}`}>
                  {toSigned(snapshot.pnlPct)}
                </div>
              </div>
              <div className='min-w-0'>
                <div className='mb-1 text-[9px] uppercase tracking-[0.18em] text-hlpMuted'>ACCOUNT VALUE</div>
                <div className={`text-2xl font-bold tracking-[0.14em] ${snapshot.accountValueUsd === undefined ? 'text-hlpMuted' : 'text-hlpHealthy'}`}>
                  {isLoading
                    ? <span className={`inline-block h-7 w-40 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
                    : toUsd(snapshot.accountValueUsd)}
                </div>
              </div>
              <div className='flex flex-wrap gap-1'>
                {isLoading ? (
                  <>
                    <span className={`h-5 w-28 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
                    <span className={`h-5 w-36 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
                    <span className={`h-5 w-28 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
                  </>
                ) : (
                  <>
                    <span className={`${inlineBadgeClass} ${safePnlClass(pnlStats.delta)}`}>delta {toSigned(pnlStats.delta)}</span>
                    <span className={inlineBadgeClass}>delta%={toSigned(pnlStats.deltaPct)}</span>
                    <span className={inlineBadgeClass}>samples={pnlStats.samples}</span>
                  </>
                )}
              </div>
            </div>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
              <div className='rounded-sm border border-hlpBorder bg-hlpInverseBg px-2 py-1'>
                <div className='text-[8px] uppercase tracking-[0.2em] text-hlpPanel/85'>MODE</div>
                <div className='text-[11px] font-semibold text-hlpPanel'>{isLoading ? 'WARMUP' : snapshot.mode}</div>
              </div>
              <div className='rounded-sm border border-hlpBorder bg-hlpInverseBg px-2 py-1'>
                <div className='text-[8px] uppercase tracking-[0.2em] text-hlpPanel/85'>Pnl current</div>
                <div className='text-[11px] font-semibold text-hlpPanel'>{isLoading ? '--' : toSigned(snapshot.pnlPct)}</div>
              </div>
              <div className='rounded-sm border border-hlpBorder bg-hlpInverseBg px-2 py-1'>
                <div className='text-[8px] uppercase tracking-[0.2em] text-hlpPanel/85'>VALUE now</div>
                <div className='text-[11px] font-semibold text-hlpPanel'>{isLoading ? '--' : toUsd(snapshot.accountValueUsd)}</div>
              </div>
            </div>
          </div>
        </article>

        <div className='grid gap-2 xl:grid-cols-2'>
          <SparklineCard
            id='market-pnl'
            title='MARKET PNL OVER TIME'
            colorClass='text-hlpHealthy'
            fallbackValue={snapshot.pnlPct}
            metricSuffix={(value) => toSigned(value ?? 0)}
            renderLabelValue={(value) => toSigned(value ?? 0)}
            stats={pnlStats}
          />
          <SparklineCard
            id='account-value'
            title='ACCOUNT VALUE OVER TIME'
            colorClass='text-hlpNeutral'
            fallbackValue={snapshot.accountValueUsd}
            metricSuffix={toSignedUsd}
            renderLabelValue={(value) => toSignedUsd(value)}
            stats={accountValueStats}
          />
        </div>
      </div>}
    </section>
  )
}
