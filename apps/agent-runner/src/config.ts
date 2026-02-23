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

const resolvedGitHubJournalBranch = loadEnvValue('GITHUB_JOURNAL_BRANCH') ?? loadEnvValue('GITHUB_REPO_BRANCH')

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

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
    // Per-role Claude model overrides (defaults to CLAUDE_MODEL).
    AGENT_RESEARCH_CLAUDE_MODEL: z.string().optional(),
    AGENT_RISK_CLAUDE_MODEL: z.string().optional(),
    AGENT_STRATEGIST_CLAUDE_MODEL: z.string().optional(),
    AGENT_SCRIBE_CLAUDE_MODEL: z.string().optional(),
    // Per-role Codex model overrides (defaults to CODEX_MODEL).
    AGENT_RESEARCH_CODEX_MODEL: z.string().optional(),
    AGENT_RISK_CODEX_MODEL: z.string().optional(),
    AGENT_STRATEGIST_CODEX_MODEL: z.string().optional(),
    AGENT_SCRIBE_CODEX_MODEL: z.string().optional(),
    // Per-role reasoning effort overrides (defaults to CODEX_REASONING_EFFORT).
    AGENT_RESEARCH_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    AGENT_RISK_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    AGENT_STRATEGIST_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    AGENT_SCRIBE_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    // Per-role LLM command timeouts (ms) for each internal agent invocation.
    AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
    AGENT_RESEARCH_LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    AGENT_RISK_LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    AGENT_STRATEGIST_LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    AGENT_SCRIBE_LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    AGENT_PIPELINE_BASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60_000)
      .transform((value) => clamp(Math.trunc(value), 300_000, 3_600_000)),
    AGENT_OPS_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
    OPS_AUTO_HALT: booleanFromEnv.default(false),
    AGENT_MIN_REBALANCE_LEG_USD: z.coerce.number().nonnegative().default(25),
    AGENT_TARGET_NOTIONAL_USD: z.coerce.number().positive().default(100),
    RISK_MAX_LEVERAGE: z.coerce.number().positive().default(20),
    RISK_MAX_DRAWDOWN_PCT: z.coerce.number().positive().default(100),
    RISK_MAX_NOTIONAL_USD: z.coerce.number().positive().default(50000),
    RISK_MAX_SLIPPAGE_BPS: z.coerce.number().positive().default(20),
    RISK_STALE_DATA_MS: z.coerce.number().positive().default(3000),
    RISK_LIQUIDITY_BUFFER_PCT: z.coerce.number().positive().default(1.1),
    // Keep "flat" semantics consistent with runtime (dust positions should not trap recovery loops).
    RUNTIME_FLAT_DUST_NOTIONAL_USD: z.coerce
      .number()
      .nonnegative()
      .default(100)
      .transform((value) => Math.max(100, value)),

    // Optional local data-source tooling.
    OPENCLAW_HOME: z.string().default('/home/dappnode/.openclaw/workspace'),
    OPENCLAW_MARKET_DATA_PATH: z.string().default('/home/dappnode/.openclaw/workspace/skills/market-data/market-data.js'),
    OPENCLAW_TWITTER_CREDS_PATH: z.string().default('/home/dappnode/.openclaw/workspace/.twitter_creds.json'),
    AGENT_INTEL_ENABLED: booleanFromEnv.default(true),
    AGENT_INTEL_MIN_REFRESH_MS: z.coerce.number().int().min(0).max(6 * 60 * 60_000).default(10 * 60_000),
    AGENT_INTEL_TWITTER_ENABLED: booleanFromEnv.default(true),
    AGENT_INTEL_TWITTER_MAX_RESULTS: z.coerce.number().int().min(10).max(100).default(10),
    AGENT_INTEL_TWITTER_MAX_QUERIES: z.coerce.number().int().min(1).max(20).default(8),
    AGENT_INTEL_TWITTER_COOLDOWN_MS: z.coerce.number().int().min(0).max(60 * 60_000).default(5 * 60_000),
    AGENT_INTEL_TWITTER_CACHE_TTL_MS: z.coerce.number().int().min(0).max(60 * 60_000).default(10 * 60_000),
    AGENT_INTEL_TWITTER_MIN_LIKES: z.coerce.number().int().min(0).max(100).default(3),
    AGENT_INTEL_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    AGENT_INTEL_HISTORY_MAX_ENTRIES: z.coerce.number().int().min(20).max(20_000).default(2_000),
    DEFI_LLAMA_ENABLED: booleanFromEnv.default(true),
    DEFI_LLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
    DEFI_LLAMA_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(5 * 60_000),
    TWITTER_BEARER_TOKEN: z.string().default(''),
    BRAVE_API_KEY: z.string().default(''),
    BRAVE_API_URL: z.string().default('https://api.search.brave.com/res/v1/web/search'),

    // Hyperliquid info endpoint for universe selection.
    HL_INFO_URL: z.string().default('https://api.hyperliquid.xyz/info'),

    // Fixed basket override: comma-separated symbols (e.g. "BTC,ETH,HYPE").
    // When set, skips LLM universe selection and trades only these symbols.
    BASKET_SYMBOLS: z.string().default(''),

    // Agent uses these to mark proposals as LIVE when the runtime is live.
    DRY_RUN: booleanFromEnv.default(false),
    ENABLE_LIVE_OMS: booleanFromEnv.default(false),

    // Strategy universe controls (discretionary long/short candidate selection).
    AGENT_UNIVERSE_SIZE: z.coerce.number().int().min(1).max(100).default(50),
    // Keep candidate universe broad by default so the LLM can see the full tradable space.
    AGENT_UNIVERSE_CANDIDATE_LIMIT: z.coerce.number().int().min(10).max(500).default(240),
    AGENT_UNIVERSE_REFRESH_MS: z.coerce.number().int().positive().default(3 * 60 * 60_000),

    // Basket feature extraction (historical + external metrics).
    AGENT_FEATURE_WINDOW_MIN: z.coerce.number().int().min(30).max(720).default(240),
    AGENT_FEATURE_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(6),

    // Operational observability and journaling.
    AGENT_JOURNAL_ENABLED: booleanFromEnv.default(true),
    AGENT_JOURNAL_PATH: z.string().default('journals'),
    AGENT_GITHUB_JOURNAL_ENABLED: booleanFromEnv.default(false),
    AGENT_GITHUB_JOURNAL_PATH: z.string().default('journals'),
    AGENT_GITHUB_JOURNAL_FLUSH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0),
    GITHUB_TOKEN: z.string().default(''),
    GITHUB_REPO_OWNER: z.string().default(''),
    GITHUB_REPO_NAME: z.string().default(''),
    GITHUB_JOURNAL_BRANCH: z.string().default('main'),
    GITHUB_API_URL: z.string().default('https://api.github.com'),
    GITHUB_JOURNAL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    // Discord webhook monitoring for important/high signal events.
    DISCORD_WEBHOOK_URL: z.string().default(''),
    DISCORD_WEBHOOK_ENABLED: booleanFromEnv.default(false),
    DISCORD_WEBHOOK_ACTIONS: z.string().default(
      'analysis.report,agent.error,agent.proposal,agent.proposal.invalid,research.report,risk.report,risk.decision,intel.refresh,strategist.directive,universe.selected'
    ),
    DISCORD_WEBHOOK_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),
    DISCORD_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_API_KEY_FILE: z.string().optional(),
    OPENAI_API_BASE_URL: z.string().optional(),
    OPENAI_ORG_ID: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY_FILE: z.string().optional(),
    CLAUDE_CODE_API_KEY: z.string().optional(),
    CLAUDE_CODE_API_KEY_FILE: z.string().optional(),

    // aixbt signal intelligence (optional).
    AIXBT_API_KEY: z.string().default(''),
    AIXBT_ENABLED: booleanFromEnv.default(true),
    AIXBT_INDIGO_ENABLED: booleanFromEnv.default(true),
    AIXBT_INDIGO_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(6 * 60 * 60_000).default(30 * 60_000),
    AIXBT_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    AIXBT_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(15 * 60_000),
    AIXBT_MOMENTUM_PROJECT_LIMIT: z.coerce.number().int().min(1).max(10).default(3),

    // CoinGecko Pro (optional) for spot/sector context.
    COINGECKO_API_KEY: z.string().optional(),
    COINGECKO_BASE_URL: z.string().default('https://pro-api.coingecko.com/api/v3'),
    COINGECKO_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

    // LLM settings
    // Claude model name passed to the `claude` CLI.
    CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
    // Codex model name passed to the `codex` CLI.
    CODEX_MODEL: z.string().default('gpt-5.3-codex-spark'),
    // Passed via `codex exec -c model_reasoning_effort="..."`.
    CODEX_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh']).default('xhigh')
  })
  .parse({
    ...process.env,
    GITHUB_JOURNAL_BRANCH: resolvedGitHubJournalBranch,
    REDIS_URL: loadEnvValue('REDIS_URL'),
    AIXBT_API_KEY: loadEnvValue('AIXBT_API_KEY'),
    TWITTER_BEARER_TOKEN: loadEnvValue('TWITTER_BEARER_TOKEN'),
    OPENAI_API_KEY: loadEnvValue('OPENAI_API_KEY'),
    ANTHROPIC_API_KEY: loadEnvValue('ANTHROPIC_API_KEY'),
    CLAUDE_CODE_API_KEY: loadEnvValue('CLAUDE_CODE_API_KEY')
  })

export type AgentRunnerEnv = typeof env
