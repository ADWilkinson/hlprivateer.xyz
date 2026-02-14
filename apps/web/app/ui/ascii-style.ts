import type { CSSProperties } from 'react'

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

export const cardClass = 'border border-[var(--border)] rounded-[var(--r)] shadow-[var(--panel-shadow)] text-[var(--fg)]'

export const cardStyle: CSSProperties = {
  borderColor: 'var(--border)',
  backgroundColor: 'var(--bg-raised)',
  color: 'var(--fg)',
  fontFamily: fontStack,
}

export const cardHeaderClass = 'flex items-center justify-between border-b border-[var(--border)] px-3 py-2'

export const inlineBadgeClass = 'border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--fg-muted)] whitespace-nowrap'

export const buttonStyle: CSSProperties = {
  borderColor: 'var(--border)',
  color: 'var(--fg)',
  fontFamily: fontStack,
}

export const buttonClass = 'border border-[var(--border)] px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-[var(--fg)] transition-colors'

export const sectionTitleClass = 'text-[9px] uppercase tracking-[0.25em] text-[var(--fg-muted)]'

export const mutedTextClass = 'text-[9px] text-[var(--fg-muted)]'

export const mutedTextStyle: CSSProperties = {
  color: 'var(--fg-muted)',
}
