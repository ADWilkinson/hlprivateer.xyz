import { panelRadiusSubtle } from './ascii-style'
import type { HTMLAttributes, ReactNode } from 'react'

type BadgeTone = 'neutral' | 'positive' | 'warning' | 'error' | 'info'

type BadgeVariant = 'square' | 'angle' | 'curly'

type TableAlign = 'left' | 'center' | 'right'

export type AsciiTableColumn<T> = {
  key: keyof T | string
  header: string
  align?: TableAlign
  width?: string
  render?: (value: unknown, row: T, index: number) => ReactNode
}

type AsciiTableProps<T> = {
  columns: AsciiTableColumn<T>[]
  data: T[]
  caption?: string
  className?: string
  emptyText?: string
} & Omit<HTMLAttributes<HTMLTableElement>, 'children' | 'className'>

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: 'border-hlpBorder dark:border-hlpBorderDark text-hlpMuted dark:text-hlpMutedDark',
  positive: 'border-hlpPositive/80 dark:border-hlpPositiveDark/80 text-hlpPositive dark:text-hlpPositiveDark',
  warning: 'border-hlpWarning/80 dark:border-hlpWarningDark/80 text-hlpWarning dark:text-hlpWarningDark',
  error: 'border-hlpNegative/80 dark:border-hlpNegativeDark/80 text-hlpNegative dark:text-hlpNegativeDark',
  info: 'border-hlpMuted/80 dark:border-hlpMutedDark/80 text-hlpMuted dark:text-hlpMutedDark',
}

const badgeGlyphs: Record<BadgeVariant, [string, string]> = {
  square: ['[', ']'],
  angle: ['<', '>'],
  curly: ['{', '}'],
}

function getAlignClass(align: TableAlign): string {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return 'text-left'
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function AsciiBadge({
  tone = 'neutral',
  variant = 'square',
  children,
  className = '',
  ...props
}: {
  tone?: BadgeTone
  variant?: BadgeVariant
  children: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  const [leftGlyph, rightGlyph] = badgeGlyphs[variant]

  return (
    <span
      {...props}
      className={`inline-flex h-5 items-center ${panelRadiusSubtle} border px-2 py-1 text-[9px] uppercase tracking-[0.14em] ${badgeToneClass[tone]} ${className}`}
    >
      <span className='select-none'>{leftGlyph}</span>
      <span className='px-1'>{children}</span>
      <span className='select-none'>{rightGlyph}</span>
    </span>
  )
}

export function AsciiTable<T extends Record<string, unknown>>({
  columns,
  data,
  caption,
  className = '',
  emptyText = 'no data',
  ...props
}: AsciiTableProps<T>) {
  return (
    <div className={`overflow-hidden ${panelRadiusSubtle} border border-hlpBorder dark:border-hlpBorderDark bg-hlpSurface dark:bg-hlpSurfaceDark ${className}`}>
      {caption && <div className='border-b border-hlpBorder dark:border-hlpBorderDark px-2 py-1 text-[8px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>{caption}</div>}

      <table {...props} className='w-full border-collapse text-[10px]'>
        <thead>
          <tr className='bg-hlpPanel dark:bg-hlpPanelDark'>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                style={column.width ? { width: column.width } : undefined}
                className={`px-2 py-1 border-r border-b last:border-r-0 border-hlpBorder dark:border-hlpBorderDark font-semibold text-hlpMuted dark:text-hlpMutedDark ${getAlignClass(
                  column.align ?? 'left',
                )}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {data.length === 0 ? (
            <tr>
              <td className='px-4 py-6 text-center text-hlpMuted dark:text-hlpMutedDark' colSpan={columns.length}>
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={String((row as { id?: string }).id ?? rowIndex)}
                className={rowIndex % 2 === 0 ? 'bg-transparent' : 'bg-hlpPanel/35 dark:bg-hlpPanelDark/35'}
              >
                {columns.map((column) => (
                  <td
                    key={`${String(column.key)}-${rowIndex}`}
                    className={`px-2 py-1 border-r border-hlpBorder/75 dark:border-hlpBorderDark/75 last:border-r-0 ${getAlignClass(
                      column.align ?? 'left',
                    )}`}
                  >
                    {column.render
                      ? column.render((row as Record<string, unknown>)[String(column.key)], row, rowIndex)
                      : normalizeValue((row as Record<string, unknown>)[String(column.key)])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export type { BadgeTone, BadgeVariant, TableAlign }
