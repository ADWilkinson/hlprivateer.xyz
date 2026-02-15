# Agent Runner - Development Context

## Overview
LLM orchestration service running multi-agent strategy loops. 7 agent roles produce structured proposals published to Redis event bus for runtime consumption. Agents run in a chained pipeline (Research → Risk → Strategist) with adaptive urgency-based scheduling.

## Key Files
```
src/
├── index.ts              # 4000+ line orchestrator: all 7 roles, scheduling, journaling
├── config.ts             # Env schema with per-role LLM overrides, *_FILE secrets
├── llm.ts                # Claude/Codex CLI wrappers for structured output
├── hyperliquid.ts        # Hyperliquid universe metadata + funding + OI
├── coingecko.ts          # Sector breadth, TVL, volume snapshots
├── intel.ts              # Twitter/X narrative velocity via bearer token
├── price-features.ts     # Historical price metrics (returns, vol, momentum)
└── exposure.ts           # Position analysis, flat detection, dust filtering
```

## Agent Roles

| Role | Scheduling | Purpose | LLM |
|------|------------|---------|-----|
| Scout | 1s heartbeat | Tick collection, feed freshness, watchlist | No |
| Research | Pipeline (urgency-driven) | Regime, funding, correlation, social, macro | Yes |
| Risk | Pipeline (urgency-driven) | Posture (GREEN/YELLOW/RED), policy recommendations | Optional |
| Strategist | Pipeline (urgency-driven) | Long/short/pair directives, sizing, horizon | Yes |
| Execution | Event-driven | Transform plans into `StrategyProposal` | Optional |
| Scribe | Event-driven (on new proposal) | Audit narrative, rationale synthesis | Yes |
| Ops | Continuous (3s) | Floor stability, auto-halt, watchdog | No |

## Adaptive Pipeline Scheduling

The strategy pipeline (`runStrategyPipeline`) chains Research → Risk → Strategist in a single pass. A pure-function urgency classifier (`classifyUrgency`) determines the pipeline cadence:

| Level | Interval | Trigger |
|-------|----------|---------|
| CRITICAL | 60s | Risk DENY, posture RED, SAFE_MODE with open positions |
| ELEVATED | `AGENT_PIPELINE_MIN_MS` (5min) | In position + high vol / drift / loss > 5% |
| ACTIVE | 15min | In position, normal conditions |
| WATCHING | 20min | No position + elevated vol or ALLOW_REDUCE_ONLY |
| IDLE | `AGENT_PIPELINE_BASE_MS` (30min) | No position, calm market |

## LLM Integration (`llm.ts`)
Spawns `claude` or `codex` CLI as child process. Passes JSON schema for structured output. Multi-strategy JSON extraction from stdout (handles ANSI, markdown fences, nested JSON). Timeouts: 90s claude, 120s codex. Temporary settings isolation (disables hooks).

**Config**: `AGENT_LLM` (global default), per-role overrides (`AGENT_RESEARCH_LLM`, etc.), `CLAUDE_MODEL=opus`, `CODEX_MODEL=gpt-5.3-codex-spark`.

## Data Sources
- **Hyperliquid**: Universe metadata, funding rates, open interest, orderbook
- **CoinGecko**: Sector breadth (DeFi, L1, Memes), TVL, volume
- **Twitter/X**: Narrative velocity, mention counts (via `TWITTER_BEARER_TOKEN`)
- **Price Features**: Returns (1h/4h/24h/7d), volatility, momentum, RSI-like indicators

## Proposal Flow
1. Fetch Hyperliquid universe → filter top N by volume/OI
2. Enrich with CoinGecko + Twitter intel
3. Compute price features (4h window)
4. Build LLM prompt with all context
5. Call `runCodexStructured` with `StrategyProposalSchema`
6. Validate with `parseStrategyProposal()` — invalid → journal error, no publish
7. Publish to `hlp.strategy.proposals` stream

## Journaling
- **Local**: NDJSON per role (`journals/journal-<role>.ndjson`), append-only
- **GitHub**: Optional sync to repo via API (`GITHUB_TOKEN` + repo config)
- **Discord**: Webhook alerts with cooldown, filtered by action type

## Event Bus
**Publishes**: `hlp.strategy.proposals`, `hlp.ui.events` (floor tape), `hlp.audit.events`
**Consumes**: `hlp.risk.decisions`, `hlp.execution.fills`

## Key Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_LLM` | codex | Global LLM ('claude'/'codex'/'none') |
| `AGENT_PIPELINE_BASE_MS` | 1800000 | IDLE cadence (30min) |
| `AGENT_PIPELINE_MIN_MS` | 300000 | ELEVATED cadence (5min) |
| `AGENT_OPS_INTERVAL_MS` | 3000 | Ops heartbeat (3s) |
| `AGENT_UNIVERSE_SIZE` | 6 | Top N assets |
| `AGENT_UNIVERSE_CANDIDATE_LIMIT` | 240 | Broad pool |
| `AGENT_UNIVERSE_REFRESH_MS` | 10800000 | Universe refresh (3h) |
| `AGENT_INTEL_ENABLED` | true | Enable intel pack |
| `DRY_RUN` | false | SIM mode |

## Development
- `AGENT_LLM=none` skips LLM calls (dry run)
- `DRY_RUN=true` forces SIM mode
- `AGENT_PIPELINE_BASE_MS=60000` (1min) for faster testing
- Check `journals/journal-ops.ndjson` for floor status and urgency level changes
