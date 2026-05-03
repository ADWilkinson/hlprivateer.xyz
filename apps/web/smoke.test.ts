import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('web app', () => {
  it('keeps the homepage product-facing and pipeline-led', async () => {
    const page = await readFile('app/page.tsx', 'utf8')
    expect(page).toContain('[HL] Privateer')
    expect(page).toContain('Watch the floor')
    expect(page).toContain('public window')
  })

  it('keeps the animated product demo wired to the AGT/RSK/EXE/OPS loop', async () => {
    const demo = await readFile('app/ui/ProductPipelineDemo.tsx', 'utf8')
    expect(demo).toContain('market window')
    expect(demo).toContain('agent estimate')
    expect(demo).toContain('risk checks')
    expect(demo).toContain('public floor tape')
    expect(demo).toContain('AGT')
    expect(demo).toContain('RSK')
    expect(demo).toContain('EXE')
    expect(demo).toContain('OPS')
  })
})
