export const fontStack = [
  'var(--font-mono)',
  'IBM Plex Mono',
  '"SF Mono"',
  'SFMono-Regular',
  'Consolas',
  'Monaco',
  'Liberation Mono',
  'Courier New',
  'monospace',
].join(', ')

export const cardClass = 'border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg-raised)] shadow-[var(--panel-shadow)] text-[var(--fg)]'
export const cardHeaderClass = 'flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-[9px] uppercase tracking-[0.25em] text-[var(--fg-muted)]'
export const inlineBadgeClass = 'border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'
export const buttonClass = 'border border-[var(--border)] px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-[var(--fg)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--fg)]'
export const sectionTitleClass = 'text-[9px] uppercase tracking-[0.25em] text-[var(--fg-muted)]'
export const mutedTextClass = 'text-[9px] text-[var(--fg-muted)]'
export const mutedPanelClass = 'border-t border-[var(--border)] bg-[var(--bg-surface)]'
export const terminalPanelClass = 'max-h-[300px] overflow-y-auto overflow-x-hidden py-1 min-h-0 rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg-surface)] p-2'
