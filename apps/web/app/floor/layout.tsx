import type { Metadata } from 'next'
import type { ReactNode } from 'react'

const FLOOR_TITLE = 'Live Trading Floor'
const FLOOR_DESCRIPTION =
  'Monitor the HL Privateer core fund loop with mode, PnL, open positions, and recent tape.'

export const metadata: Metadata = {
  title: FLOOR_TITLE,
  description: FLOOR_DESCRIPTION,
  alternates: {
    canonical: '/floor',
  },
  openGraph: {
    title: `${FLOOR_TITLE} | [HL] PRIVATEER`,
    description: FLOOR_DESCRIPTION,
    url: 'https://hlprivateer.xyz/floor',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: '[HL] PRIVATEER floor preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${FLOOR_TITLE} | [HL] PRIVATEER`,
    description: FLOOR_DESCRIPTION,
    images: ['/twitter-image.png'],
  },
}

export default function FloorLayout({ children }: { children: ReactNode }) {
  return children
}
