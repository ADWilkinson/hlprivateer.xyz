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
import { type OpenPosition, type Snapshot } from './floor-dashboard'

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: 'currency',
  currency: 'USD',
})

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

function toSignedUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${currencyFormatter.format(value)}`
}

function toSafe(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—'
  return numberFormatter.format(value ?? 0)
}

function safePnlClass(value: number): string {
  if (value > 0) return 'text-hlpPositive dark:text-hlpPositiveDark'
  if (value < 0) return 'text-hlpNegative dark:text-hlpNegativeDark'
  return 'text-hlpMuted dark:text-hlpMutedDark'
}

function toSideClass(side?: string): string {
  if (!side) return 'text-hlpMuted dark:text-hlpMutedDark'
  const canonical = side.toUpperCase()
  if (canonical === 'LONG') return 'text-hlpPositive dark:text-hlpPositiveDark'
  if (canonical === 'SHORT') return 'text-hlpNegative dark:text-hlpNegativeDark'
  return 'text-hlpMuted dark:text-hlpMutedDark'
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

  if (numeric.length < 2) return fallback

  const width = 100
  const height = 32
  const padX = 6
  const padY = 4
  const chartHeight = height - padY * 2
  const chartWidth = width - padX * 2
  const min = Math.min(...numeric)
  const max = Math.max(...numeric)
  const range = max - min || 1
  const minY = padY + chartHeight
  const getX = (index: number) => padX + (index / (numeric.length - 1)) * chartWidth
  const getY = (value: number) => padY + (1 - (value - min) / range) * chartHeight

  const points = numeric.map((value, index) => ({ x: getX(index), y: getY(value) }))
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`)
    .join(' ')
  const areaPath = `${linePath} L ${points.at(-1)?.x.toFixed(3)} ${minY.toFixed(3)} L ${points[0]?.x.toFixed(3)} ${minY.toFixed(3)} Z`

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
    path: linePath,
    areaPath,
    zeroY,
    width,
    height,
  }
}

function normalizePositions(raw: OpenPosition[] | undefined): OpenPosition[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((position) => position && position.symbol).slice(0, 500)
}

function positionSummary(position: OpenPosition) {
  const { symbol, size, side, entryPrice, markPrice, pnlUsd, pnlPct, notionalUsd } = position
  return {
    symbol,
    size: Number.isFinite(size as number) ? numberFormatter.format(size as number) : '—',
    side: typeof side === 'string' ? side.toUpperCase() : '—',
    entry: Number.isFinite(entryPrice as number) ? numberFormatter.format(entryPrice as number) : '—',
    mark: Number.isFinite(markPrice as number) ? numberFormatter.format(markPrice as number) : '—',
    pnlUsd: typeof pnlUsd === 'number' && Number.isFinite(pnlUsd) ? toSignedUsd(pnlUsd) : '—',
    pnlPct: typeof pnlPct === 'number' && Number.isFinite(pnlPct) ? toSigned(pnlPct) : '—',
    notionalUsd: typeof notionalUsd === 'number' && Number.isFinite(notionalUsd) ? currencyFormatter.format(notionalUsd) : '—',
    pnlPctNum: typeof pnlPct === 'number' && Number.isFinite(pnlPct) ? pnlPct : 0,
    sideRaw: side,
  }
}

