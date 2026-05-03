import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('web app', () => {
  it('keeps the homepage product-facing and pipeline-led', async () => {
    const page = await readFile('app/page.tsx', 'utf8')
    expect(page).toContain('[HL] Privateer')
    expect(page).toContain('Watch the floor')
    expect(page).toContain('public API surface')
  })

  it('keeps the animated product demo wired to the AGT/RSK/EXE/OPS loop', async () => {
    const demo = await readFile('app/ui/ProductPipelineDemo.tsx', 'utf8')
    expect(demo).toContain('sentiment intake')
    expect(demo).toContain('public floor tape')
    expect(demo).toContain('14 fail-closed')
    expect(demo).toContain('AGT')
    expect(demo).toContain('RSK')
    expect(demo).toContain('EXE')
    expect(demo).toContain('OPS')
  })
})
