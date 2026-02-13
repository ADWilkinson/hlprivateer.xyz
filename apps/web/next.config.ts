import type { NextConfig } from 'next'

const shouldStaticExport = process.env.HLP_STATIC_EXPORT === '1'

const nextConfig: NextConfig = {
  output: shouldStaticExport ? 'export' : 'standalone'
}

export default nextConfig
