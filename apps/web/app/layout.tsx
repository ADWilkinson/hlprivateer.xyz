import './globals.css'
import type { ReactNode } from 'react'
import { IBM_Plex_Mono } from 'next/font/google'

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap'
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' className={ibmPlexMono.variable}>
      <body className='hlp-body'>{children}</body>
    </html>
  )
}
