import fs from 'node:fs'
import { z } from 'zod'

function readSecretFromFile(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) {
    throw new Error(`empty secret file: ${filePath}`)
  }

  return raw
}

function loadEnvValue(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const filePath = env[`${name}_FILE`]
  if (filePath) {
    return readSecretFromFile(filePath)
  }

  return env[name]
}

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
      return false
    }
  }

  return value
}, z.boolean())

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  API_BASE_URL: z.string().url().default('http://127.0.0.1:4000'),
  DATABASE_URL: z.string().default('postgres://localhost:5432/hlprivateer'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_STREAM_PREFIX: z.string().default('hlp'),
  JWT_SECRET: z.string().default('replace-me'),
  OPERATOR_LOGIN_SECRET: z.string().optional(),
  OPERATOR_MFA_REQUIRED: booleanFromEnv.default(true),
  OPERATOR_ADMIN_USERS: z.string().default('admin@local'),
  X402_ENABLED: booleanFromEnv.default(true),
  X402_PROVIDER: z.enum(['mock', 'facilitator']).default('mock'),
  X402_VERIFIER_SECRET: z.string().default('x402-secret'),
  X402_FACILITATOR_URL: z.string().url().default('https://x402.org/facilitator'),
  X402_NETWORK: z.string().default('eip155:84532'),
  X402_PAYTO: z.string().optional(),
  X402_PRICE_STREAM_SNAPSHOT: z.string().default('$0.001'),
  X402_PRICE_ANALYSIS_LATEST: z.string().default('$0.005'),
  X402_PRICE_ANALYSIS_HISTORY: z.string().default('$0.01'),
  X402_PRICE_POSITIONS: z.string().default('$0.01'),
  X402_PRICE_ORDERS: z.string().default('$0.01'),
  RISK_MAX_LEVERAGE: z.coerce.number().default(2),
  RISK_MAX_DRAWDOWN_PCT: z.coerce.number().default(5),
  RISK_MAX_NOTIONAL_USD: z.coerce.number().default(10_000),
  RISK_MAX_SLIPPAGE_BPS: z.coerce.number().default(20),
  RISK_STALE_DATA_MS: z.coerce.number().default(3_000),
  RISK_LIQUIDITY_BUFFER_PCT: z.coerce.number().default(1.1),
  RISK_NOTIONAL_PARITY_TOLERANCE: z.coerce.number().default(0.015),
  API_RATE_LIMIT_MAX: z.coerce.number().default(120),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000)
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.parse({
  ...process.env,
  DATABASE_URL: loadEnvValue('DATABASE_URL'),
  REDIS_URL: loadEnvValue('REDIS_URL'),
  JWT_SECRET: loadEnvValue('JWT_SECRET'),
  OPERATOR_LOGIN_SECRET: loadEnvValue('OPERATOR_LOGIN_SECRET'),
  X402_VERIFIER_SECRET: loadEnvValue('X402_VERIFIER_SECRET')
})

// Keep x402 "mock" as a dev-only mode. Production should always run real facilitator-backed payments.
if (parsed.NODE_ENV === 'production') {
  if (!parsed.X402_ENABLED) {
    throw new Error('production requires X402_ENABLED=true')
  }

  if (parsed.X402_PROVIDER !== 'facilitator') {
    throw new Error('production requires X402_PROVIDER=facilitator (mock is dev-only)')
  }
}

if (parsed.X402_PROVIDER === 'facilitator') {
  if (!parsed.X402_ENABLED) {
    throw new Error('X402_PROVIDER=facilitator requires X402_ENABLED=true')
  }

  const payTo = parsed.X402_PAYTO?.trim()
  if (!payTo) {
    throw new Error('X402_PROVIDER=facilitator requires X402_PAYTO (merchant receiving address)')
  }
}

export const env = parsed
