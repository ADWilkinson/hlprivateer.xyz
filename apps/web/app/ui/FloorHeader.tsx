import { AsciiButton, AsciiCard } from 'react-ascii-ui'

type FloorHeaderProps = {
  theme: 'light' | 'dark'
  apiBase: string
  onToggleTheme: () => void
}

export function FloorHeader({ theme, apiBase, onToggleTheme }: FloorHeaderProps) {
  return (
    <AsciiCard
      title='COMMAND DECK'
      className='border border-[var(--border)] bg-[var(--bg-raised)] rounded-[var(--r)] shadow-[var(--panel-shadow)] text-[var(--fg)]'
    >
      <header className='flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-4 sm:py-3'>
        <div className='min-w-0'>
          <div className='text-[15px] leading-none font-bold tracking-[0.22em] text-[var(--fg)]'>[HL] PRIVATEER</div>
          <div className='text-[9px] uppercase tracking-[0.3em] text-[var(--fg-muted)]'>TRADING FLOOR</div>
        </div>
        <div className='flex flex-1 flex-col items-end gap-1 sm:items-end'>
          <div className='text-[9px] tracking-[0.2em] uppercase text-[var(--fg-muted)]'>x402 ACCESS</div>
          <div className='text-[9px] text-[var(--fg-dim)] max-w-[240px] truncate'>{apiBase}</div>
          <AsciiButton
            className='self-end border border-[var(--border)] px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-[var(--fg-muted)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--fg)]'
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
