import { AsciiBadge } from './ascii-kit'
import { formatTime, type TapeEntry } from './floor-dashboard'
import type { RefObject } from 'react'
import { cardClass, cardHeaderClass, inlineBadgeClass, panelBodyPad, sectionStripClass, skeletonPulseClass, terminalPanelClass } from './ascii-style'

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
                className={`flex min-w-0 items-baseline gap-1 ${panelBodyPad} text-[10px] leading-[1.45] text-hlpMuted`}
                key={`loading-${index}`}
              >
                <span className='w-3 shrink-0 text-[10px]'>&nbsp;</span>
                <span className='w-[66px] shrink-0'>
                  <span className={`inline-block h-3 w-12 rounded-sm ${skeletonPulseClass}`} />
                </span>
                <span className='w-[44px] shrink-0'>
                  <span className={`inline-block h-3 w-8 rounded-sm ${skeletonPulseClass}`} />
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='inline-block h-3 w-full rounded-sm bg-hlpSurface/70' />
                </span>
              </div>
            ))
          : tape.map((entry, i) => {
              const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
              const levelTone =
                levelClass === 'warn'
                  ? 'text-hlpWarning'
                  : levelClass === 'error'
                    ? 'text-hlpNegative'
                    : 'text-hlpMuted'

              return (
                <div
                  className={`flex min-w-0 items-baseline gap-1 ${panelBodyPad} text-[10px] leading-[1.45] ${i === 0 ? 'text-hlpFg bg-hlpSurface/75 animate-hlp-hot' : ''} ${levelTone}`}
                  key={`${i}-${entry.ts}`}
                >
                  <span className='w-3 shrink-0 text-[10px] text-hlpFg'>{i === 0 ? '▸' : '\u00A0'}</span>
                  <span className='w-[66px] shrink-0 text-[10px] text-hlpMuted'>{formatTime(entry.ts)}</span>
                  {entry.role && (
                    <span className='w-[44px] shrink-0 text-[10px] font-bold text-hlpMuted'>
                      [{entry.role.slice(0, 3).toUpperCase()}]
                    </span>
                  )}
                  <span className='min-w-0 flex-1 overflow-hidden break-words'>{entry.line}</span>
                  {i === 0 && <span className='ml-0.5 animate-hlp-cursor text-[10px] text-hlpFg'>█</span>}
                </div>
              )
            })}
      </div>

      <div className={sectionStripClass}>
        <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>tail stream</span>
        <span className={inlineBadgeClass}>entries={tape.length}</span>
      </div>
    </section>
  )
}
