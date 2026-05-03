# HL Privateer v3 — Architecture & Invariants

A sentiment-driven trading agent for Hyperliquid HIP-4 outcome contracts.
Single process. Single agent (LLM) as the strategy seam. Deterministic
math + risk gates underneath. Append-only JSONL audit on every step.

This document is the canonical v3 spec. The v2 spec (two processes over
Redis Streams) and the v1 spec (7-role discretionary perp desk) are
preserved at `legacy/docs/SPEC.md`.

## 1. Goals & non-goals

### Goals
- Trade HIP-4 outcome contracts on Hyperliquid using sentiment as the edge
  signal.
- Hyperliquid is the source of truth for accountancy. Don't reinvent state.
- Fail-closed at every layer: missing config, missing wiring, HL errors —
  refuse to operate, don't degrade silently.
- **Deterministic plumbing, dynamic strategy.** The places where the
  system can't plausibly be smarter than a pure function (Kelly cap,
  exposure limits, edge thresholds, gate evaluation, per-market mutex)
  stay deterministic. The place where reasoning matters (which markets
  to trade, what shape the trade should take, what counts as a thesis)
  is a single LLM call per evaluation.
- Privacy by default. The public HTTP surface exposes nothing the operator
  doesn't explicitly want exposed.

### Non-goals
- A demo / simulator. There is no `LocalAccountant`, `DryRunRouter`, or
  `FixtureMarketProvider` in production paths.
- A multi-exchange routing layer. v3 is HL-only.
- A backtesting framework. The risk engine and math are testable; the
  orchestrator isn't designed for replay.

## 2. System shape

```
sentiment sources ──► orchestrator.ingest(item) ──► StrategyAgent.propose(ctx)
  (FixtureSource,            │                            │
   InMemorySource,           │                    {action: "skip"} | AgentProposal
   operator-wired)           │                            │
                             ▼                            ▼
                      per-market mutex          deterministic clipSize:
                                                  - Kelly cap (vs agent's pHat)
                                                  - maxStakePerMarketUsd
                                                  - remaining gross exposure
                                                          │
                                                          ▼
                                                14 fail-closed risk gates
                                                          │
                                                          ▼ ALLOW
                                                OrderRouter.place()
                                                (operator wiring.ts)
                                                          │
                                                          ▼
                                                Hyperliquid HIP-4
                                                          │
                                                          ▼
                                                HyperliquidAccountant
                                                reads clearinghouseState
                                                every ttlMs
```

## 3. The strategy seam

```ts
interface StrategyAgent {
  propose(ctx: AgentContext): Promise<AgentProposal | null>
}

interface AgentContext {
  market: OutcomeMarket
  signals: readonly SentimentItem[]
  exposureUsd: number
  openMarketCount: number
  clusterExposureUsd: number
  riskConfig: RiskConfig
}

interface AgentProposal {
  side: 'YES' | 'NO'
  pHat: number
  sizeUsd: number
  limitPrice: number
  thesis: string
  signalsConsideredAt: string
}
```

The default implementation, `LlmStrategyAgent`, renders a prompt with the
market, the recent items, the operator's risk knobs, and current
exposure, then shells out to `AGENT_LLM_COMMAND`. The completer's stdout
is parsed with a lenient brace-balanced JSON extractor. A response of
`{"action": "skip", ...}` returns `null`; a response of `{"action":
"trade", ...}` is validated against `AgentProposalSchema`.

The agent is the only dynamic piece in the system. Everything below it
in the pipeline is pure functions and Zod-validated state.

## 4. Components

### `apps/agent/src/contracts.ts`
Zod schemas for every shape: `OutcomeMarket`, `SentimentItem`,
`AgentProposal`, `OutcomeProposal`, `RiskDecision`, `OutcomeFill`,
`RiskConfig`, `StrategyConfig`, `FloorTapeLine`, `PublicMarket`,
`FloorSnapshot`. Single source of truth.

### `apps/agent/src/math.ts`
Pure deterministic math: `edgeBps`, `kellyFraction`, `clipSize`. The
orchestrator calls `clipSize` immediately after the agent so a confident
agent can't over-size before the gates ever run.

### `apps/agent/src/risk.ts`
Pure fail-closed gates. `evaluate(RiskContext) → RiskDecision`.
Cheapest-first ordering, single-failure short-circuit. Each
`RiskGateFailure` carries `code`, `reason`, `observed`, `threshold`.

### `apps/agent/src/strategy.ts`
`StrategyAgent` interface, `LlmStrategyAgent` (shell completer wrapper),
`FixedAgent` (test fixture), `parseAgentProposal`, `renderPrompt`, and
the default strategist system prompt.

