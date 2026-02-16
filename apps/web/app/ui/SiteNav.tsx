'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/', label: 'DESK' },
  { href: '/floor', label: 'FLOOR' },
  { href: '/identity', label: 'IDENTITY' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/' || pathname === ''
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteNav() {
  const pathname = usePathname()

  return (
    <header className='relative z-20 border-b border-hlpBorder bg-hlpSurface/90 backdrop-blur-sm'>
      <div className='mx-auto flex w-full max-w-[1300px] items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:px-6'>
        <Link href='/' className='font-bold tracking-[0.22em] text-[12px] uppercase'>
          <span className='text-hlpDim'>[HL]</span>
          <span className='text-hlpFg'> PRIVATEER</span>
        </Link>

        <nav aria-label='Primary' className='flex flex-wrap items-center gap-1'>
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href)
            return (
              <Link
                key={link.label}
                href={link.href}
                className={`inline-flex h-8 items-center border border-hlpBorder px-3 py-1 text-[9px] uppercase tracking-[0.16em] transition-colors ${
                  active
                    ? 'bg-hlpInverseBg text-hlpPanel'
                    : 'bg-hlpPanel text-hlpMuted hover:bg-hlpSurface hover:text-hlpFg'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
