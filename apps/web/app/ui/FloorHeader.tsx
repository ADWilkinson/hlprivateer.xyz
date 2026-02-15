import { AsciiBadge } from './ascii-kit'

type FloorHeaderProps = {
  onX402Access?: () => void
}

export function FloorHeader({ onX402Access }: FloorHeaderProps) {
  const handleX402AccessClick = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    onX402Access?.()

    if (typeof window === 'undefined') return

    const target = document.getElementById('x402-access')
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className='flex items-center justify-between animate-hlp-fade-up'>
      <div className='text-[10px] uppercase tracking-[0.22em] text-hlpDim'>
        LIVE TRADING FLOOR
      </div>
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-hlpPositive'>
          <span className='inline-block h-1.5 w-1.5 animate-hlp-led bg-hlpPositive' />
          LIVE
        </div>
        <a
          href='#x402-access'
          onClick={handleX402AccessClick}
          className='inline-flex items-center'
        >
          <AsciiBadge tone='info' variant='angle' className='tracking-[0.16em]'>
            x402
          </AsciiBadge>
        </a>
      </div>
    </div>
  )
}
