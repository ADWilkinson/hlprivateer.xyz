export const pageShellClass = 'relative z-10 mx-auto w-full max-w-[1300px] flex flex-col gap-4 px-3 py-5 sm:px-5 sm:py-7 lg:px-6 2xl:px-8'
const panelGap = 'gap-3'
export const panelBodyPad = 'px-3 py-2.5'
export const panelHeaderPad = 'px-3 py-2'
export const panelInsetPad = 'px-2 py-1.5'

export const cardClass =
  'relative overflow-hidden animate-hlp-fade-up border border-hlpBorder bg-hlpPanel text-hlpFg'

export const cardHeaderClass =
  `flex items-center justify-between border-b border-hlpBorder bg-hlpSurface ${panelHeaderPad} text-[9px] uppercase tracking-[0.24em] text-hlpMuted`

export const inlineBadgeClass =
  'inline-flex h-5 items-center border border-hlpBorder bg-hlpPanel/40 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-hlpMuted whitespace-nowrap'

export const skeletonPulseClass =
  'animate-pulse bg-hlpSurface/70 border border-hlpBorder'

export const sectionTitleClass = 'text-[10px] uppercase tracking-[0.20em] text-hlpMuted'
export const mutedTextClass = 'text-[9px] text-hlpMuted'
export const inverseControlClass =
  'inline-flex h-5 w-5 items-center justify-center border border-hlpBorder bg-hlpInverseBg text-[10px] uppercase tracking-[0.14em] text-hlpPanel'
export const terminalPanelClass = 'max-h-[420px] min-h-0 overflow-y-auto overflow-x-hidden py-1 px-2'

export const statusCellClass =
  'flex items-center justify-between gap-2 border-b border-hlpBorder bg-hlpPanel/95 px-3 py-2 min-h-[34px]'

export const monitorClass = 'overflow-hidden bg-hlpSurface'

export const sectionStripClass =
  `flex flex-wrap ${panelGap} border-t border-hlpBorder ${panelBodyPad}`

export const collapsibleHeaderClass =
  `${cardHeaderClass} w-full cursor-pointer appearance-none bg-hlpSurface text-left transition-colors hover:bg-[var(--theme-focused-foreground-subdued)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-focused-foreground)]`
