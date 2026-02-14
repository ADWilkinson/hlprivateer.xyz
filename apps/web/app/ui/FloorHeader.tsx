import { cardClass, cardHeaderClass, panelBodyPad, sectionTitleClass } from './ascii-style'
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
      window.history.replaceState(null, '', '#x402-access')
    }
  }

  return (
    <section className={cardClass}>
      <header className={`flex flex-wrap items-start justify-between gap-2 border-b border-hlpBorder ${panelBodyPad}`}>
        <div className='min-w-0 space-y-1'>
          <div className={sectionTitleClass}>LIVE TRADING FLOOR</div>
          <div className='text-[17px] leading-none font-bold tracking-[0.22em]'>[HL] PRIVATEER</div>
        </div>
        <div className='flex w-full items-center justify-end gap-2 sm:w-auto'>
          <a
            href='#x402-access'
            onClick={handleX402AccessClick}
            className='inline-flex items-center'
          >
            <AsciiBadge tone='inverse' variant='curly' className='tracking-[0.2em]'>
              x402 access
            </AsciiBadge>
          </a>
          <AsciiBadge tone='inverse' variant='curly' className='tracking-[0.2em]'>
            system online
          </AsciiBadge>
        </div>
      </header>
      <div className={cardHeaderClass}>
        <span>system status</span>
        <AsciiBadge tone='inverse' variant='curly'>
          live feed
        </AsciiBadge>
      </div>
    </section>
  )
}
