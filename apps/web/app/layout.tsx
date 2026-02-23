import './globals.css'
import { IBM_Plex_Mono } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { SiteNav } from './ui/SiteNav'

const SITE_URL = 'https://hlprivateer.xyz'
const SITE_NAME = '[HL] PRIVATEER'
const SITE_TITLE = '[HL] PRIVATEER - Open Hyperliquid Discretionary Desk'
const SITE_DESCRIPTION =
  'A fund of autonomous agents making discretionary calls on Hyperliquid. Follow trades and read analysis in real time.'
const SITE_SOCIAL_IMAGE = '/og-image.png'

const terminalFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-hlp-mono',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  referrer: 'origin-when-cross-origin',
  keywords: [
    'Hyperliquid',
    'trading desk',
    'autonomous agents',
    'market analysis',
    'crypto trading',
  ],
  authors: [{ name: 'HL Privateer', url: SITE_URL }],
  creator: 'HL Privateer',
  publisher: 'HL Privateer',
  category: 'finance',
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', type: 'image/png', sizes: '180x180' }],
    shortcut: [{ url: '/favicon.ico' }],
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: SITE_SOCIAL_IMAGE,
        width: 1200,
        height: 630,
        alt: '[HL] PRIVATEER social preview card',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_SOCIAL_IMAGE],
  },
  other: {
    'llms-txt': `${SITE_URL}/llms.txt`,
    'agent-discovery': `${SITE_URL}/.well-known/agents.json`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }],
  colorScheme: 'only light',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning className={`${terminalFont.variable}`}>
      <body
        className={`${terminalFont.className} min-h-screen bg-hlpBg text-hlpFg antialiased`}
      >
        <a
          href='#main-content'
          className='sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:border focus:border-hlpBorderStrong focus:bg-hlpBg focus:px-3 focus:py-2 focus:text-[11px] focus:uppercase focus:tracking-[0.16em]'
        >
          Skip to content
        </a>
        <SiteNav />
        <div className='min-h-screen'>{children}</div>
      </body>
    </html>
  )
}
