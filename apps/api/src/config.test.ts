import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('api config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads secret values from _FILE environment variables', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'hlp-api-env-'))
    const secretPath = path.join(tempDir, 'jwt.secret')
    writeFileSync(secretPath, 'from_file_secret')

    process.env.JWT_SECRET_FILE = secretPath
    process.env.JWT_SECRET = 'should_be_ignored'

    vi.resetModules()
    const { env } = await import('./config')

    expect(env.JWT_SECRET).toBe('from_file_secret')
  })

  it('parses false-like booleans from environment strings', async () => {
    process.env.OPERATOR_MFA_REQUIRED = 'false'
    process.env.X402_ENABLED = 'false'

    vi.resetModules()
    const { env } = await import('./config')

    expect(env.OPERATOR_MFA_REQUIRED).toBe(false)
    expect(env.X402_ENABLED).toBe(false)
  })
})
