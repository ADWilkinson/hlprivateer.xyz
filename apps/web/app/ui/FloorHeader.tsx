import { AsciiCard } from 'react-ascii-ui'
import { buttonClass, cardClass, cardHeaderClass, mutedTextClass, sectionTitleClass } from './ascii-style'

type FloorHeaderProps = {
  theme: 'light' | 'dark'
  apiBase: string
  onToggleTheme: () => void
}

export function FloorHeader({ theme, apiBase, onToggleTheme }: FloorHeaderProps) {
  return (
    <AsciiCard className={cardClass}>
      <header className='flex flex-wrap items-start justify-between gap-2 border-b border-hlpBorder dark:border-hlpBorderDark px-4 py-3 sm:px-4 sm:py-3'>
        <div className='min-w-0 space-y-1'>
          <div className={sectionTitleClass}>LIVE TRADING FLOOR</div>
          <div className='text-[17px] leading-none font-bold tracking-[0.22em]'>[HL] PRIVATEER</div>
          <div className={mutedTextClass}>access lane: x402</div>
          <div className='max-w-[280px] truncate text-[9px] text-hlpMuted dark:text-hlpMutedDark'>{apiBase}</div>
        </div>
        <div className='flex w-full sm:w-auto items-center'>
          <button type='button' className={buttonClass} onClick={onToggleTheme} aria-label='Toggle theme'>
            {theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'}
          </button>
        </div>
      </header>
      <div className={cardHeaderClass}>
        <span>fleet status</span>
        <span>ascii mode active</span>
      </div>
    </AsciiCard>
  )
}
