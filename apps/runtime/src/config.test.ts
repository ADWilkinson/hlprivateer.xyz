import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('runtime config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads runtime secrets from _FILE values', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'hlp-runtime-env-'))
    const secretPath = path.join(tempDir, 'database.url')
    writeFileSync(secretPath, 'postgres://from-file')

    process.env.DATABASE_URL_FILE = secretPath
    process.env.DATABASE_URL = 'postgres://from-env'

    vi.resetModules()
    const { runtimeEnv } = await import('./config')

    expect(runtimeEnv.DATABASE_URL).toBe('postgres://from-file')
  })
})
