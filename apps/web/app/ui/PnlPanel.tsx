import { useEffect, useMemo, useState } from 'react'
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
const SPARKLINE_WIDTH = 560
const SPARKLINE_HEIGHT = 240
const SPARKLINE_PAD_X = 26
const SPARKLINE_PAD_Y = 14
const SPARKLINE_X_AXIS_Y = 214

type TrajectoryPoint = { ts: string; pnlPct: number }
type AccountValuePoint = { ts: string; accountValueUsd: number }
type TimedValuePoint = { ts: string; value: number }
type Timeframe = 'all-time' | '24h' | '7d'

const TIMEFRAMES: Array<{ value: Timeframe; label: string; windowMs: number | null }> = [
  { value: 'all-time', label: 'all-time', windowMs: null },
  { value: '24h', label: '24h', windowMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7d', windowMs: 7 * 24 * 60 * 60 * 1000 },
]

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
  currentPointLabel: string
  currentPointX: number
  currentPointY: number
  timeStartLabel: string
  timeEndLabel: string
  timeRangeLabel: string
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

function formatSparklineTime(ts: string): string {
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return '--'
  const date = new Date(parsed)
  const today = new Date().toDateString()
  return date.toDateString() === today
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function describeDurationMs(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 'live'
  const totalMinutes = Math.floor(deltaMs / 60000)
  if (totalMinutes <= 0) return 'live'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const segments: string[] = []
  if (days > 0) segments.push(`${days}d`)
  if (hours > 0 || days > 0) segments.push(`${hours}h`)
  if (minutes > 0 || segments.length === 0) segments.push(`${minutes}m`)
  return segments.join(' ')
}

function parsePointTs(ts: string): number {
  const parsed = Date.parse(ts)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function hasWindowCoverage(points: TimedValuePoint[], windowMs: number | null): boolean {
  if (windowMs === null) return true
  if (points.length < 2) return false

  const times = points
    .map((point) => parsePointTs(point.ts))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b)

  if (times.length < 2) return false
  return times[times.length - 1] - times[0] >= windowMs
}

function filterPointsForTimeframe(points: TimedValuePoint[], timeframe: Timeframe): TimedValuePoint[] {
  const timeframeConfig = TIMEFRAMES.find((entry) => entry.value === timeframe)
  if (!timeframeConfig || timeframeConfig.windowMs === null || points.length < 2) return points

  const validTimes = points.map((point) => parsePointTs(point.ts)).filter((time) => Number.isFinite(time))
  if (!validTimes.length) return points

  const latestTime = validTimes.reduce((max, time) => Math.max(max, time), validTimes[0]!)
  const cutoff = latestTime - timeframeConfig.windowMs
  const filtered = points.filter((point) => {
    const time = parsePointTs(point.ts)
    return Number.isFinite(time) && time >= cutoff
  })

  return filtered.length >= 2 ? filtered : points
}

function buildSparkline(
  values: TimedValuePoint[],
  fallback: number | undefined,
  axisLabel: (value: number) => string,
  timeframe: Timeframe,
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
    first: 0,
    last: 0,
    delta: 0,
    deltaPct: 0,
    samples: numeric.length,
    path: '',
    zeroY: null,
    currentPointLabel: axisLabel(0),
    currentPointX: SPARKLINE_PAD_X,
    currentPointY: SPARKLINE_X_AXIS_Y,
    timeStartLabel: 'start',
    timeEndLabel: 'now',
    timeRangeLabel: `${timeframe === 'all-time' ? 'all-time' : timeframe} live`,
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
  const scopeLabel = timeframe === 'all-time' ? 'all-time' : timeframe
  const timeRangeLabel =
    Number.isFinite(firstTime) && Number.isFinite(lastTime) && pointCount > 1
      ? `${scopeLabel} ${describeDurationMs(lastTime - firstTime)}`
      : `${scopeLabel} live`

  const points = ordered.map((point, index) => ({ x: getX(index), y: getY(point.value), value: point.value }))
  const path = buildSquareWavePath(points)
  const first = ordered[0]?.value ?? 0
  const last = ordered[pointCount - 1]?.value ?? 0
  const delta = last - first
  const base = Math.abs(first) > 0 ? Math.abs(first) : 1
  const deltaPct = (delta / base) * 100
  const zeroY = 0 <= max && 0 >= min ? getY(0) : null
  const currentSample = points[points.length - 1]

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
    currentPointLabel: axisLabel(last),
    currentPointX: currentSample?.x ?? 0,
    currentPointY: currentSample?.y ?? 0,
    timeStartLabel,
    timeEndLabel,
    timeRangeLabel,
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
  const isRightAlignedLabel = stats.currentPointX > stats.width - 84
  const currentLabelX = isRightAlignedLabel ? stats.currentPointX - 4 : stats.currentPointX + 4
  const currentLabelAnchor = isRightAlignedLabel ? 'end' : 'start'
  const currentLabelY =
    stats.currentPointY > stats.padY + 13
      ? stats.currentPointY - 6
      : stats.currentPointY + 8

  return (
    <article className={monitorClass} aria-label={id}>
      <div className={`flex flex-wrap items-start justify-between border-b border-hlpBorder ${panelBodyPad} ${panelHeaderPad}`}>
        <div className='space-y-0.5'>
          <span className='text-[9px] uppercase tracking-[0.24em] text-hlpMuted'>{title}</span>
          <span className='text-[8px] uppercase tracking-[0.14em] text-hlpMuted/75'>{stats.timeRangeLabel}</span>
        </div>
        <div className='flex items-center gap-2'>
          <AsciiBadge tone='neutral' variant='angle' className='text-[8px] tracking-[0.16em]'>
            live
          </AsciiBadge>
          <span className='text-[7px] uppercase tracking-[0.14em] text-hlpMuted'>{`start ${stats.timeStartLabel}`}</span>
        </div>
      </div>
      <div className='px-3 pb-3 pt-2'>
        {isLoading ? (
          <div className='grid min-h-[190px] items-center gap-3 rounded-sm bg-hlpSurface/80 p-3 text-[11px] text-hlpMuted'>
            <div className='text-[11px] uppercase tracking-[0.18em]'>trajectory warming</div>
            <span className={`h-4 w-44 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
            <span className='inline-block h-32 w-full rounded-sm bg-hlpPanel/85 animate-pulse' />
          </div>
        ) : (
          <div className='relative h-[240px] w-full overflow-hidden rounded-sm border border-hlpPanel bg-hlpPanel/95'>
            <svg viewBox={`0 0 ${stats.width} ${stats.height}`} preserveAspectRatio='none' className='h-full w-full'>
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
                      className='text-[7px] fill-hlpMuted'
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
                        textAnchor={index === 0 ? 'start' : 'end'}
                        className='text-[7px] fill-hlpMuted'
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
                strokeWidth='0.7'
                strokeLinecap='square'
                strokeLinejoin='miter'
              />

              <line
                x1={stats.currentPointX}
                x2={stats.currentPointX}
                y1={stats.padY}
                y2={stats.xAxisY}
                className='stroke-hlpPanel/45'
                strokeWidth='0.2'
              />
              <circle
                cx={stats.currentPointX}
                cy={stats.currentPointY}
                r='2'
                className={colorClass}
                fill='currentColor'
                stroke='none'
              />
              <text
                x={currentLabelX}
                y={currentLabelY}
                textAnchor={currentLabelAnchor}
                dominantBaseline='middle'
                className='text-[7px] font-semibold'
                fill='currentColor'
              >
                {`now ${stats.currentPointLabel}`}
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
  trajectory = [],
  accountValueTrajectory = [],
  isLoading = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'pnl',
}: PnlPanelProps) {
  const pnlPoints = trajectory.map((point) => ({ ts: point.ts, value: point.pnlPct }))
  const [timeframe, setTimeframe] = useState<Timeframe>('all-time')
  const accountValuePoints = accountValueTrajectory.map((point) => ({ ts: point.ts, value: point.accountValueUsd }))
  const timeframeAvailability = TIMEFRAMES.map((entry) => ({
    ...entry,
    available:
      entry.windowMs === null || hasWindowCoverage(pnlPoints, entry.windowMs) || hasWindowCoverage(accountValuePoints, entry.windowMs),
  }))
  const activeTimeframe = useMemo(() => {
    const selected = timeframeAvailability.find((entry) => entry.value === timeframe)
    return selected?.available ? timeframe : 'all-time'
  }, [timeframe, timeframeAvailability])
  useEffect(() => {
    if (timeframe !== activeTimeframe) setTimeframe(activeTimeframe)
  }, [timeframe, activeTimeframe])
  const filteredPnlPoints = useMemo(() => filterPointsForTimeframe(pnlPoints, activeTimeframe), [pnlPoints, activeTimeframe])
  const filteredAccountValuePoints = useMemo(
    () => filterPointsForTimeframe(accountValuePoints, activeTimeframe),
    [accountValuePoints, activeTimeframe],
  )
  const pnlStats = useMemo(
    () => buildSparkline(filteredPnlPoints, snapshot.pnlPct, toSigned, activeTimeframe),
    [filteredPnlPoints, snapshot.pnlPct, activeTimeframe],
  )
  const accountValueStats = useMemo(
    () => buildSparkline(filteredAccountValuePoints, snapshot.accountValueUsd, toUsd, activeTimeframe),
    [filteredAccountValuePoints, snapshot.accountValueUsd, activeTimeframe],
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
            {isCollapsed ? '+' : '-'}
          </span>
          <AsciiBadge tone='inverse'>alpha stream</AsciiBadge>
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
              value={isLoading ? '--' : `${pnlStats.samples} pts`}
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
                {timeframeAvailability.map((entry) => (
                  <button
                    key={entry.value}
                    type='button'
                    disabled={!entry.available}
                    onClick={() => setTimeframe(entry.value)}
                    aria-pressed={activeTimeframe === entry.value}
                    aria-label={`Set chart timeframe to ${entry.label}`}
                    className={`inline-flex h-5 items-center gap-1 rounded-[3px] px-2 py-1 text-[8px] uppercase tracking-[0.14em] ${entry.available ? 'border border-hlpBorder' : 'border border-hlpBorder/35'} ${entry.available ? 'hover:border-hlpBorderStrong hover:text-hlpPanel' : 'cursor-not-allowed text-hlpMuted/35'} ${activeTimeframe === entry.value ? 'bg-hlpPanel/25 text-hlpPanel' : 'bg-hlpPanel/8 text-hlpMuted'} ${entry.available ? 'hover:bg-hlpPanel/15' : ''}`}
                    title={entry.available ? `View ${entry.label}` : 'Not enough history for this range'}
                  >
                    {entry.label}
                  </button>
                ))}
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
