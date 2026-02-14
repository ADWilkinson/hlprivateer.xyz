export const pageShellClass = 'relative z-10 mx-auto w-full max-w-[1300px] flex flex-col gap-3 px-2 py-4 sm:px-4 sm:py-6 lg:px-6 2xl:px-8'
export const panelRadius = 'rounded-[6px]'
export const panelRadiusSubtle = 'rounded-[3px]'
export const panelGap = 'gap-2'
export const panelBalancedPad = 'p-2 md:p-3'
export const panelBodyPad = 'px-2 py-2'
export const panelHeaderPad = 'px-3 py-2'
export const panelInsetPad = 'px-2 py-1.5'
export const panelInlinePad = 'px-1 py-1'
export const panelDividerClass = 'border-t border-hlpBorder'

export const cardClass =
  `relative overflow-hidden animate-hlp-fade-up ${panelRadius} border border-hlpBorder bg-hlpPanel text-hlpFg shadow-hlp-card`

export const cardHeaderClass =
  `flex items-center justify-between border-b border-hlpBorder bg-hlpSurface ${panelHeaderPad} text-[9px] uppercase tracking-[0.24em] text-hlpMuted`

export const inlineBadgeClass =
  `inline-flex h-5 items-center ${panelRadiusSubtle} border border-hlpBorder bg-hlpPanel/40 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-hlpMuted whitespace-nowrap`

export const buttonClass =
  `inline-flex h-8 items-center ${panelRadiusSubtle} border border-hlpBorder bg-hlpSurface px-2.5 text-[9px] uppercase tracking-[0.16em] text-hlpMuted transition-colors hover:border-hlpBorderStrong hover:text-hlpFg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hlpBorder`

export const skeletonPulseClass =
  'animate-pulse bg-hlpSurface/70 border border-hlpBorder'

export const sectionTitleClass = 'text-[9px] uppercase tracking-[0.24em] text-hlpMuted'
export const mutedTextClass = 'text-[9px] text-hlpMuted'
export const inverseControlClass =
  'inline-flex h-5 w-5 items-center justify-center border border-hlpBorder bg-hlpInverseBg text-[10px] uppercase tracking-[0.14em] text-hlpPanel'
export const mutedPanelClass = 'border-t border-hlpBorder bg-hlpSurface'
export const terminalPanelClass = 'max-h-[420px] min-h-0 overflow-y-auto overflow-x-hidden py-1 px-2'

export const statusCellClass =
  'flex items-center justify-between gap-2 border-b border-hlpBorder bg-hlpPanel/95 px-3 py-2 min-h-[34px]'

export const monitorClass = 'overflow-hidden rounded-[4px] bg-hlpSurface'

export const sectionStripClass =
  `flex flex-wrap ${panelGap} border-t border-hlpBorder ${panelBodyPad}`

export const heroCardClass =
  `${panelRadius} border border-hlpBorder bg-hlpInverseBg p-3 sm:p-4`

export const collapsibleHeaderClass =
  `${cardHeaderClass} w-full cursor-pointer appearance-none bg-hlpSurface text-left transition-colors hover:bg-hlpPanel/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hlpBorder`
