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
            __html: `(function(){try{var t=localStorage.getItem("hlp-theme");var next=t==="dark"?"dark":"light";document.documentElement.dataset.theme="light";document.documentElement.classList.remove("dark");document.documentElement.dataset.theme=next;document.documentElement.classList.toggle("dark",next==="dark")}catch(e){document.documentElement.dataset.theme="light";document.documentElement.classList.remove("dark")}})()`,
          }}
        />
      </head>
      <body
        className={`${terminalFont.className} min-h-screen bg-hlpBg dark:bg-hlpBgDark bg-[radial-gradient(circle_at_top,_#F4EEE8_0%,_#FEF3E2_40%,_#FDE6C4_100%)] text-hlpFg transition-colors duration-300 antialiased selection:bg-hlpPositive/25 selection:text-hlpBg dark:bg-[radial-gradient(circle_at_top,_#040728_0%,_#27272A_42%,_#040728_100%)] dark:text-hlpFgDark dark:selection:bg-hlpPositiveDark/30`}
      >
        {children}
      </body>
    </html>
  )
}
