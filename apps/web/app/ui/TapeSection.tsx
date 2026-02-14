import { AsciiBadge } from './ascii-kit'
import type { TapeEntry } from './floor-dashboard'
import { formatTime } from './floor-dashboard'
import type { RefObject } from 'react'
import { cardClass, cardHeaderClass, inlineBadgeClass, sectionStripClass, skeletonPulseClass, terminalPanelClass } from './ascii-style'

type TapeSectionProps = {
  tape: TapeEntry[]
  tapeRef: RefObject<HTMLDivElement | null>
  isLoading?: boolean
}

export function TapeSection({ tape, tapeRef, isLoading = false }: TapeSectionProps) {
  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>
        <span>FLOOR TAPE</span>
        <AsciiBadge tone='positive' variant='angle' className='tracking-[0.16em]'>
          live
        </AsciiBadge>
      </div>

      <div className={terminalPanelClass} ref={tapeRef} aria-label='event tape'>
        {isLoading
          ? Array.from({ length: 10 }).map((_, index) => (
              <div
                className='flex items-baseline px-3 py-0.5 text-[11px] leading-[1.7] text-hlpMuted dark:text-hlpMutedDark'
                key={`loading-${index}`}
              >
                <span className='w-3 shrink-0 text-[10px]'>&nbsp;</span>
                <span className='w-[68px] shrink-0'>
                  <span className={`inline-block h-3 w-12 rounded-sm ${skeletonPulseClass}`} />
                </span>
                <span className='w-[38px] shrink-0'>
                  <span className={`inline-block h-3 w-8 rounded-sm ${skeletonPulseClass}`} />
                </span>
                <span className='w-full'>
                  <span className='inline-block h-3 w-full max-w-[280px] rounded-sm bg-hlpSurface/70 dark:bg-hlpSurfaceDark/60' />
                </span>
              </div>
            ))
          : tape.map((entry, i) => {
              const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
              const levelTone =
                levelClass === 'warn'
                  ? 'text-hlpWarning dark:text-hlpWarningDark'
                  : levelClass === 'error'
                    ? 'text-hlpNegative dark:text-hlpNegativeDark'
                    : 'text-hlpMuted dark:text-hlpMutedDark'

              return (
                <div
                  className={`flex items-baseline px-3 py-0.5 text-[11px] leading-[1.7] ${i === 0 ? 'text-hlpFg dark:text-hlpFgDark bg-hlpSurface/75 dark:bg-hlpSurfaceDark/65 animate-hlp-hot' : ''} ${levelTone}`}
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

      <div className={sectionStripClass}>
        <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>tail stream</span>
        <span className={inlineBadgeClass}>entries={tape.length}</span>
      </div>
    </section>
  )
}
