'use client'

import { useEffect } from 'react'

export default function ReplayRedirect() {
  useEffect(() => {
    window.location.replace('/#replay')
  }, [])

  return (
    <main className='deck'>
      <pre className='logo'>{'redirecting -> /#replay'}</pre>
    </main>
  )
}

