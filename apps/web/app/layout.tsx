import './globals.css'
import { IBM_Plex_Mono } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

const terminalFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-hlp-mono',
})

export const metadata: Metadata = {
  title: '[HL] PRIVATEER — Live Trading Floor',
  description:
    'Agentic autonomous HYPE long/short fund with deterministic controls, live telemetry, and x402 integration access.',
  openGraph: {
    title: '[HL] PRIVATEER — Live Trading Floor',
    description:
      'Agentic autonomous HYPE long/short fund with deterministic risk controls, live telemetry, and x402 integration access.',
    url: 'https://hlprivateer.xyz',
    siteName: '[HL] PRIVATEER',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#27272A',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning className={`${terminalFont.variable}`}>
      <body
        className={`${terminalFont.className} min-h-screen bg-hlpBg text-hlpFg antialiased ascii-texture`}
      >
        {children}
      </body>
    </html>
  )
}
