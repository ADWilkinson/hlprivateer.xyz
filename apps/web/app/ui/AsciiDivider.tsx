type DividerVariant = 'wave' | 'dots' | 'line' | 'compass'

const patterns: Record<DividerVariant, string> = {
  wave: '~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7',
  dots: '\u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7 \u00B7',
  line: '\u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500 \u2500',
  compass: '\u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500 \u2022 \u2500\u2500',
}

export function AsciiDivider({ variant = 'wave', className = '' }: { variant?: DividerVariant; className?: string }) {
  return (
    <div
      className={`text-center text-hlpBorder text-[10px] tracking-[0.25em] select-none py-2 overflow-hidden whitespace-nowrap ${className}`}
      aria-hidden='true'
    >
      {patterns[variant]}
    </div>
  )
}
