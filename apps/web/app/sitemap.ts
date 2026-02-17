import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

const ROUTES = [
  '/',
  '/floor',
  '/llms.txt',
  '/AGENT.md',
  '/API.md',
  '/skills.md',
  '/docs/SPEC.md',
  '/docs/X402_SELLER_QUICKSTART.md',
  '/.well-known/agents.json',
  '/skills/SKILL.md',
  '/skills/agents.json',
  '/skills/hl-privateer.md',
  '/skills/llms.txt',
  '/skills/api.md',
  '/skills/x402.md',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return ROUTES.map((path) => ({
    url: `https://hlprivateer.xyz${path}`,
    lastModified,
    changeFrequency: path === '/floor' ? 'hourly' : 'daily',
    priority: path === '/' ? 1 : path === '/floor' ? 0.9 : 0.7,
  }))
}
