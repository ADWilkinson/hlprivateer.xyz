# Agent Runner (LLM Development Guide)

`apps/agent-runner` is the internal service that turns market + signal context into:
- `StrategyProposal` events (for the runtime to risk-check and execute), and
- human-readable "floor tape" lines for the public UI, and
- structured analysis records written to `hlp.audit.events`.

It can run with:
- `AGENT_LLM=codex` (default; calls the local `codex` CLI, falls back to Claude if Codex fails), or
- `AGENT_LLM=claude` (calls the local `claude` CLI), or
- `AGENT_LLM=none` (no LLM calls; still proposes deterministically).

## Data Flow
Inputs consumed from Redis Streams:
- `hlp.market.normalized` (`MARKET_TICK`): best bid/ask + mid.
- `hlp.plugin.signals`: funding/correlation/volatility signals.
- `hlp.ui.events`:
  - `STATE_UPDATE` (tracks mode)
  - `POSITION_UPDATE` (tracks current exposure)

Outputs published:
- `hlp.strategy.proposals` (`STRATEGY_PROPOSAL`): a `StrategyProposal` matching `packages/contracts`.
- `hlp.ui.events` (`FLOOR_TAPE`): short lines tagged with roles like `scout`, `research`, `strategist`, `execution`, `risk`, `scribe`, `ops`.
- `hlp.audit.events` (`AGENT_ANALYSIS`): structured analysis payload + input context.

## Key Files
- Prompt + proposal assembly: `apps/agent-runner/src/index.ts`
- LLM CLI integration: `apps/agent-runner/src/llm.ts`
- Env schema: `apps/agent-runner/src/config.ts`
- Proposal contract: `packages/contracts/src/index.ts` (`StrategyProposalSchema`)

## Environment Variables
Core:
- `REDIS_URL`, `REDIS_STREAM_PREFIX`
- `AGENT_ID` (default `agent-runner`)
- `AGENT_PIPELINE_BASE_MS` (default 1800000 / 30min; IDLE cadence, clamped [5min, 1h])
- `AGENT_OPS_INTERVAL_MS` (default 3000)
- `OPS_AUTO_HALT` (default false; when true, ops-agent may publish `/halt` on severe stale data)

Strategy knobs (shared with runtime):
- `AGENT_MIN_REBALANCE_LEG_USD` (minimum per-leg execution size in USD)
- `DRY_RUN`, `ENABLE_LIVE_OMS` (used by the agent-runner to mark proposals as `requestedMode=LIVE` when live is enabled)
- `RUNTIME_FLAT_DUST_NOTIONAL_USD` (dust threshold; positions smaller than this are treated as flat to avoid recovery loops)
- `RUNTIME_INFRA_AUTO_FLATTEN_MIN_OUTAGE_MS` (infra-only outage duration before runtime can auto-flatten)
- `RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_USD`, `RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_PCT` (infra auto-flatten exposure gates)

Universe selection:
- `AGENT_UNIVERSE_SIZE`
- `AGENT_UNIVERSE_CANDIDATE_LIMIT`
- `AGENT_UNIVERSE_REFRESH_MS` (universe refresh cadence; strategist may propose a new universe when directive logic requests)
- `AGENT_FEATURE_WINDOW_MIN`, `AGENT_FEATURE_CONCURRENCY`
- Optional spot/sector enrichment: `COINGECKO_API_KEY`, `COINGECKO_BASE_URL`, `COINGECKO_TIMEOUT_MS`

LLM:
- Docker auth mounts (required for non-interactive Claude/Codex):
  - `AGENT_RUNNER_CLAUDE_DIR=/home/bun/.claude`
  - `AGENT_RUNNER_CODEX_DIR=/home/bun/.codex`
  - `AGENT_RUNNER_CLAUDE_CFG_DIR=/home/bun/.config/claude`
  - `CLAUDE_CLI_PATH=/usr/local/bin/claude`
  - `CODEX_CLI_PATH=/usr/local/bin/codex`
- `AGENT_LLM=claude|codex|none`
- `CLAUDE_MODEL` (default `claude-sonnet-4-6`)
- `CODEX_MODEL` (default `gpt-5.3-codex-spark`)
- `CODEX_REASONING_EFFORT` (default `xhigh`)

## Claude CLI Notes
The runner uses the `claude` CLI in structured output mode:
- no session persistence
- strict JSON schema enforcement
- output must contain `structured_output`

If the `claude` binary is missing or not authenticated, the runner falls back to deterministic output and emits a floor-tape warning.

## Codex CLI Notes
The runner uses `codex exec` with:
- `--ephemeral`
- `--sandbox read-only`
- `--output-schema <schema.json>`
- `-c model_reasoning_effort="<effort>"`

This is designed to be non-interactive automation. If Codex fails (missing binary, auth, transient error), the runner retries via Claude and emits a floor-tape warning; if Claude also fails, it falls back to deterministic output.

## Simplified Runtime Defaults
- GitHub journal sync is disabled.
- Discord webhook notifications are disabled.
- External intel refresh (Twitter/AIXBT/DefiLlama) is disabled in the core run path.
- Core loop remains: market context -> research -> risk -> strategy -> proposal publish.

## Development Workflow
1. Run the stack locally in non-live mode:
```bash
cp config/.env.example config/.env
bun install
bun run dev
```

2. Tail the agent-runner logs:
```bash
journalctl -u hlprivateer-agent-runner.service -f --no-pager
```

3. Confirm proposals are being produced:
- Watch the public UI tape, or
- Inspect the audit API (`/v1/operator/audit`) as an operator.

4. Operate in production mode:
- Set `DRY_RUN=false` and `ENABLE_LIVE_OMS=true` only after live-mode controls and risk policy are confirmed.
- Remember: the runtime is the only component that can execute orders, and it is still hard-gated by the risk engine.
