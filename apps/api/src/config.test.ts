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

  it('refuses to start in production with default secrets', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'replace-me'
    process.env.OPERATOR_LOGIN_SECRET = 'some-operator-secret'
    process.env.X402_VERIFIER_SECRET = 'some-x402-secret'

    vi.resetModules()
    await expect(import('./config')).rejects.toThrow(/production requires JWT_SECRET/)
  })

  it('refuses to start in production when OPERATOR_LOGIN_SECRET is missing', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'some-jwt-secret'
    delete process.env.OPERATOR_LOGIN_SECRET
    process.env.X402_VERIFIER_SECRET = 'some-x402-secret'

    vi.resetModules()
    await expect(import('./config')).rejects.toThrow(/production requires OPERATOR_LOGIN_SECRET/)
  })

  it('refuses to start in production with default X402 verifier secret', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'some-jwt-secret'
    process.env.OPERATOR_LOGIN_SECRET = 'some-operator-secret'
    process.env.X402_VERIFIER_SECRET = 'x402-secret'

    vi.resetModules()
    await expect(import('./config')).rejects.toThrow(/production requires X402_VERIFIER_SECRET/)
  })
})
