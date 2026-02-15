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

const X402_MIN_PRICE_USD = 0.01
const x402PricePattern = /^\$?(?:\d+(?:\.\d+)?|\.\d+)$/
const x402PriceSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!x402PricePattern.test(value)) {
      return false
    }

    const amount = value.startsWith('$') ? value.slice(1) : value
    const numericValue = Number.parseFloat(amount)
    return Number.isFinite(numericValue) && numericValue >= X402_MIN_PRICE_USD
  }, {
    message: 'x402 route price must be at least $0.01',
  })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
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
  X402_PRICE_STREAM_SNAPSHOT: x402PriceSchema.default('$0.01'),
  X402_PRICE_ANALYSIS_LATEST: x402PriceSchema.default('$0.01'),
  X402_PRICE_ANALYSIS_HISTORY: z.string().default('$0.01'),
  X402_PRICE_POSITIONS: z.string().default('$0.01'),
  X402_PRICE_ORDERS: z.string().default('$0.01'),
  X402_PRICE_MARKET_DATA: z.string().default('$0.02'),
  X402_PRICE_AGENT_INSIGHTS: z.string().default('$0.02'),
  X402_PRICE_COPY_TRADE_SIGNALS: z.string().default('$0.03'),
  X402_PRICE_COPY_TRADE_POSITIONS: z.string().default('$0.03'),
  RISK_MAX_LEVERAGE: z.coerce.number().default(20),
  RISK_MAX_DRAWDOWN_PCT: z.coerce.number().default(20),
  RISK_MAX_NOTIONAL_USD: z.coerce.number().default(50_000),
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

const DEFAULT_JWT_SECRET = "replace-me"
const DEFAULT_X402_VERIFIER_SECRET = "x402-secret"

function assertSafeProductionSecrets(env: Env) {
  if (env.NODE_ENV !== "production") return

  const jwt = env.JWT_SECRET?.trim()
  if (!jwt || jwt === DEFAULT_JWT_SECRET) {
    throw new Error("production requires JWT_SECRET (do not use default \"replace-me\")")
  }

  const operatorLogin = env.OPERATOR_LOGIN_SECRET?.trim()
  if (!operatorLogin || operatorLogin === DEFAULT_JWT_SECRET) {
    throw new Error("production requires OPERATOR_LOGIN_SECRET (do not use default/empty)")
  }

  const x402Verifier = env.X402_VERIFIER_SECRET?.trim()
  if (!x402Verifier || x402Verifier === DEFAULT_X402_VERIFIER_SECRET) {
    throw new Error("production requires X402_VERIFIER_SECRET (do not use default \"x402-secret\")")
  }
}

// Keep x402 "mock" as a dev-only mode. Production should always run real facilitator-backed payments.
if (parsed.NODE_ENV === 'production') {
  assertSafeProductionSecrets(parsed)

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
