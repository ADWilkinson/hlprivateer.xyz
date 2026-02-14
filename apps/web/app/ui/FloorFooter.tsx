import { cardClass } from './ascii-style'

type FloorFooterProps = {
  apiEndpoint: string
}

export function FloorFooter({ apiEndpoint }: FloorFooterProps) {
  return (
    <div className={`${cardClass} py-3 text-center`}>
      <div className='mb-2 border-b border-hlpBorder dark:border-hlpBorderDark px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>
        ACCESS LANE
      </div>
      <div className='mb-1 text-[11px] uppercase tracking-[0.2em] text-hlpMuted dark:text-hlpMutedDark'>x402 AGENT ACCESS</div>
      <div className='px-2 text-[9px] text-hlpMuted dark:text-hlpMutedDark break-all'>{apiEndpoint}</div>
    </div>
  )
}
