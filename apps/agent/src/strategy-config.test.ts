import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStrategy } from './strategy-config'

async function tmpFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hlp-v3-strategy-'))
  const path = join(dir, 'strategy.json')
  await writeFile(path, content)
  return path
}

describe('loadStrategy', () => {
  it('returns full defaults when no file exists', async () => {
    const s = await loadStrategy({ path: '/nonexistent/path/strategy.json' })
    expect(s.risk.kellyCap).toBeCloseTo(0.25)
    expect(s.prompts.strategist).toBeUndefined()
  })

  it('parses an explicit file and merges defaults for missing keys', async () => {
    const path = await tmpFile(JSON.stringify({
      risk: { kellyCap: 0.1 },
      prompts: { strategist: 'You are a careful strategist.' }
    }))
    const s = await loadStrategy({ path })
    expect(s.risk.kellyCap).toBeCloseTo(0.1)
    expect(s.risk.minEdgeBps).toBe(200)
    expect(s.prompts.strategist).toBe('You are a careful strategist.')
  })

  it('rejects an invalid value at parse time', async () => {
    const path = await tmpFile(JSON.stringify({ risk: { kellyCap: 5 } }))
    await expect(loadStrategy({ path })).rejects.toThrow()
  })

  it('honours STRATEGY_CONFIG_PATH env var', async () => {
    const path = await tmpFile(JSON.stringify({ risk: { kellyCap: 0.05 } }))
    const prev = process.env.STRATEGY_CONFIG_PATH
    process.env.STRATEGY_CONFIG_PATH = path
    try {
      const s = await loadStrategy()
      expect(s.risk.kellyCap).toBeCloseTo(0.05)
    } finally {
      if (prev === undefined) delete process.env.STRATEGY_CONFIG_PATH
      else process.env.STRATEGY_CONFIG_PATH = prev
    }
  })
})
