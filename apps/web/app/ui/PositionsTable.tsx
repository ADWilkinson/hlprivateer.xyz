import type { OpenPosition } from './floor-dashboard'
import {
  cardClass,
  collapsibleHeaderClass,
  inlineBadgeClass,
  inverseControlClass,
  panelBodyPad,
  sectionStripClass,
  sectionTitleClass,
} from './ascii-style'
import { AsciiBadge, AsciiTable } from './ascii-kit'

const USD_0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const USD_2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })
const NUM_4 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 0 })

function formatSignedUsd(value: number): string {
  const abs = USD_2.format(Math.abs(value))
  return value >= 0 ? `+${abs}` : `-${abs}`
}

type PositionsTableProps = {
  positions: OpenPosition[]
  isLoading?: boolean
  compact?: boolean
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
}

export function PositionsTable({
  positions,
  isLoading = false,
  compact = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'positions',
}: PositionsTableProps) {
  const totalNotional = positions.reduce((sum, p) => sum + (p.notionalUsd ?? 0), 0)
  const totalPnl = positions.reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0)
  const columns = compact
    ? [
        {
          key: 'symbol',
          header: 'SYMBOL',
          align: 'left',
          render: (value: unknown) => (
            <span className='font-semibold text-hlpFg'>{String(value ?? '')}</span>
          ),
        },
        {
          key: 'side',
          header: 'SIDE',
          align: 'center',
          render: (value: unknown) => {
            const s = typeof value === 'string' ? value.toUpperCase() : '--'
            const label = s === 'BUY' ? 'LONG' : s === 'SELL' ? 'SHORT' : (s || '--')
            const color =
              label === 'LONG'
                ? 'text-hlpHealthy'
                : label === 'SHORT'
                  ? 'text-hlpNegative'
                  : 'text-hlpMuted'
            return <span className={color}>{label}</span>
          },
        },
        {
          key: 'notionalUsd',
          header: 'NOTIONAL',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null
            return <span className='text-hlpFg'>{n === null ? '--' : USD_0.format(n)}</span>
          },
        },
        {
          key: 'pnlUsd',
          header: 'PNL',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : null
            if (n === null) return <span className='text-hlpMuted'>--</span>
            const color = n >= 0 ? 'text-hlpPositive' : 'text-hlpNegative'
            return <span className={color}>{formatSignedUsd(n)}</span>
          },
        },
      ]
    : [
        {
          key: 'symbol',
          header: 'SYMBOL',
          align: 'left',
          render: (value: unknown) => (
            <span className='font-semibold text-hlpFg'>{String(value ?? '')}</span>
          ),
        },
        {
          key: 'side',
          header: 'SIDE',
          align: 'center',
          render: (value: unknown) => {
            const s = typeof value === 'string' ? value.toUpperCase() : '--'
            const label = s === 'BUY' ? 'LONG' : s === 'SELL' ? 'SHORT' : (s || '--')
            const color =
              label === 'LONG'
                ? 'text-hlpHealthy'
                : label === 'SHORT'
                  ? 'text-hlpNegative'
                  : 'text-hlpMuted'
            return <span className={color}>{label}</span>
          },
        },
        {
          key: 'size',
          header: 'QTY',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : null
            return <span className='text-hlpFg'>{n === null ? '--' : NUM_4.format(n)}</span>
          },
        },
        {
          key: 'entryPrice',
          header: 'ENTRY',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : null
            return <span className='text-hlpMuted'>{n === null ? '--' : USD_2.format(n)}</span>
          },
        },
        {
          key: 'markPrice',
          header: 'MARK',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : null
            return <span className='text-hlpFg'>{n === null ? '--' : USD_2.format(n)}</span>
          },
        },
        {
          key: 'notionalUsd',
          header: 'NOTIONAL',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null
            return <span className='text-hlpFg'>{n === null ? '--' : USD_0.format(n)}</span>
          },
        },
        {
          key: 'pnlUsd',
          header: 'PNL',
          align: 'right',
          render: (value: unknown) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : null
            if (n === null) return <span className='text-hlpMuted'>--</span>
            const color = n >= 0 ? 'text-hlpPositive' : 'text-hlpNegative'
            return <span className={color}>{formatSignedUsd(n)}</span>
          },
        },
      ]

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle positions panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span className={sectionTitleClass}>POSITIONS</span>
        <div className='flex items-center gap-2'>
          <span className={inverseControlClass}>{isCollapsed ? '+' : '-'}</span>
          <AsciiBadge tone='inverse'>
            {isLoading ? 'LOADING' : `${positions.length} OPEN`}
          </AsciiBadge>
        </div>
      </button>

      <div id={`section-${sectionId}`} hidden={isCollapsed}>
        {!isCollapsed && (
          <>
            <div className={panelBodyPad}>
              <AsciiTable<OpenPosition>
                columns={columns}
                data={positions}
                emptyText={isLoading ? 'loading...' : 'no open positions'}
              />
            </div>
            {positions.length > 0 && (
              <div className={sectionStripClass}>
                <span className={inlineBadgeClass}>total notional {USD_0.format(totalNotional)}</span>
                {!compact && (
                  <span className={inlineBadgeClass}>
                    total pnl{' '}
                    <span className={totalPnl > 0 ? 'text-hlpPositive' : totalPnl < 0 ? 'text-hlpNegative' : ''}>
                      {formatSignedUsd(totalPnl)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
