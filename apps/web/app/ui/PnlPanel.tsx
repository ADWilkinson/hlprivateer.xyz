import { useMemo } from 'react'
import { AsciiBadge } from './ascii-kit'
import {
  cardClass,
  cardHeaderClass,
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

type TrajectoryPoint = { ts: string; pnlPct: number }

type PnlPanelProps = {
  snapshot: Snapshot
  trajectory?: TrajectoryPoint[]
  isLoading?: boolean
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
  areaPath: string
  zeroY: number | null
  width: number
  height: number
}

function toSigned(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${SMALL_PNL_FORMAT.format(value)}%`
}

function safePnlClass(value: number): string {
  if (value > 0) return 'text-hlpPositive dark:text-hlpPositiveDark'
  if (value < 0) return 'text-hlpNegative dark:text-hlpNegativeDark'
  return 'text-hlpMuted dark:text-hlpMutedDark'
}

function buildSquareWavePath(points: Array<{ x: number; y: number }>): { path: string; areaPath: string; minY: number } {
  if (points.length < 2) {
    return { path: '', areaPath: '', minY: 0 }
  }

  const baselineY = points.reduce((maxY, point) => Math.max(maxY, point.y), points[0]!.y)
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

  const path = segments.join(' ')
  const areaPath = `${path} L ${points.at(-1)?.x.toFixed(3)} ${baselineY.toFixed(3)} L ${points[0]?.x.toFixed(3)} ${baselineY.toFixed(3)} Z`

  return { path, areaPath, minY: baselineY }
}

function buildSparkline(values: number[]): SparklineMetric {
  const numeric = values.filter((value) => Number.isFinite(value))
  const fallback = {
    min: 0,
    max: 0,
    first: 0,
    last: 0,
    delta: 0,
    deltaPct: 0,
    samples: numeric.length,
    path: '',
    areaPath: '',
    zeroY: null,
    width: 100,
    height: 32,
  }

  if (numeric.length < 1) return fallback

  const chartValues = numeric.length === 1 ? [numeric[0], numeric[0]] : numeric
  const pointCount = chartValues.length

  const width = 100
  const height = 32
  const padX = 6
  const padY = 4
  const chartHeight = height - padY * 2
  const chartWidth = width - padX * 2
  const min = Math.min(...chartValues)
  const max = Math.max(...chartValues)
  const range = max - min || 1
  const getX = (index: number) => padX + (index / Math.max(1, pointCount - 1)) * chartWidth
  const getY = (value: number) => padY + (1 - (value - min) / range) * chartHeight

  const points = chartValues.map((value, index) => ({ x: getX(index), y: getY(value) }))
  const squareWave = buildSquareWavePath(points)
  const areaPath = squareWave.path
    ? `${squareWave.path} L ${points.at(-1)?.x.toFixed(3)} ${squareWave.minY.toFixed(3)} L ${points[0]?.x.toFixed(3)} ${squareWave.minY.toFixed(3)} Z`
    : ''

  const first = numeric[0] ?? 0
  const last = numeric[numeric.length - 1] ?? 0
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
    path: squareWave.path,
    areaPath,
    zeroY,
    width,
    height,
  }
}

export function PnlPanel({ snapshot, trajectory = [], isLoading = false }: PnlPanelProps) {
  const pnlStats = useMemo(() => buildSparkline(trajectory.map((point) => point.pnlPct)), [trajectory])

  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span className='uppercase tracking-[0.24em]'>PNL TRAJECTORY</span>
        <AsciiBadge tone='positive' className='text-hlpPositive dark:text-hlpPositiveDark'>
          alpha stream
        </AsciiBadge>
      </div>

      <div className={`${panelBodyPad} grid gap-2`}>
        <article className={`${monitorClass} overflow-hidden`}>
          <div className={`flex min-h-[88px] flex-col gap-2 ${panelBodyPad}`}>
            <div className='flex flex-wrap items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='mb-1 text-[9px] uppercase tracking-[0.18em] text-hlpMuted dark:text-hlpMutedDark'>MARKET PNL</div>
                <div className={`text-2xl font-bold tracking-[0.14em] ${safePnlClass(snapshot.pnlPct)}`}>{toSigned(snapshot.pnlPct)}</div>
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
                    <span className={inlineBadgeClass}>samples={pnlStats.samples}</span>
                    <span className={inlineBadgeClass}>delta%={toSigned(pnlStats.deltaPct)}</span>
                  </>
                )}
              </div>
            </div>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
              <div className='rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/65 dark:bg-hlpSurfaceDark/60 px-2 py-1'>
                <div className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>MODE</div>
                <div className='text-[11px] font-semibold'>{isLoading ? 'WARMUP' : snapshot.mode}</div>
              </div>
            </div>
          </div>
        </article>

        <article className={monitorClass}>
          <div
            className={`flex items-center justify-between border-b border-hlpBorder dark:border-hlpBorderDark ${panelBodyPad} ${panelHeaderPad}`}
          >
            <span className='text-[9px] uppercase tracking-[0.24em] text-hlpMuted dark:text-hlpMutedDark'>TRAJECTORY</span>
            <AsciiBadge tone='neutral' variant='angle' className='text-[8px] tracking-[0.16em]'>
              live sparkline
            </AsciiBadge>
          </div>
          <div className='px-3 pb-3 pt-2'>
            {isLoading || pnlStats.samples < 1 ? (
              <div className='grid min-h-[190px] items-center gap-3 rounded-sm border border-hlpBorder/70 dark:border-hlpBorderDark/70 bg-hlpSurface/80 dark:bg-hlpSurfaceDark/75 p-3 text-[11px] text-hlpMuted dark:text-hlpMutedDark'>
                <div className='text-[11px] uppercase tracking-[0.18em]'>trajectory warming</div>
                <span className={`h-4 w-44 ${skeletonPulseClass} ${panelRadiusSubtle}`} />
                <span className='inline-block h-32 w-full rounded-sm bg-hlpSurface/85 dark:bg-hlpSurfaceDark/80 animate-pulse' />
              </div>
            ) : (
              <div className='relative h-[220px] w-full overflow-hidden rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpPanel/90 dark:bg-hlpPanelDark/70'>
                <svg
                  viewBox={`0 0 ${pnlStats.width} ${pnlStats.height}`}
                  preserveAspectRatio='none'
                  className='h-full w-full'
                >
                  <defs>
                    <linearGradient id='pnl-spark-gradient' x1='0' y1='0' x2='0' y2='1'>
                      <stop offset='0%' stopColor='rgb(75,154,135)' stopOpacity='0.35' />
                      <stop offset='100%' stopColor='rgb(75,154,135)' stopOpacity='0.03' />
                    </linearGradient>
                  </defs>

                  {Array.from({ length: 5 }).map((_, index) => {
                    const ratio = index / 4
                    const top = ratio * 100
                    return (
                      <line
                        key={`grid-${index}`}
                        x1='0'
                        x2={String(pnlStats.width)}
                        y1={top}
                        y2={top}
                        className='stroke-hlpBorder/40 dark:stroke-hlpBorderDark/50'
                        strokeWidth='0.2'
                      />
                    )
                  })}

                  {Array.from({ length: 8 }).map((_, index) => {
                    const x = (index / 7) * 100
                    return (
                      <line
                        key={`v-grid-${index}`}
                        x1={x}
                        x2={x}
                        y1='0'
                        y2={String(pnlStats.height)}
                        className='stroke-hlpBorder/30 dark:stroke-hlpBorderDark/35'
                        strokeWidth='0.2'
                      />
                    )
                  })}

                  {pnlStats.zeroY !== null ? (
                    <line
                      x1='0'
                      x2={String(pnlStats.width)}
                      y1={pnlStats.zeroY}
                      y2={pnlStats.zeroY}
                      className='stroke-hlpWarning/45 dark:stroke-hlpWarningDark/45'
                      strokeWidth='0.15'
                      strokeDasharray='2 1'
                    />
                  ) : null}

                  <path d={pnlStats.areaPath} fill='url(#pnl-spark-gradient)' stroke='none' />
                  <path
                    d={pnlStats.path}
                    fill='none'
                    className='stroke-hlpPositive dark:stroke-hlpPositiveDark'
                    strokeWidth='0.7'
                    strokeLinecap='square'
                    strokeLinejoin='miter'
                  />
                </svg>
              </div>
            )}
          </div>
          <div className={sectionStripClass}>
            <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>range</span>
            <span className={inlineBadgeClass}>min={toSigned(pnlStats.min)}</span>
            <span className={inlineBadgeClass}>max={toSigned(pnlStats.max)}</span>
            <span className={inlineBadgeClass}>first={toSigned(pnlStats.first)}</span>
            <span className={inlineBadgeClass}>last={toSigned(pnlStats.last)}</span>
          </div>
        </article>

      </div>
    </section>
  )
}