### `apps/agent/src/sources.ts`
`SentimentSourceAdapter` interface, `FixtureSource`, `InMemorySource`.
Operator wires production adapters externally.

### `apps/agent/src/hl.ts`
Minimal Hyperliquid info client. `postInfo` posts JSON to `/info` with a
configurable timeout, no rate limiter, no response cache — the only
caller (`HyperliquidAccountant`) TTL-caches its own state.

### `apps/agent/src/accountant.ts`
`HyperliquidAccountant` reads `clearinghouseState` (TTL-cached, default
4 s), maps `assetPositions` into our `OutcomeSide`/`sizeUsd` shape, and
sources equity from `crossMarginSummary.accountValue`. **HL errors
propagate.** No graceful degradation.

### `apps/agent/src/orchestrator.ts`
The orchestrator. `ingest(item)` records the item to a per-market buffer
and triggers `evaluateMarket(marketId)`. `evaluateMarket` runs through
the per-market mutex and:

1. Looks up the market via `OutcomeMarketProvider.get(marketId)`.
2. Applies `marketFilter` (allow/block tags).
3. Records the market with the accountant (so it can compute cluster
   exposure for tagged markets).
4. Reads `exposureUsd`, `openMarketCount`, `clusterExposureUsd` from the
   accountant.
5. Calls `agent.propose(ctx)`. If null → skip + tape.
   If the agent throws → skip + tape + `agent.failed` audit entry.
6. Computes `edgeBps` from the agent's `pHat` and the market price for
   the chosen side.
7. Calls `clipSize` → final `sizeUsd` and `kellyFraction`.
8. If `sizeUsd ≤ 0` → skip + tape.
9. Wraps everything into an `OutcomeProposal` (with id, expiresAt, ts).
10. Audits `proposal.emitted`.
11. Calls `risk.evaluate(...)`. Audits `risk.decision`. If DENY → tape +
    return.
12. Calls `router.place(proposal)`. Audits `fill.confirmed`. If placement
    throws → tape + `order.failed` audit entry. Tape.

### `apps/agent/src/audit.ts`
`AuditLog` appends one JSON object per line to `data/audit.jsonl`.
`InMemoryAuditLog` keeps the same shape in memory for tests. The v2
SHA-256 hash chain is gone — the marginal value of cryptographic
tamper-evidence didn't justify the canonicalization overhead, and
operators who need that can layer it on top of the JSONL stream.

### `apps/agent/src/http.ts`
`startHttpServer` wires `/healthz`, `/metrics`, `/v1/public/markets`,
`/v1/public/floor`, `/v1/public/floor-tape`, `/v1/operator/halt`,
`/v1/operator/resume`. Operator routes are bearer-token-gated and
fail-closed when `AGENT_OPERATOR_TOKEN` is unset.

### `apps/agent/src/strategy-config.ts`
JSON config loader. Resolution order: `STRATEGY_CONFIG_PATH` env →
`config/strategy.json` (gitignored) → `config/strategy.template.json`
(committed) → schema defaults.

### `apps/agent/src/main.ts`
Entrypoint. Loads strategy, builds the HL client, accountant, agent,
and source adapters, dynamic-imports `apps/agent/wiring.ts` for the
market provider + order router, starts the orchestrator, opens HTTP, and
polls the sources every `AGENT_INTERVAL_MS` (default 30 s), feeding each
new item back through `orchestrator.ingest`.

## 5. Per-market mutex

`evaluateMarket(marketId)` chains through a per-market `inflight`
promise map. Two near-simultaneous signals for the same market run
sequentially, so the `Accountant`'s view of exposure is fresh between
them. Property-style invariant: total filled exposure ≤
`maxGrossExposureUsd` under any concurrency. Tested.

## 6. Risk gates (14)

Cheapest first; any failure → DENY (single-failure short-circuit).

