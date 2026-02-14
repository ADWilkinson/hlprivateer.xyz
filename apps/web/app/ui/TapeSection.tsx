import { AsciiBadge } from 'react-ascii-ui'
import type { TapeEntry } from './floor-dashboard'
import { formatTime } from './floor-dashboard'
import type { RefObject } from 'react'
import { cardClass, cardHeaderClass, terminalPanelClass } from './ascii-style'

type TapeSectionProps = {
  tape: TapeEntry[]
  tapeRef: RefObject<HTMLDivElement | null>
}

export function TapeSection({ tape, tapeRef }: TapeSectionProps) {
  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span>FLOOR TAPE</span>
        <AsciiBadge color='success' className='text-hlpPositive dark:text-hlpPositiveDark'>
          live
        </AsciiBadge>
      </div>

      <div className={terminalPanelClass} ref={tapeRef} aria-label='event tape'>
        {tape.map((entry, i) => {
          const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
          const levelTone =
            levelClass === 'warn'
              ? 'text-hlpWarning dark:text-hlpWarningDark'
              : levelClass === 'error'
                ? 'text-hlpNegative dark:text-hlpNegativeDark'
                : 'text-hlpMuted dark:text-hlpMutedDark'

          return (
            <div
              className={`flex items-baseline px-3 py-0.5 text-[11px] leading-[1.7] ${i === 0 ? 'text-hlpFg dark:text-hlpFgDark animate-hlp-hot' : ''} ${levelTone}`}
              key={`${i}-${entry.ts}`}
            >
              <span className='w-3 shrink-0 text-[10px] text-hlpFg dark:text-hlpFgDark'>{i === 0 ? '▸' : '\u00A0'}</span>
              <span className='w-[68px] shrink-0 text-[10px] text-hlpMuted dark:text-hlpMutedDark'>{formatTime(entry.ts)}</span>
              {entry.role && (
                <span className='w-[38px] shrink-0 text-[10px] font-bold text-hlpMuted dark:text-hlpMutedDark'>
                  [{entry.role.slice(0, 3).toUpperCase()}]
                </span>
              )}
              <span className='flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>{entry.line}</span>
              {i === 0 && <span className='ml-0.5 animate-hlp-cursor text-[10px] text-hlpFg dark:text-hlpFgDark'>█</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
