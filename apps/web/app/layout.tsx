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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("hlp-theme");var prefers=window.matchMedia("(prefers-color-scheme:dark)").matches;var next=t==="light"?"light":t==="dark"?"dark":prefers?"dark":"light";document.documentElement.dataset.theme=next;document.documentElement.classList.toggle("dark",next==="dark")}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.classList.add("dark")}})()`,
          }}
        />
      </head>
      <body
        className={`${terminalFont.className} min-h-screen bg-hlpBg dark:bg-hlpBgDark bg-[radial-gradient(circle_at_top,_#f3f0ea_0%,_#ebe2d4_40%,_#f3efe7_100%)] text-hlpFg transition-colors duration-300 antialiased selection:bg-hlpPositive/25 selection:text-hlpBg dark:bg-[radial-gradient(circle_at_top,_#0a1018_0%,_#101926_42%,_#0a1018_100%)] dark:text-hlpFgDark dark:selection:bg-hlpPositiveDark/30`}
      >
        {children}
      </body>
    </html>
  )
}
