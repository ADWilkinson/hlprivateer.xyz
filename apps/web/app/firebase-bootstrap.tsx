'use client'

import { useEffect } from 'react'
import { initializeFirebaseAnalytics } from '../lib/firebase'

export default function FirebaseBootstrap() {
  useEffect(() => {
    void initializeFirebaseAnalytics()
  }, [])

  return null
}
