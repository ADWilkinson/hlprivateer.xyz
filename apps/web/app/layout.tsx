import './globals.css'
import { IBM_Plex_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

const terminalFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-hlp-mono',
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning className={`${terminalFont.variable}`}>
      <body
        className={`${terminalFont.className} min-h-screen bg-hlpBg bg-[radial-gradient(circle_at_top,_#F4EEE8_0%,_#F4EEE8_38%,_#0072B5_95%)] text-hlpFg antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
