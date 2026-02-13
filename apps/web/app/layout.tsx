import './globals.css'
import type { ReactNode } from 'react'
import FirebaseBootstrap from './firebase-bootstrap'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <body style={{ margin: 0, background: '#0b1020', color: '#d8e1ff', fontFamily: 'monospace' }}>
        <FirebaseBootstrap />
        {children}
      </body>
    </html>
  )
}
