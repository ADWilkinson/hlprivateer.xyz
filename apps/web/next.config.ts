import type { NextConfig } from 'next'

const shouldStaticExport =
  process.env.HLP_STATIC_EXPORT === '1' ||
  // Backwards-compatible flag (deprecated): originally used for Firebase Hosting static export.
  process.env.HLP_FIREBASE_HOSTING === '1'

const nextConfig: NextConfig = {
  output: shouldStaticExport ? 'export' : 'standalone'
}

export default nextConfig
