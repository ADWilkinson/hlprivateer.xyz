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
  OPERATOR_MFA_REQUIRED: z.coerce.boolean().default(true),
  OPERATOR_ADMIN_USERS: z.string().default('admin@local'),
  FIREBASE_PROJECT_ID: z.string().default('privateer-xbt'),
  X402_ENABLED: z.coerce.boolean().default(true),
  X402_VERIFIER_SECRET: z.string().default('x402-secret'),
  API_RATE_LIMIT_MAX: z.coerce.number().default(120),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000)
})

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse({
  ...process.env,
  DATABASE_URL: loadEnvValue('DATABASE_URL'),
  REDIS_URL: loadEnvValue('REDIS_URL'),
  JWT_SECRET: loadEnvValue('JWT_SECRET'),
  X402_VERIFIER_SECRET: loadEnvValue('X402_VERIFIER_SECRET')
})
