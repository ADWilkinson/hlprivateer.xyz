import { AsciiBadge, AsciiCard } from 'react-ascii-ui'
import type { TapeEntry } from './floor-dashboard'
import { formatTime } from './floor-dashboard'
import type { RefObject } from 'react'
import { cardClass, sectionTitleClass, terminalPanelClass } from './ascii-style'

type TapeSectionProps = {
  tape: TapeEntry[]
  tapeRef: RefObject<HTMLDivElement | null>
}

export function TapeSection({ tape, tapeRef }: TapeSectionProps) {
  return (
    <AsciiCard
      className={cardClass}
    >
      <div className='flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2'>
        <div className={sectionTitleClass}>FLOOR TAPE</div>
        <AsciiBadge color='success' className='text-[var(--positive)]'>live</AsciiBadge>
      </div>
      <div className={terminalPanelClass} ref={tapeRef} aria-label='event tape'>
        {tape.map((entry, i) => {
          const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
          const levelTone =
            levelClass === 'warn'
              ? 'text-[var(--amber)]'
              : levelClass === 'error'
                ? 'text-[var(--negative)]'
                : 'text-[var(--fg-muted)]'
          return (
            <div
              className={`flex items-baseline px-3 py-0.5 text-[11px] leading-[1.7] ${i === 0 ? 'text-[var(--fg)] animate-[hlp-hot_500ms_ease-out_1]' : ''} ${levelTone}`}
              key={`${i}-${entry.ts}`}
            >
              <span className='w-3 shrink-0 text-[10px] text-[var(--fg)]'>{i === 0 ? '▸' : '\u00A0'}</span>
              <span className='w-[68px] shrink-0 text-[10px] text-[var(--fg-muted)]'>{formatTime(entry.ts)}</span>
              {entry.role && (
                <span className='w-[38px] shrink-0 text-[10px] font-bold text-[var(--fg-muted)]'>[{entry.role.slice(0, 3).toUpperCase()}]</span>
              )}
              <span className='flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>{entry.line}</span>
              {i === 0 && <span className='ml-0.5 animate-[cursor-blink_1s_step-end_infinite] text-[10px] text-[var(--fg)]'>█</span>}
            </div>
          )
        })}
      </div>
    </AsciiCard>
  )
}
