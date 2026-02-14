import { AsciiButton, AsciiCard } from 'react-ascii-ui'
import { buttonClass, buttonStyle, cardClass, cardStyle, mutedTextClass, sectionTitleClass } from './ascii-style'

type FloorHeaderProps = {
  theme: 'light' | 'dark'
  apiBase: string
  onToggleTheme: () => void
}

export function FloorHeader({ theme, apiBase, onToggleTheme }: FloorHeaderProps) {
  return (
    <AsciiCard
      className={cardClass}
      style={cardStyle}
    >
      <header className='flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-4 sm:py-3'>
        <div className='min-w-0'>
          <div className='text-[15px] leading-none font-bold tracking-[0.22em] text-[var(--fg)]'>[HL] PRIVATEER</div>
          <div className={sectionTitleClass}>TRADING FLOOR</div>
        </div>
        <div className='flex flex-1 flex-col items-end gap-1 sm:items-end'>
          <div className={mutedTextClass}>x402 ACCESS</div>
          <div className='text-[9px] text-[var(--fg-dim)] max-w-[240px] truncate'>{apiBase}</div>
          <AsciiButton
            className={`${buttonClass} hover:border-[var(--border-active)] hover:text-[var(--fg)]`}
            style={{ ...buttonStyle, color: 'var(--fg-muted)' }}
            onClick={onToggleTheme}
            aria-label='Toggle theme'
          >
            {theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'}
          </AsciiButton>
        </div>
      </header>
    </AsciiCard>
  )
}
