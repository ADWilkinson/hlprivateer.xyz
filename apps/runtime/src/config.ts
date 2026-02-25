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

export const runtimeEnv = z
  .object({
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    REDIS_STREAM_PREFIX: z.string().default('hlp'),
    CYCLE_MS: z.coerce.number().default(5000),
    DRY_RUN: booleanFromEnv.default(false),
    DATABASE_URL: z.string().optional(),
    HL_INFO_URL: z.string().optional(),
    HL_IS_TESTNET: booleanFromEnv.default(false),
    HL_API_URL: z.string().optional(),
    HL_PRIVATE_KEY: z.string().optional(),
    HL_REQUEST_TIMEOUT_MS: z.coerce.number().default(10_000),
    RISK_MAX_LEVERAGE: z.coerce.number().default(10),
    // Preferred leverage target used by agent layers for sizing (runtime still enforces max leverage as a hard cap).
    RISK_TARGET_LEVERAGE: z.coerce.number().positive().default(10),
    RISK_MAX_DRAWDOWN_PCT: z.coerce.number().default(100),
    RISK_MAX_SLIPPAGE_BPS: z.coerce.number().default(20),
    RISK_MAX_NOTIONAL_USD: z.coerce.number().default(50000),
    RISK_STALE_DATA_MS: z.coerce.number().default(3000),
    RISK_LIQUIDITY_BUFFER_PCT: z.coerce.number().default(1.1),
    RUNTIME_FLAT_DUST_NOTIONAL_USD: z.coerce
      .number()
      .nonnegative()
      .default(100)
      .transform((value) => Math.max(100, value)),
    // Infra-only risk denies can auto-flatten after sustained outages.
    // Gross gates are operator knobs so this behavior does not depend on hardcoded thresholds.
    RUNTIME_INFRA_AUTO_FLATTEN_MIN_OUTAGE_MS: z.coerce.number().int().nonnegative().default(60 * 60_000),
    RUNTIME_INFRA_AUTO_FLATTEN_NOTICE_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(5 * 60_000),
    RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_USD: z.coerce.number().nonnegative().default(0),
    RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_PCT: z.coerce.number().min(0).max(1).default(0.35),
    // Market-data seed only (runtime trade entry is agent-driven).
    BASKET_SYMBOLS: z.string().default(''),
    RUNTIME_MIN_LIVE_ACCOUNT_VALUE_USD: z.coerce
      .number()
      .positive()
      .default(100)
      .transform((value) => Math.max(100, value)),
    RUNTIME_METRICS_PORT: z.coerce.number().default(9400),
    ENABLE_LIVE_OMS: booleanFromEnv.default(false),
    LIVE_MODE_APPROVED: booleanFromEnv.default(false),
    LIVE_RECONCILE_OPEN_ORDER_MAX_AGE_MS: z.coerce.number().default(60_000),
    // Emergency SL/TP percentages from mark price for SAFE_MODE recovery.
    // Used when a position is detected without exchange-side protection.
    RUNTIME_EMERGENCY_SL_PCT: z.coerce.number().min(0.5).max(50).default(8),
    RUNTIME_EMERGENCY_TP_PCT: z.coerce.number().min(0.5).max(50).default(8)
  })
  .parse({
    ...process.env,
    DATABASE_URL: loadEnvValue('DATABASE_URL'),
    HL_INFO_URL: loadEnvValue('HL_INFO_URL'),
    HL_API_URL: loadEnvValue('HL_API_URL'),
    HL_PRIVATE_KEY: loadEnvValue('HL_PRIVATE_KEY')
  })

export type RuntimeEnv = typeof runtimeEnv
