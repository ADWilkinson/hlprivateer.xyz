import Link from 'next/link'

export function SiteNav() {
  return (
    <header className='relative z-20 border-b border-hlpBorder bg-hlpSurface/90 backdrop-blur-sm'>
      <div className='mx-auto flex w-full max-w-[1300px] items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:px-6'>
        <Link href='/' className='font-bold tracking-[0.22em] text-[12px] uppercase'>
          <span className='text-hlpDim'>[HL]</span>
          <span className='text-hlpFg'> PRIVATEER</span>
        </Link>

        <nav aria-label='Primary' className='flex items-center'>
          <a
            href='https://github.com/ADWilkinson/hlprivateer.xyz'
            target='_blank'
            rel='noreferrer'
            className='inline-flex h-8 items-center border border-hlpBorder bg-hlpPanel px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-hlpMuted transition-colors hover:bg-hlpSurface hover:text-hlpFg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-focused-foreground)]'
          >
            GITHUB
          </a>
        </nav>
      </div>
    </header>
  )
}
