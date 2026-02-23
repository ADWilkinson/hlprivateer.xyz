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

const LEGACY_X402_PRICE_KEYS = [
  'X402_PRICE_STREAM_SNAPSHOT',
  'X402_PRICE_ANALYSIS_LATEST',
  'X402_PRICE_ANALYSIS_HISTORY',
  'X402_PRICE_POSITIONS',
  'X402_PRICE_ORDERS',
  'X402_PRICE_MARKET_DATA',
  'X402_PRICE_AGENT_INSIGHTS',
  'X402_PRICE_COPY_TRADE_SIGNALS',
  'X402_PRICE_COPY_TRADE_POSITIONS',
]

const resolvedLegacyX402Price = LEGACY_X402_PRICE_KEYS
  .map((key) => loadEnvValue(key))
  .find((value): value is string => typeof value === 'string' && value.trim().length > 0)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
  CDP_API_KEY_ID: z.string().optional(),
  CDP_API_KEY_SECRET: z.string().optional(),
  X402_PRICE_USD: x402PriceSchema.default('$0.01'),
  RISK_MAX_LEVERAGE: z.coerce.number().default(20),
  RISK_MAX_DRAWDOWN_PCT: z.coerce.number().default(20),
  RISK_MAX_NOTIONAL_USD: z.coerce.number().default(50_000),
  RISK_MAX_SLIPPAGE_BPS: z.coerce.number().default(20),
  RISK_STALE_DATA_MS: z.coerce.number().default(3_000),
  RISK_LIQUIDITY_BUFFER_PCT: z.coerce.number().default(1.1),
  API_RATE_LIMIT_MAX: z.coerce.number().default(120),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  ERC8004_ENABLED: booleanFromEnv.default(false),
  ERC8004_CHAIN_ID: z.coerce.number().default(8453),
  ERC8004_AGENT_ID: z.coerce.number().optional(),
  ERC8004_RPC_URL: z.string().default('https://base-mainnet.g.alchemy.com/v2/REDACTED'),
  ERC8004_FEEDBACK_PRIVATE_KEY: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.parse({
  ...process.env,
  DATABASE_URL: loadEnvValue('DATABASE_URL'),
  REDIS_URL: loadEnvValue('REDIS_URL'),
  JWT_SECRET: loadEnvValue('JWT_SECRET'),
  OPERATOR_LOGIN_SECRET: loadEnvValue('OPERATOR_LOGIN_SECRET'),
  X402_VERIFIER_SECRET: loadEnvValue('X402_VERIFIER_SECRET'),
  CDP_API_KEY_ID: loadEnvValue('CDP_API_KEY_ID'),
  CDP_API_KEY_SECRET: loadEnvValue('CDP_API_KEY_SECRET'),
  X402_PRICE_USD: loadEnvValue('X402_PRICE_USD') ?? resolvedLegacyX402Price,
  ERC8004_RPC_URL: loadEnvValue('ERC8004_RPC_URL'),
  ERC8004_FEEDBACK_PRIVATE_KEY: loadEnvValue('ERC8004_FEEDBACK_PRIVATE_KEY'),
})

const DEFAULT_JWT_SECRET = "replace-me"

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
}

if (parsed.NODE_ENV === 'production') {
  assertSafeProductionSecrets(parsed)
}

if (parsed.X402_ENABLED && parsed.X402_PROVIDER === 'facilitator') {
  const payTo = parsed.X402_PAYTO?.trim()
  if (!payTo) {
    throw new Error('X402_PROVIDER=facilitator requires X402_PAYTO (merchant receiving address)')
  }
}

export const env = parsed
