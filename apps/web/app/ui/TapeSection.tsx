import { AsciiBadge } from './ascii-kit'
import { formatTime, type TapeEntry } from './floor-dashboard'
import { type RefObject } from 'react'
import { cardClass, collapsibleHeaderClass, inlineBadgeClass, inverseControlClass, panelBodyPad, sectionStripClass, skeletonPulseClass, terminalPanelClass } from './ascii-style'

type TapeSectionProps = {
  tape: TapeEntry[]
  tapeRef: RefObject<HTMLDivElement | null>
  isLoading?: boolean
  compact?: boolean
  isCollapsed?: boolean
  onToggle?: () => void
  sectionId?: string
}

export function TapeSection({
  tape,
  tapeRef,
  isLoading = false,
  compact = false,
  isCollapsed = false,
  onToggle,
  sectionId = 'tape',
}: TapeSectionProps) {
  const visibleTape = compact ? tape.slice(0, 90) : tape
  const loadingRows = compact ? 4 : 8
  const rowPaddingClass = compact ? 'px-2 py-1.5' : panelBodyPad
  const rowTextClass = compact ? 'text-[9px]' : 'text-[10px]'

  return (
    <section className={cardClass}>
      <button
        type='button'
        className={collapsibleHeaderClass}
        aria-label='Toggle floor tape panel'
        aria-expanded={!isCollapsed}
        aria-controls={`section-${sectionId}`}
        onClick={onToggle}
      >
        <span>FLOOR TAPE</span>
        <div className='flex items-center gap-2'>
        <span className={inverseControlClass}>
            {isCollapsed ? '+' : '-'}
          </span>
          <AsciiBadge tone='positive' variant='angle' className='tracking-[0.16em]'>
            live
          </AsciiBadge>
        </div>
      </button>

      <div id={`section-${sectionId}`} hidden={isCollapsed}>
        {!isCollapsed && (
          <>
            <div
              className={`${terminalPanelClass} relative scanline-overlay`}
              ref={tapeRef}
              style={{ maxHeight: compact ? '14rem' : '420px' }}
              aria-label='event tape'
            >
              {isLoading
                ? Array.from({ length: loadingRows }).map((_, index) => (
                    <div
                      className={`flex min-w-0 items-start gap-1.5 ${rowPaddingClass} ${rowTextClass} leading-[1.45] text-hlpMuted`}
                      key={`loading-${index}`}
                    >
                      <span className={`w-3 shrink-0 ${rowTextClass}`}>&nbsp;</span>
                      <span className='min-w-0 flex-[0_0_60px] shrink-0 sm:flex-[0_0_66px]'>
                        <span className={`inline-block h-3 w-12 ${skeletonPulseClass}`} />
                      </span>
                      <span className='min-w-0 flex-[0_0_40px] shrink-0 sm:flex-[0_0_44px]'>
                        <span className={`inline-block h-3 w-8 ${skeletonPulseClass}`} />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='inline-block h-3 w-full bg-hlpSurface/70' />
                      </span>
                    </div>
                  ))
                : visibleTape.map((entry, i) => {
                    const levelClass = entry.level ? entry.level.toLowerCase() : 'info'
                    const levelTone =
                      levelClass === 'warn'
                        ? 'text-hlpWarning'
                        : levelClass === 'error'
                          ? 'text-hlpNegative'
                          : 'text-hlpMuted'

                    return (
                      <div
                        className={`relative z-10 flex min-w-0 items-start gap-1.5 ${rowPaddingClass} ${rowTextClass} leading-[1.45] ${i === 0 ? 'bg-hlpSurface/75 animate-hlp-hot' : ''} ${levelTone}`}
                        key={`${entry.ts}-${entry.role ?? ''}-${entry.line.slice(0, 60)}`}
                      >
                        <span className={`w-3 shrink-0 ${rowTextClass} text-hlpFg`}>{i === 0 ? '\u25B8' : '\u00A0'}</span>
                        <span className='min-w-0 flex-[0_0_60px] shrink-0 sm:flex-[0_0_66px] text-hlpDim'>{formatTime(entry.ts)}</span>
                        {entry.role && (
                          <span className='min-w-0 flex-[0_0_40px] shrink-0 sm:flex-[0_0_44px] font-bold text-hlpMuted'>
                            [{entry.role.slice(0, 3).toUpperCase()}]
                          </span>
                        )}
                        <span className='min-w-0 flex-1 overflow-hidden break-words'>{entry.line}</span>
                        {i === 0 && <span className={`ml-0.5 animate-hlp-cursor ${rowTextClass} text-hlpFg`}>█</span>}
                      </div>
                    )
                  })}
            </div>

            <div className={sectionStripClass}>
              <span className='text-[9px] uppercase tracking-[0.2em] text-hlpMuted'>tail stream</span>
              <span className={inlineBadgeClass}>entries={tape.length}</span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
