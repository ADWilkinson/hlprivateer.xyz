import { AsciiCard } from 'react-ascii-ui'
import { cardClass, mutedTextClass, sectionTitleClass } from './ascii-style'

type FloorFooterProps = {
  apiEndpoint: string
}

export function FloorFooter({ apiEndpoint }: FloorFooterProps) {
  return (
    <AsciiCard
      className={`${cardClass} text-center px-3.5 py-2.5`}
    >
      <div className='mb-1 border-b border-[var(--border)] px-1 py-1'>
        <div className='text-[9px] uppercase tracking-[0.2em] text-[var(--fg-muted)]'>ACCESS LANE</div>
      </div>
      <div className='flex items-center justify-center gap-2.5 mb-1'>
        <span className='text-[10px] text-[var(--fg-dim)]'>───</span>
        <span className={sectionTitleClass}>x402 agent access</span>
        <span className='text-[10px] text-[var(--fg-dim)]'>───</span>
      </div>
      <div className={mutedTextClass}>{apiEndpoint}</div>
    </AsciiCard>
  )
}
