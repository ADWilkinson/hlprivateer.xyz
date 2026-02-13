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

export const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    REDIS_STREAM_PREFIX: z.string().default('hlp'),

    AGENT_ID: z.string().min(1).default('agent-runner'),
    AGENT_LLM: z.enum(['claude', 'codex', 'none']).default('claude'),
    AGENT_PROPOSAL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    AGENT_ANALYSIS_INTERVAL_MS: z.coerce.number().int().positive().default(60000),

    // Reuse the runtime's strategy config knobs when present.
    BASKET_SYMBOLS: z.string().default('BTC,ETH'),
    BASKET_TARGET_NOTIONAL_USD: z.coerce.number().positive().default(1000),

    // LLM settings
    CLAUDE_MODEL: z.string().default('sonnet'),
    CODEX_MODEL: z.string().default('o3')
  })
  .parse({
    ...process.env,
    REDIS_URL: loadEnvValue('REDIS_URL')
  })

export type AgentRunnerEnv = typeof env

