import { useMemo } from 'react'
import { AsciiBadge } from './ascii-kit'
import {
  cardClass,
  collapsibleHeaderClass,
  heroCardClass,
  inverseControlClass,
  inlineBadgeClass,
  monitorClass,
  panelBodyPad,
  panelHeaderPad,
  panelRadiusSubtle,
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
  padX: number
  padY: number
  chartWidth: number
  chartHeight: number
  xAxisY: number
}

function toSigned(value: number): string {
  if (!Number.isFinite(value)) return '\u2014'
  const sign = value > 0 ? '+' : ''
  return `${sign}${SMALL_PNL_FORMAT.format(value)}%`
}

function toUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '\u2014'
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
    width: 420,
    height: 220,
    padX: 0,
    padY: 0,
    chartWidth: 0,
    chartHeight: 0,
    xAxisY: 0,
  }

  if (numeric.length === 0 && safeFallback === undefined) {
    return baseline
  }

  const width = 420
  const height = 220
  const padX = 18
  const padY = 12
  const xAxisY = 200
  const chartHeight = xAxisY - padY
  const chartWidth = width - padX * 2
  let min = Math.min(...ordered)
  let max = Math.max(...ordered)
  if (min === max) {
    const buffer = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1
    min -= buffer
    max += buffer
  }
  const range = max - min
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
    padX,
    padY,
    chartWidth,
    chartHeight,
    xAxisY,
  }
}

