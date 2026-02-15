import { panelRadius } from './ascii-style'
import { AsciiBadge } from './ascii-kit'

type FloorHeaderProps = {
  onX402Access?: () => void
}

const ASCII_TEXTURE = `  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +
+  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .
  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +
+  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .
  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +
+  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .
  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +
+  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .
  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +  .  +`

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
    <section className={`relative overflow-hidden ${panelRadius} border border-hlpBorder bg-hlpInverseBg animate-hlp-fade-up`}>
      <div className='absolute inset-0 overflow-hidden pointer-events-none select-none' aria-hidden='true'>
        <pre className='text-[10px] leading-[1.6] text-hlpPanel/[0.035] whitespace-pre font-mono'>
          {ASCII_TEXTURE}
        </pre>
      </div>

      <div className='relative z-10 px-4 py-5 sm:px-6 sm:py-7 md:px-8 md:py-8'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div className='min-w-0 space-y-2'>
            <div className='text-[10px] uppercase tracking-[0.3em] text-hlpPanel/40'>
              LIVE TRADING FLOOR
            </div>
            <h1 className='text-[26px] sm:text-[34px] md:text-[42px] font-bold tracking-[0.14em] text-hlpPanel leading-none'>
              [HL] PRIVATEER
            </h1>
            <div className='text-[10px] sm:text-[11px] tracking-[0.1em] text-hlpPanel/35 max-w-md'>
              Discretionary Long/Short + Pair-Strategy Floor / x402 Integration Access
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <a
              href='#x402-access'
              onClick={handleX402AccessClick}
              className='inline-flex items-center'
            >
              <AsciiBadge tone='inverse' variant='curly' className='tracking-[0.2em] border-hlpPanel/20 text-hlpPanel/70 hover:text-hlpPanel transition-colors'>
                x402 access
              </AsciiBadge>
            </a>
            <AsciiBadge tone='inverse' variant='curly' className='tracking-[0.2em] border-hlpPanel/20 text-hlpPanel/70'>
              system online
            </AsciiBadge>
          </div>
        </div>

        <div className='mt-5 text-[10px] tracking-[0.35em] text-hlpPanel/[0.08] select-none overflow-hidden whitespace-nowrap'>
          ~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~\u00B7~
        </div>
      </div>
    </section>
  )
}
