import './globals.css'
import type { ReactNode } from 'react'
import { Space_Mono } from 'next/font/google'

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap'
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' className={spaceMono.variable}>
      <body className='hlp-body'>{children}</body>
    </html>
  )
}