function HeroStat({
  label,
  value,
  colorClass,
  isLoading,
}: {
  label: string
  value: string
  colorClass: string
  isLoading: boolean
}) {
  return (
    <div className={heroCardClass}>
      <div className='text-[8px] uppercase tracking-[0.2em] text-hlpPanel/50 mb-1.5'>{label}</div>
      {isLoading ? (
        <span className={`inline-block h-7 w-24 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
      ) : (
        <div className={`text-[20px] sm:text-[24px] md:text-[28px] font-bold tracking-[0.06em] leading-none ${colorClass}`}>
          {value}
        </div>
      )}
    </div>
  )
}

function SparklineCard({
  id,
  title,
  colorClass,
  axisLabel,
  stats,
  isLoading,
}: {
  id: string
  title: string
  colorClass: string
  axisLabel: (value: number) => string
  stats: SparklineMetric
  isLoading: boolean
}) {
  return (
    <article className={monitorClass} aria-label={id}>
      <div className={`flex items-center justify-between border-b border-hlpBorder ${panelBodyPad} ${panelHeaderPad}`}>
        <span className='text-[9px] uppercase tracking-[0.24em] text-hlpMuted'>{title}</span>
        <AsciiBadge tone='neutral' variant='angle' className='text-[8px] tracking-[0.16em]'>
          live
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
              <line
                x1={stats.padX}
                x2={stats.padX}
                y1={stats.padY}
                y2={stats.xAxisY}
                className='stroke-hlpPanel/70'
                strokeWidth='0.28'
              />
              <line
                x1={stats.padX}
                x2={stats.width - stats.padX}
                y1={stats.xAxisY}
                y2={stats.xAxisY}
                className='stroke-hlpPanel/70'
                strokeWidth='0.28'
              />

              {Array.from({ length: 5 }).map((_, index) => {
                const ratio = index / 4
                const y = stats.padY + ratio * stats.chartHeight
                const value = stats.max - ratio * (stats.max - stats.min)
                return (
                  <g key={`y-axis-${id}-${index}`}>
                    <line
                      x1={stats.padX}
                      x2={stats.width - stats.padX}
                      y1={y}
                      y2={y}
                      className='stroke-hlpBorder/28'
                      strokeWidth='0.18'
                    />
                    <text
                      x={stats.padX - 1}
                      y={y + 0.2}
                      textAnchor='end'
                      dominantBaseline='middle'
                      className='text-[4px] fill-hlpMuted'
                    >
                      {axisLabel(value)}
                    </text>
                  </g>
                )
              })}

              {Array.from({ length: 6 }).map((_, index) => {
                const ratio = index / 5
                const x = stats.padX + ratio * stats.chartWidth
                const isEdge = index === 0 || index === 5
                const label = isEdge ? (index === 0 ? 'start' : 'now') : ''
                return (
                  <g key={`x-grid-${id}-${index}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={stats.padY}
                      y2={stats.xAxisY}
                      className='stroke-hlpBorder/28'
                      strokeWidth='0.16'
                    />
                    <line
                      x1={x}
                      x2={x}
                      y1={stats.xAxisY}
                      y2={stats.xAxisY + 1.4}
                      className='stroke-hlpBorder'
                      strokeWidth='0.22'
                    />
                    {label ? (
                      <text
                        x={x}
                        y={stats.xAxisY + 4}
                        textAnchor='middle'
                        className='text-[4px] fill-hlpMuted'
                      >
                        {label}
                      </text>
                    ) : null}
                  </g>
                )
              })}

              {stats.zeroY !== null ? (
                <line
                  x1={stats.padX}
                  x2={stats.width - stats.padX}
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
                stroke='currentColor'
                className={colorClass}
                strokeWidth='0.6'
                strokeLinecap='square'
                strokeLinejoin='miter'
              />
            </svg>
          </div>
        )}
      </div>
    </article>
  )
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
          <span className={inverseControlClass}>
            {isCollapsed ? '+' : '\u2212'}
          </span>
          <AsciiBadge tone='inverse'>
            alpha stream
          </AsciiBadge>
        </div>
      </button>

      {!isCollapsed && (
        <div className={`${panelBodyPad} grid gap-3`}>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-2'>
            <HeroStat
              label='MARKET PNL'
              value={toSigned(snapshot.pnlPct)}
              colorClass={`text-hlpPanel ${safePnlClass(snapshot.pnlPct).replace('text-hlpMuted', 'text-hlpPanel/60')}`}
              isLoading={isLoading}
            />
            <HeroStat
              label='ACCOUNT VALUE'
              value={toUsd(snapshot.accountValueUsd)}
              colorClass={snapshot.accountValueUsd === undefined ? 'text-hlpPanel/60' : 'text-hlpPanel'}
              isLoading={isLoading}
            />
            <HeroStat
              label='MODE'
              value={isLoading ? 'WARMUP' : snapshot.mode}
              colorClass='text-hlpPanel'
              isLoading={false}
            />
            <HeroStat
              label='TRAJECTORY'
              value={isLoading ? '\u2014' : `${pnlStats.samples} pts`}
              colorClass='text-hlpPanel/70'
              isLoading={false}
            />
          </div>

          <div className='flex flex-wrap gap-1'>
            {isLoading ? (
              <>
                <span className={`h-5 w-28 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
                <span className={`h-5 w-36 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
              </>
            ) : (
              <>
                <span className={`${inlineBadgeClass} ${safePnlClass(pnlStats.delta)}`}>delta {toSigned(pnlStats.delta)}</span>
                <span className={inlineBadgeClass}>delta%={toSigned(pnlStats.deltaPct)}</span>
                <span className={inlineBadgeClass}>samples={pnlStats.samples}</span>
              </>
            )}
          </div>

          <div className='grid gap-2 xl:grid-cols-2'>
            <SparklineCard
              id='market-pnl'
              title='MARKET PNL OVER TIME'
              colorClass='text-hlpHealthy'
              axisLabel={toSigned}
              stats={pnlStats}
              isLoading={isLoading}
            />
            <SparklineCard
              id='account-value'
              title='ACCOUNT VALUE OVER TIME'
              colorClass='text-hlpNeutral'
              axisLabel={toUsd}
              stats={accountValueStats}
              isLoading={isLoading}
            />
          </div>
        </div>
      )}
    </section>
  )
}
