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
    // Global/default LLM choice for all internal agents.
    AGENT_LLM: z.enum(['claude', 'codex', 'none']).default('codex'),
    // Optional per-role overrides (defaults to AGENT_LLM).
    AGENT_RESEARCH_LLM: z.enum(['claude', 'codex', 'none']).optional(),
    AGENT_RISK_LLM: z.enum(['claude', 'codex', 'none']).optional(),
    AGENT_STRATEGIST_LLM: z.enum(['claude', 'codex', 'none']).optional(),
    AGENT_SCRIBE_LLM: z.enum(['claude', 'codex', 'none']).optional(),
    AGENT_PROPOSAL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    AGENT_ANALYSIS_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
    AGENT_RESEARCH_INTERVAL_MS: z.coerce.number().int().positive().default(180000),
    AGENT_RISK_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    AGENT_OPS_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    OPS_AUTO_HALT: booleanFromEnv.default(false),

    // Reuse the runtime's strategy config knobs when present.
    BASKET_SYMBOLS: z.string().default('BTC,ETH'),
    BASKET_TARGET_NOTIONAL_USD: z.coerce.number().positive().default(1000),

    // Hyperliquid info endpoint for universe selection.
    HL_INFO_URL: z.string().default('https://api.hyperliquid.xyz/info'),

    // Agent uses these to mark proposals as LIVE when the runtime is live.
    DRY_RUN: booleanFromEnv.default(true),
    ENABLE_LIVE_OMS: booleanFromEnv.default(false),

    // Basket selection (dynamic basket against HYPE).
    AGENT_BASKET_SIZE: z.coerce.number().int().min(1).max(12).default(3),
    AGENT_BASKET_CANDIDATE_LIMIT: z.coerce.number().int().min(10).max(120).default(40),
    AGENT_BASKET_REFRESH_MS: z.coerce.number().int().positive().default(30 * 60_000),

    // Basket feature extraction (historical + external metrics).
    AGENT_FEATURE_WINDOW_MIN: z.coerce.number().int().min(30).max(720).default(240),
    AGENT_FEATURE_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(6),

    // CoinGecko Pro (optional) for spot/sector context.
    COINGECKO_API_KEY: z.string().optional(),
    COINGECKO_BASE_URL: z.string().default('https://pro-api.coingecko.com/api/v3'),
    COINGECKO_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

    // LLM settings
    // Claude model name passed to the `claude` CLI.
    CLAUDE_MODEL: z.string().default('opus'),
    // Codex model name passed to the `codex` CLI.
    CODEX_MODEL: z.string().default('gpt-5.3-codex-spark'),
    // Passed via `codex exec -c model_reasoning_effort="..."`.
    CODEX_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh']).default('xhigh')
  })
  .parse({
    ...process.env,
    REDIS_URL: loadEnvValue('REDIS_URL')
  })

export type AgentRunnerEnv = typeof env
