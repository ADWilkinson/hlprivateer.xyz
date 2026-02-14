import { cardClass, cardHeaderClass, panelBodyPad, sectionTitleClass } from './ascii-style'
import { AsciiBadge } from './ascii-kit'

export function FloorHeader() {
  return (
    <section className={cardClass}>
      <header className={`flex flex-wrap items-start justify-between gap-2 border-b border-hlpBorder dark:border-hlpBorderDark ${panelBodyPad}`}>
        <div className='min-w-0 space-y-1'>
          <div className={sectionTitleClass}>LIVE TRADING FLOOR</div>
          <div className='text-[17px] leading-none font-bold tracking-[0.22em]'>[HL] PRIVATEER</div>
        </div>
        <div className='flex w-full items-center justify-end gap-2 sm:w-auto'>
          <AsciiBadge tone='neutral' variant='curly' className='tracking-[0.2em]'>
            system online
          </AsciiBadge>
        </div>
      </header>
      <div className={cardHeaderClass}>
        <span>fleet status</span>
        <AsciiBadge tone='positive' variant='curly'>
          live feed
        </AsciiBadge>
      </div>
    </section>
  )
}
