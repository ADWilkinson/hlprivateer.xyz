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

export const runtimeEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    REDIS_STREAM_PREFIX: z.string().default('hlp'),
    CYCLE_MS: z.coerce.number().default(5000),
    DRY_RUN: z.coerce.boolean().default(true),
    DATABASE_URL: z.string().optional(),
    HL_WS_URL: z.string().optional(),
    RISK_MAX_LEVERAGE: z.coerce.number().default(2),
    RISK_MAX_DRAWDOWN_PCT: z.coerce.number().default(5),
    RISK_MAX_SLIPPAGE_BPS: z.coerce.number().default(20),
    RISK_MAX_NOTIONAL_USD: z.coerce.number().default(10000),
    RISK_STALE_DATA_MS: z.coerce.number().default(3000),
    RISK_LIQUIDITY_BUFFER_PCT: z.coerce.number().default(1.1),
    RISK_NOTIONAL_PARITY_TOLERANCE: z.coerce.number().default(0.015),
    ACCOUNT_VALUE_USD: z.coerce.number().default(10000),
    BASKET_SYMBOLS: z.string().default('BTC,ETH'),
    BASKET_TARGET_NOTIONAL_USD: z.coerce.number().default(1000),
    RUNTIME_METRICS_PORT: z.coerce.number().default(9400),
    ENABLE_LIVE_OMS: z.coerce.boolean().default(false),
    LIVE_OMS_API_URL: z.string().optional(),
    LIVE_OMS_API_KEY: z.string().optional()
  })
  .parse({
    ...process.env,
    DATABASE_URL: loadEnvValue('DATABASE_URL'),
    HL_WS_URL: loadEnvValue('HL_WS_URL'),
    LIVE_OMS_API_KEY: loadEnvValue('LIVE_OMS_API_KEY')
  })

export type RuntimeEnv = typeof runtimeEnv
