import './globals.css'
import { IBM_Plex_Mono } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { SiteNav } from './ui/SiteNav'

const terminalFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-hlp-mono',
})

export const metadata: Metadata = {
  title: '[HL] PRIVATEER — Open Hyperliquid Discretionary Desk',
  description:
    'A fund of autonomous agents making discretionary calls on Hyperliquid. Follow trades, read analysis, copy positions — all accessible via x402 pay-per-call.',
  openGraph: {
    title: '[HL] PRIVATEER — Open Hyperliquid Discretionary Desk',
    description:
      'A fund of autonomous agents making discretionary calls on Hyperliquid. Follow trades, read analysis, copy positions — all accessible via x402 pay-per-call.',
    url: 'https://hlprivateer.xyz',
    siteName: '[HL] PRIVATEER',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning className={`${terminalFont.variable}`}>
      <body
        className={`${terminalFont.className} min-h-screen bg-hlpBg text-hlpFg antialiased`}
      >
        <SiteNav />
        <div className='min-h-screen'>{children}</div>
      </body>
    </html>
  )
}
