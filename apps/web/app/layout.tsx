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
    <html lang='en' className={ibmPlexMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('hlp-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light')}catch(e){document.documentElement.setAttribute('data-theme','light')}})()` }} />
      </head>
      <body className='hlp-body'>{children}</body>
    </html>
  )
}
