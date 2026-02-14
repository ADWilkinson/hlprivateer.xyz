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
- `AGENT_PROPOSAL_INTERVAL_MS` (default 30000)
- `AGENT_ANALYSIS_INTERVAL_MS` (default 60000)
- `AGENT_RESEARCH_INTERVAL_MS` (default 180000)
- `AGENT_RISK_INTERVAL_MS` (default 30000)
- `AGENT_OPS_INTERVAL_MS` (default 5000)
- `OPS_AUTO_HALT` (default false; when true, ops-agent may publish `/halt` on severe stale data)

Strategy knobs (shared with runtime):
- `BASKET_TARGET_NOTIONAL_USD`
- `DRY_RUN`, `ENABLE_LIVE_OMS` (used by the agent-runner to mark proposals as `requestedMode=LIVE` when live is enabled)

Basket selection (dynamic short basket vs HYPE):
- `AGENT_BASKET_SIZE`
- `AGENT_BASKET_CANDIDATE_LIMIT`
- `AGENT_BASKET_REFRESH_MS` (basket can only refresh when flat)
- `AGENT_FEATURE_WINDOW_MIN`, `AGENT_FEATURE_CONCURRENCY`
- Optional spot/sector enrichment: `COINGECKO_API_KEY`, `COINGECKO_BASE_URL`, `COINGECKO_TIMEOUT_MS`

Legacy / seed:
- `BASKET_SYMBOLS` (CSV) is a seed only; runtime trade entry is agent-driven and will not open new exposure from this env var.

LLM:
- `AGENT_LLM=claude|codex|none`
- Optional per-role overrides:
  - `AGENT_RESEARCH_LLM=claude|codex|none`
  - `AGENT_RISK_LLM=claude|codex|none`
  - `AGENT_STRATEGIST_LLM=claude|codex|none`
  - `AGENT_SCRIBE_LLM=claude|codex|none`
- `CLAUDE_MODEL` (default `opus`)
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

This is designed to be non-interactive automation. If Codex fails (missing binary, auth, transient error), the runner retries via Claude (Opus) and emits a floor-tape warning; if Claude also fails, it falls back to deterministic output.

## Development Workflow
1. Run the stack locally in SIM:
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

4. Iterate safely:
- Keep runtime in `DRY_RUN=true` until the proposal+execution loop is stable.
- Remember: the runtime is the only component that can execute orders, and it is still hard-gated by the risk engine.