| #  | Code                    | What it guards against |
|----|-------------------------|------------------------|
| 1  | `OPERATOR_HALT`         | Operator killed it.    |
| 2  | `INVALID_PROPOSAL`      | Size ≤ 0, limit ∉ (0,1), market id mismatch. |
| 3  | `PROPOSAL_EXPIRED`      | `expiresAt` ≤ now. |
| 4  | `STALE_SENTIMENT`       | `signalsConsideredAt` older than `maxSentimentAgeSec`, or buffer empty. |
| 5  | `MARKET_NOT_TRADING`    | Market in auction / settling / etc. |
| 6  | `RESOLUTION_TOO_SOON`   | < `minSecondsToResolution`. |
| 7  | `RESOLUTION_TOO_FAR`    | > `maxSecondsToResolution`. |
| 8  | `CHALLENGE_WINDOW_OPEN` | Settling/challenged, or within buffer. |
| 9  | `EDGE_TOO_THIN`         | edgeBps < `minEdgeBps`. |
| 10 | `STAKE_PER_MARKET`      | sizeUsd > `maxStakePerMarketUsd`. |
| 11 | `CONCURRENT_MARKETS`    | openMarketCount ≥ `maxConcurrentMarkets`. |
| 12 | `CORRELATED_EXPOSURE`   | Cluster exposure + size > cluster cap. |
| 13 | `BANKROLL_DEPLETED`     | Open + new > `maxGrossExposureUsd`. |
| 14 | `LOW_LIQUIDITY`         | Book depth < min, or < proposal size. |

## 7. Strategy config

```ts
StrategyConfig = {
  risk: RiskConfig
  prompts: { strategist?: string }
  marketFilter: { allowTags?: string[]; blockTags?: string[] }
}
```

Risk knobs and the strategist prompt live in `config/strategy.json` —
gitignored. Operator copies `config/strategy.template.json` and edits.
The framework — gates, math, orchestrator, schemas, audit, HTTP — stays
public. Only the strategy is private.

## 8. Operator wiring

`@nktkas/hyperliquid` does not yet surface HIP-4 outcome-market
endpoints, so `OutcomeMarketProvider` and `OrderRouter` are
operator-owned. Copy `apps/agent/wiring.template.ts` to
`apps/agent/wiring.ts` (gitignored) and implement
`makeMarketProvider(hl)` + `makeOrderRouter(hl)` against HL HIP-4. Agent
main refuses to start until that file exists.

## 9. Audit

Every proposal, decision, fill, agent failure, and order-placement failure
is appended to `data/audit.jsonl` (or the path in `AGENT_AUDIT_PATH`) as
one JSON object per line. Each line carries
`{ ts, type, correlationId, payload }`.

## 10. HTTP surface

```
GET  /healthz                   — mode + metrics + equityUsd + openMarkets
GET  /metrics                   — Prometheus 0.0.4: mode + equity + counters
GET  /v1/public/markets         — Markets with pHat + edge (privacy-safe)
GET  /v1/public/floor           — Mode + markets + tape + pnlPct
GET  /v1/public/floor-tape      — Recent role tape (last ~50 lines)
POST /v1/operator/halt          — Bearer-token; 401 when token unset
POST /v1/operator/resume        — Bearer-token; 401 when token unset
```

`pnlPct` on `/v1/public/floor` is `(equity − AGENT_PNL_BASELINE_USD) /
AGENT_PNL_BASELINE_USD` when the baseline is set; otherwise `null`.

## 11. Invariants

- **AI proposes, never executes.** `risk.evaluate()` is the only ALLOW
  path. `OrderRouter.place()` is the only fill path.
- **Fail-closed.** Any dependency error or failed gate denies the proposal.
  Single-failure short-circuit.
- **No fallbacks.** Production paths require real HL access. Tests inline
  their own fakes.
- **Pure-function gates and math.** `risk.ts` and `math.ts` have zero I/O.
  Deterministic test surface.
- **Append-only audit.** Every step recorded to JSONL.
- **Privacy by default.** Public surface omits positions, notional,
  bankroll, sentiment payloads, and the agent's thesis.
- **Hyperliquid is the source of truth.** No parallel ledger.
- **Per-market mutex.** Concurrent signals can't over-fill the cap.
- **One agent, one place.** The strategy seam is the only place LLM
  output enters the system. Everything else is deterministic.

## 12. Test surface

76 vitest cases across 9 files, all in `apps/agent/src`:

| File                       | Cases | What's covered |
|----------------------------|-------|----------------|
| `contracts.test.ts`        | 8     | Schema parsing, defaults, rejections |
| `math.test.ts`             | 11    | Edge, Kelly, size clip |
| `risk.test.ts`             | 18    | Each gate + short-circuit semantics |
| `strategy.test.ts`         | 9     | Prompt rendering, JSON parse, completer |
| `strategy-config.test.ts`  | 4     | Defaults, file load, env override, validation |
| `accountant.test.ts`       | 7     | Positions mapping, ttl, warmup, errors |
| `audit.test.ts`            | 2     | JSONL append, in-memory test variant |
| `orchestrator.test.ts`     | 8     | End-to-end: proposes, denies, fills, mutex |
| `http.test.ts`             | 9     | Endpoints + operator auth |

`bun run test` runs all of them; `bun run build` and `bun run typecheck`
are clean from a fresh `dist/` tree.
