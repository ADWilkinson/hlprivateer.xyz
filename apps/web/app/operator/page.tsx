'use client'

import { useEffect } from 'react'

export default function OperatorRedirect() {
  useEffect(() => {
    window.location.replace('/#operator')
  }, [])

  return (
    <main className='deck'>
      <pre className='logo'>{'redirecting -> /#operator'}</pre>
    </main>
  )
}

