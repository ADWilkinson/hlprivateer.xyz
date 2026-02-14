import { AsciiCard } from 'react-ascii-ui'

type FloorFooterProps = {
  apiEndpoint: string
}

export function FloorFooter({ apiEndpoint }: FloorFooterProps) {
  return (
    <AsciiCard
      title='ACCESS LANE'
      className='border border-[var(--border)] bg-[var(--bg-raised)] rounded-[var(--r)] shadow-[var(--panel-shadow)] text-[var(--fg)] text-center px-3.5 py-2.5'
    >
      <div className='flex items-center justify-center gap-2.5 mb-1'>
        <span className='text-[10px] text-[var(--fg-dim)]'>───</span>
        <span className='text-[9px] tracking-[0.2em] uppercase text-[var(--fg-muted)]'>x402 agent access</span>
        <span className='text-[10px] text-[var(--fg-dim)]'>───</span>
      </div>
      <div className='text-[10px] text-[var(--fg-muted)]'>{apiEndpoint}</div>
    </AsciiCard>
  )
}