export function PnlPanel({ snapshot, trajectory = [], isLoading = false }: PnlPanelProps) {
  const positions = normalizePositions(snapshot.openPositions)
  const pnlStats = useMemo(() => buildSparkline(trajectory.map((point) => point.pnlPct)), [trajectory])
  const openPositionCount =
    Number.isFinite(snapshot.openPositionCount as number) && snapshot.openPositionCount !== undefined
      ? snapshot.openPositionCount
      : positions.length
  const openPositionNotionalUsd =
    Number.isFinite(snapshot.openPositionNotionalUsd as number) && snapshot.openPositionNotionalUsd !== undefined
      ? snapshot.openPositionNotionalUsd
      : positions.reduce((sum, position) => sum + (typeof position.notionalUsd === 'number' && Number.isFinite(position.notionalUsd) ? Math.abs(position.notionalUsd) : 0), 0)

  const normalizedTrajectory = trajectory.filter((entry) => Number.isFinite(entry.pnlPct))

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
              <div className='rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/65 dark:bg-hlpSurfaceDark/60 px-2 py-1'>
                <div className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>OPEN POS</div>
                <div className='text-[11px] font-semibold'>{isLoading ? '—' : String(openPositionCount)}</div>
              </div>
              <div className='rounded-sm border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface/65 dark:bg-hlpSurfaceDark/60 px-2 py-1'>
                <div className='text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>NOTIONAL</div>
                <div className='text-[11px] font-semibold'>{isLoading ? '—' : toSignedUsd(openPositionNotionalUsd)}</div>
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
            {isLoading || pnlStats.samples < 2 ? (
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
                    strokeWidth='1'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                  {normalizedTrajectory.length > 1
                    ? normalizedTrajectory.map((entry, index, values) => {
                        const x = values.length > 1 ? (index / (values.length - 1)) * pnlStats.width : 0
                        const yValue = values.length > 1 ? values[index]?.pnlPct ?? 0 : 0
                        const min = pnlStats.min
                        const range = Math.max(0.0001, pnlStats.max - min)
                        const y = 4 + (1 - (yValue - min) / range) * 24

                        return (
                          <circle
                            key={`point-${index}-${entry.ts}`}
                            cx={x.toFixed(3)}
                            cy={y.toFixed(3)}
                            r='0.55'
                            className='fill-hlpPositive dark:fill-hlpPositiveDark'
                          />
                        )
                      })
                    : null}
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

        <article className={monitorClass}>
          <div className={`flex items-center justify-between border-b border-hlpBorder dark:border-hlpBorderDark ${panelBodyPad} ${panelHeaderPad}`}>
            <span className='text-[9px] uppercase tracking-[0.24em] text-hlpMuted dark:text-hlpMutedDark'>OPEN POSITIONS</span>
            <AsciiBadge tone='neutral' variant='angle' className='text-[8px] tracking-[0.16em]'>
              book
            </AsciiBadge>
          </div>

          {isLoading ? (
            <div className='space-y-2 p-3'>
              {Array.from({ length: 5 }).map((_, index) => (
                <div className='grid gap-2 sm:grid-cols-6' key={`p-loading-${index}`}>
                  <span className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
                  <span className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
                  <span className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
                  <span className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
                  <span className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
                  <span className={`h-5 w-full rounded-sm ${skeletonPulseClass}`} />
                </div>
              ))}
            </div>
          ) : positions.length === 0 ? (
            <div className='py-8 text-center text-[11px] uppercase tracking-[0.18em] text-hlpMuted dark:text-hlpMutedDark'>
              No open positions currently
            </div>
          ) : (
            <div className='overflow-x-hidden'>
              <div className='grid grid-cols-1 gap-0 border-t border-hlpBorder dark:border-hlpBorderDark'>
                {positions.map((position, index) => {
                  const normalized = positionSummary(position)
                  return (
                    <div
                      className='grid border-b border-hlpBorder/85 dark:border-hlpBorderDark/85 p-3 text-[10px] sm:grid-cols-[2.3fr_0.9fr_0.9fr_1.2fr_1.2fr_1fr_0.9fr] sm:gap-2'
                      key={position.id ?? `${normalized.symbol}-${normalized.sideRaw ?? 'na'}-${index}`}
                    >
                      <div className='sm:truncate' title={normalized.symbol}>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>symbol</div>
                        <div className='break-words font-semibold'>{normalized.symbol}</div>
                      </div>
                      <div>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>side</div>
                        <div className={`${toSideClass(position.side)} font-semibold`}>{normalized.side}</div>
                      </div>
                      <div>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>size</div>
                        <div className='break-words'>{normalized.size}</div>
                      </div>
                      <div>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>entry</div>
                        <div className='break-words'>{normalized.entry}</div>
                      </div>
                      <div>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>mark</div>
                        <div className='break-words'>{normalized.mark}</div>
                      </div>
                      <div>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>pnl%</div>
                        <div className={`font-semibold ${safePnlClass(normalized.pnlPctNum)}`}>{normalized.pnlPct}</div>
                      </div>
                      <div>
                        <div className='mb-0.5 text-[8px] uppercase tracking-[0.16em] text-hlpMuted dark:text-hlpMutedDark'>notional</div>
                        <div className='break-words'>{normalized.notionalUsd}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className={sectionStripClass}>
            <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>book</span>
            <span className={inlineBadgeClass}>rows={positions.length}</span>
            <span className={inlineBadgeClass}>exposure={toSafe(openPositionNotionalUsd)}</span>
            <span className={inlineBadgeClass}>mode={snapshot.mode}</span>
          </div>
        </article>
      </div>
    </section>
  )
}
