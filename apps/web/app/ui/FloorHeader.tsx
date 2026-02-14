import { AsciiButton, AsciiCard } from 'react-ascii-ui'

type FloorHeaderProps = {
  logo: string
  theme: 'light' | 'dark'
  apiBase: string
  onToggleTheme: () => void
}

export function FloorHeader({ logo, theme, apiBase, onToggleTheme }: FloorHeaderProps) {
  return (
    <AsciiCard title='COMMAND DECK' className='panel-shell'>
      <header className='floor-header'>
        <div className='header-left'>
          <pre className='ascii-logo' aria-label='HL Privateer'>
            {logo}
          </pre>
          <div className='header-title-mobile'>HL PRIVATEER</div>
        </div>
        <div className='header-right'>
          <div className='header-subtitle'>TRADING FLOOR</div>
          <div className='header-endpoints'>{apiBase}</div>
          <AsciiButton className='theme-toggle' onClick={onToggleTheme} aria-label='Toggle theme'>
            {theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'}
          </AsciiButton>
        </div>
      </header>
    </AsciiCard>
  )
}
