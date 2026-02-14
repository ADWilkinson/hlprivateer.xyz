import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import type { TapeEntry } from './floor-dashboard'
import { formatTime } from './floor-dashboard'
import type { RefObject } from 'react'

type TapeSectionProps = {
  tape: TapeEntry[]
  tapeRef: RefObject<HTMLDivElement | null>
}

export function TapeSection({ tape, tapeRef }: TapeSectionProps) {
  return (
    <AsciiCard title='FLOOR TAPE' className='panel-card' style={{ padding: 0, backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border)' }}>
      <div className='section-bar'>
        <div className='section-label'>FLOOR TAPE</div>
        <AsciiBadge color='success'>live</AsciiBadge>
      </div>
      <div className='tape-scroll' ref={tapeRef} aria-label='event tape'>
        {tape.map((entry, i) => {
          const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
          return (
            <div className={`tape-line ${i === 0 ? 'hot' : ''} ${levelClass}`} key={`${i}-${entry.ts}`}>
              <span className='tape-marker'>{i === 0 ? '▸' : '\u00A0'}</span>
              <span className='tape-ts'>{formatTime(entry.ts)}</span>
              {entry.role && (
                <span className='tape-role'>[{entry.role.slice(0, 3).toUpperCase()}]</span>
              )}
              <span className='tape-msg'>{entry.line}</span>
              {i === 0 && <span className='tape-cursor'>█</span>}
            </div>
          )
        })}
      </div>
    </AsciiCard>
  )
}
