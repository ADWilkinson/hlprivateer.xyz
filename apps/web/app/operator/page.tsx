'use client'

import { useEffect } from 'react'

export default function OperatorRedirect() {
  useEffect(() => {
    window.location.replace('/')
  }, [])

  return (
    <main className='deck'>
      <pre className='logo'>{'redirecting -> /'}</pre>
    </main>
  )
}
