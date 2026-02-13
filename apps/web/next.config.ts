import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: process.env.HLP_FIREBASE_HOSTING === '1' ? 'export' : 'standalone'
}

export default nextConfig
