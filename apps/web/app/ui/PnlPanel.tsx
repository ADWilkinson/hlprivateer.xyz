import { useMemo } from 'react'
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
const SPARKLINE_WIDTH = 720
const SPARKLINE_HEIGHT = 300
const SPARKLINE_PAD_X = 12
const SPARKLINE_PAD_Y = 10
const SPARKLINE_X_AXIS_Y = 274

type TrajectoryPoint = { ts: string; pnlPct: number }
type AccountValuePoint = { ts: string; accountValueUsd: number }
type TimedValuePoint = { ts: string; value: number }

const EMPTY_PNL: TrajectoryPoint[] = []
const EMPTY_ACCOUNT: AccountValuePoint[] = []

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
  path: string
  fillPath: string
  zeroY: number | null
  currentPointLabel: string
  currentPointX: number
  currentPointY: number
  timeStartLabel: string
  timeEndLabel: string
  width: number
  height: number
  padX: number
  padY: number
  chartWidth: number
  chartHeight: number
  xAxisY: number
}

function toSigned(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${SMALL_PNL_FORMAT.format(value)}%`
}

function toUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return ACCOUNT_VALUE_FORMAT.format(value)
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

function formatSparklineTime(ts: string): string {
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return '--'
  const date = new Date(parsed)
  const today = new Date().toDateString()
  return date.toDateString() === today
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function buildSparkline(
  values: TimedValuePoint[],
  fallback: number | undefined,
  axisLabel: (value: number) => string,
): SparklineMetric {
  const numeric = values.filter((value) => Number.isFinite(value.value))
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined

  const ordered =
    numeric.length >= 2
      ? numeric
      : numeric.length === 1 && numeric[0] !== undefined
        ? [numeric[0], { ...numeric[0], ts: new Date().toISOString() }]
        : safeFallback !== undefined
          ? [
              { ts: new Date().toISOString(), value: safeFallback },
              { ts: new Date().toISOString(), value: safeFallback },
            ]
          : []

  const pointCount = ordered.length
  const baseline = {
    min: 0,
    max: 0,
    path: '',
    fillPath: '',
    zeroY: null,
    currentPointLabel: axisLabel(0),
    currentPointX: SPARKLINE_PAD_X,
    currentPointY: SPARKLINE_X_AXIS_Y,
    timeStartLabel: 'start',
    timeEndLabel: 'now',
    width: SPARKLINE_WIDTH,
    height: SPARKLINE_HEIGHT,
    padX: SPARKLINE_PAD_X,
    padY: SPARKLINE_PAD_Y,
    chartWidth: SPARKLINE_WIDTH - SPARKLINE_PAD_X * 2,
    chartHeight: SPARKLINE_X_AXIS_Y - SPARKLINE_PAD_Y,
    xAxisY: SPARKLINE_X_AXIS_Y,
  }

  if (numeric.length === 0 && safeFallback === undefined) {
    return baseline
  }

  const width = SPARKLINE_WIDTH
  const height = SPARKLINE_HEIGHT
  const padX = SPARKLINE_PAD_X
  const padY = SPARKLINE_PAD_Y
  const xAxisY = SPARKLINE_X_AXIS_Y
  const chartHeight = xAxisY - padY
  const chartWidth = width - padX * 2
  let min = Math.min(...ordered.map((point) => point.value))
  let max = Math.max(...ordered.map((point) => point.value))
  if (min === max) {
    const buffer = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1
    min -= buffer
    max += buffer
  }
  const range = max - min
  const getX = (index: number) => padX + (index / Math.max(1, pointCount - 1)) * chartWidth
  const getY = (value: number) => padY + (1 - (value - min) / range) * chartHeight

  const firstSample = ordered[0]
  const lastSample = ordered[pointCount - 1]
  const firstTime = firstSample ? Date.parse(firstSample.ts) : NaN
  const lastTime = lastSample ? Date.parse(lastSample.ts) : NaN
  const timeStartLabel = Number.isFinite(firstTime) && firstSample ? formatSparklineTime(firstSample.ts) : 'start'
  const timeEndLabel = Number.isFinite(lastTime) && lastSample ? formatSparklineTime(lastSample.ts) : 'now'

  const points = ordered.map((point, index) => ({ x: getX(index), y: getY(point.value), value: point.value }))
  const path = buildSquareWavePath(points)
  const last = ordered[pointCount - 1]?.value ?? 0
  const zeroY = 0 <= max && 0 >= min ? getY(0) : null
  const currentSample = points[points.length - 1]
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const fillPath =
    path && firstPoint && lastPoint
      ? `${path} L ${lastPoint.x.toFixed(3)} ${xAxisY.toFixed(3)} L ${firstPoint.x.toFixed(3)} ${xAxisY.toFixed(3)} Z`
      : ''

  return {
    min,
    max,
    path,
    fillPath,
    zeroY,
    currentPointLabel: axisLabel(last),
    currentPointX: currentSample?.x ?? 0,
    currentPointY: currentSample?.y ?? 0,
    timeStartLabel,
    timeEndLabel,
    width,
    height,
    padX,
    padY,
    chartWidth,
    chartHeight,
    xAxisY,
  }
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
  const currentLabel = `now ${stats.currentPointLabel}`
  const currentLabelWidth = Math.max(92, Math.round(currentLabel.length * 7.2))
  const isRightAlignedLabel = stats.currentPointX > stats.width - (currentLabelWidth + 24)
  const currentLabelBoxX =
    isRightAlignedLabel
      ? Math.max(stats.padX, stats.currentPointX - currentLabelWidth - 8)
      : Math.min(stats.width - stats.padX - currentLabelWidth, stats.currentPointX + 8)
  const currentLabelSafeY =
    stats.currentPointY > stats.padY + 24
      ? stats.currentPointY - 10
      : stats.currentPointY + 10
  const currentLabelY = Math.max(stats.padY + 13, Math.min(currentLabelSafeY, stats.xAxisY - 13))

  return (
    <article className={monitorClass} aria-label={id}>
      <div className={`flex flex-wrap items-start border-b border-hlpBorder ${panelBodyPad} ${panelHeaderPad}`}>
        <div className='space-y-0.5'>
          <span className='text-[10px] sm:text-[9px] uppercase tracking-[0.24em] text-hlpMuted'>{title}</span>
        </div>
      </div>
      <div className='px-3 pb-3 pt-2'>
        {isLoading ? (
          <div className='grid min-h-[204px] items-center gap-3 bg-hlpSurface/80 p-3 text-[11px] text-hlpMuted'>
            <div className='text-[11px] uppercase tracking-[0.18em]'>trajectory warming</div>
            <span className={`h-4 w-44 ${skeletonPulseClass}`} />
            <span className='inline-block h-32 w-full bg-hlpSurface animate-pulse' />
          </div>
        ) : (
          <div className='relative h-[262px] w-full overflow-hidden border border-hlpBorder bg-hlpBg'>
            <svg viewBox={`0 0 ${stats.width} ${stats.height}`} preserveAspectRatio='none' className='h-full w-full'>
              <line
                x1={stats.padX}
                x2={stats.padX}
                y1={stats.padY}
                y2={stats.xAxisY}
                className='stroke-hlpBorder'
                strokeWidth='0.32'
              />
              <line
                x1={stats.padX}
                x2={stats.width - stats.padX}
                y1={stats.xAxisY}
                y2={stats.xAxisY}
                className='stroke-hlpBorder'
                strokeWidth='0.32'
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
                      className='stroke-hlpBorder/32'
                      strokeWidth='0.25'
                    />
                    <text
                      x={stats.padX + 3}
                      y={y}
                      textAnchor='start'
                      dominantBaseline='middle'
                      className='text-[10px] sm:text-[9px] fill-hlpMuted/80'
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
                const label = isEdge ? (index === 0 ? stats.timeStartLabel : stats.timeEndLabel) : ''
                return (
                  <g key={`x-grid-${id}-${index}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={stats.padY}
                      y2={stats.xAxisY}
                      className='stroke-hlpBorder/28'
                      strokeWidth='0.2'
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
                        textAnchor={index === 0 ? 'start' : 'end'}
                        className='text-[10px] sm:text-[9px] fill-hlpMuted'
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

              {stats.fillPath ? (
                <path
                  d={stats.fillPath}
                  fill='currentColor'
                  stroke='none'
                  className={`${colorClass} opacity-[0.07]`}
                />
              ) : null}

              <path
                d={stats.path}
                fill='none'
                stroke='currentColor'
                className={`${colorClass} sparkline-draw-in`}
                strokeWidth='0.8'
                strokeLinecap='square'
                strokeLinejoin='miter'
              />

              <line
                x1={stats.currentPointX}
                x2={stats.currentPointX}
                y1={stats.padY}
                y2={stats.xAxisY}
                className='stroke-hlpDim'
                strokeWidth='0.22'
              />
              <circle
                cx={stats.currentPointX}
                cy={stats.currentPointY}
                r='2.3'
                className={colorClass}
                fill='currentColor'
                stroke='none'
              />
              <rect
                x={currentLabelBoxX}
                y={currentLabelY - 7}
                width={currentLabelWidth}
                height='14'
                rx='0'
                fill='rgba(255, 255, 255, 0.95)'
                stroke='rgba(0, 0, 0, 0.12)'
                strokeWidth='0.35'
              />
              <text
                x={isRightAlignedLabel ? currentLabelBoxX + 6 : currentLabelBoxX + 6}
                y={currentLabelY}
                textAnchor='start'
                dominantBaseline='middle'
                className='text-[11px] sm:text-[10px] font-semibold'
                fill='currentColor'
              >
                {currentLabel}
              </text>
            </svg>
          </div>
        )}
      </div>
    </article>
  )
}

export function PnlPanel({
  snapshot,
  trajectory = EMPTY_PNL,
  accountValueTrajectory = EMPTY_ACCOUNT,
  isLoading = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'pnl',
}: PnlPanelProps) {
  const pnlPoints = trajectory.map((point) => ({ ts: point.ts, value: point.pnlPct }))
  const accountValuePoints = accountValueTrajectory.map((point) => ({ ts: point.ts, value: point.accountValueUsd }))
  const pnlStats = useMemo(
    () => buildSparkline(pnlPoints, snapshot.pnlPct, toSigned),
    [pnlPoints, snapshot.pnlPct],
  )
  const accountValueStats = useMemo(
    () => buildSparkline(accountValuePoints, snapshot.accountValueUsd, toUsd),
    [accountValuePoints, snapshot.accountValueUsd],
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
          <AsciiBadge tone='inverse'>performance stream</AsciiBadge>
        </div>
      </button>

      <div id={`section-${sectionId}`} hidden={isCollapsed}>
        {!isCollapsed && (
          <div className={`${panelBodyPad} grid gap-3`}>
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
      </div>
    </section>
  )
}
