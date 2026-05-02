# HL Privateer v2 — Architecture & Invariants

A sentiment-driven trading agent for Hyperliquid HIP-4 outcome contracts.
Sentiment in, probability estimate out, fail-closed risk gates, order
placement on ALLOW, hash-chained audit on every step.

This document is the canonical v2 spec. The v1 spec lives at
[`../legacy/docs/SPEC.md`](../legacy/docs/SPEC.md) and the v1 retrospective
is at [`../legacy/README.md`](../legacy/README.md).

## 1. Goals & non-goals

### Goals
- Trade HIP-4 outcome contracts on Hyperliquid using sentiment as the edge
  signal.
- Hyperliquid is the source of truth for accountancy. Don't reinvent state.
- Fail-closed at every layer: missing config, missing wiring, HL errors —
  refuse to operate, don't degrade silently.
- Deterministic policy. Pure-function gates with full reason codes. The
  audit chain captures every decision.
- Privacy by default. The public HTTP surface exposes nothing the operator
  doesn't explicitly want exposed.

### Non-goals
- A demo / simulator. There is no `LocalAccountant`, `DryRunRouter`,
  `FixtureMarketProvider`, or `HeuristicScorer` in production paths.
- A multi-exchange routing layer. v2 is HL-only.
- A backtesting framework. The risk engine is testable; the orchestrator
  isn't designed for replay.

## 2. System shape

```
news/x/farcaster ──► apps/sentinel ──► hlpv2.sentiment ──► apps/oracle
                       (LlmScorer)                          │
                       │                                    │ SNT → estimate
                       │                                    │ EXE → proposal
                       ▼                                    │ RSK → 14 gates
              SENTINEL_LLM_COMMAND                          │
              (operator-supplied                            │ ALLOW
               shell)                                       ▼
                                                 OrderRouter.place()
                                              (operator wiring.ts)
                                                            │
                                                            ▼
                                                   Hyperliquid HIP-4
                                                            │
                                                  HyperliquidAccountant
                                                  reads clearinghouseState
                                                  every ttlMs
```

## 3. Components

### `apps/sentinel`
- Polls one or more `SentimentSource` adapters (`FixtureSource`,
  `InMemorySource` in tests; operator wires real sources).
- Scores each item via `LlmScorer`, which delegates to a shell completer
  (`SENTINEL_LLM_COMMAND`).
- Validates and publishes `SentimentSignal` envelopes onto
  `hlpv2.sentiment`.

### `apps/oracle`
The orchestrator. Single process, three roles:

- **SNT (Sentinel)** — aggregates the buffered signals for a market via
  `aggregateSentiment` (decay computed from each signal's `ts` at
  evaluation time, not the publish-time `freshnessSec` snapshot), then
  estimates `pHat` via `estimateProbability`.
- **EXE (Execution)** — builds an `OutcomeProposal` via `proposeOrder`:
  side (YES/NO), limit price, Kelly-fraction sizing capped by
  `maxStakePerMarketUsd`, `maxGrossExposureUsd`, and remaining cluster
  exposure.
- **RSK (Risk)** — calls `outcome-risk.evaluate(ctx)` against 14
  fail-closed gates. Single-failure short-circuit. ALLOW or DENY.

### `packages/outcome-engine`
Pure deterministic math. No I/O. Functions: `aggregateSentiment`,
`signalAgeSec`, `estimateProbability`, `computeEdge`, `kellyFraction`,
`proposeOrder`. All caller-clocked (`nowMs` parameter where time matters).

### `packages/outcome-risk`
Pure fail-closed gates. `evaluate(RiskContext) → RiskDecision`.
Cheapest-first ordering, single-failure short-circuit. Each
`RiskGateFailure` carries `code`, `reason`, `observed`, `threshold`.

### `packages/contracts`
Zod schemas for every inter-service message: `OutcomeMarket`,
`SentimentSignal`, `ProbabilityEstimate`, `OutcomeProposal`,
`RiskDecision`, `OutcomeFill`, `RiskConfig`, `StrategyConfig`,
`EventEnvelope`, etc. Single source of truth.

### `packages/strategy`
JSON config loader. Resolution order: `STRATEGY_CONFIG_PATH` env →
`config/strategy.json` (gitignored) → `config/strategy.template.json`
(committed) → schema defaults.

### `packages/event-bus`
Typed pub/sub over `hlpv2.*` streams. `RedisEventBus` for production,
`InMemoryEventBus` for tests.

### `packages/hl-client`
Hyperliquid HTTP transport with rate limiting and response caching, plus
typed wrappers around the documented info endpoints
(`clearinghouseState`, `userFills`, `userFillsByTime`).

## 4. Hyperliquid-as-source-of-truth

The orchestrator depends on the `Accountant` interface, implemented by
`HyperliquidAccountant`:

```ts
interface Accountant {
  positions(): Promise<readonly OpenPosition[]>
  equityUsd(): Promise<number>
  openExposureUsd(): Promise<number>
  openMarketCount(): Promise<number>
  clusterExposureUsd(market: OutcomeMarket): Promise<number>
  recordMarket(market: OutcomeMarket): void
  warmup(): Promise<void>
  recentFills(): Promise<UserFill[]>
}
```

`HyperliquidAccountant` reads `clearinghouseState` (TTL-cached, default
4 s), maps `assetPositions` into our `OutcomeSide`/`sizeUsd` shape, and
sources equity from `crossMarginSummary.accountValue`. **HL errors
propagate.** No graceful degradation.

The orchestrator's `start()` calls `accountant.warmup()` so the first risk
evaluation sees real exchange state.

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
| 2  | `INVALID_PROPOSAL`      | Size ≤ 0, limit ∉ (0,1), id mismatch. |
| 3  | `PROPOSAL_EXPIRED`      | `expiresAt` ≤ now. |
| 4  | `STALE_SENTIMENT`       | Freshest signal age > `maxSentimentAgeSec`. |
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

## 7. Strategy

Risk knobs, the LLM system prompt, source-trust priors, estimation
parameters, and the market filter live in `config/strategy.json` —
gitignored. Operator copies `config/strategy.template.json` and edits.

```ts
StrategyConfig = {
  risk: RiskConfig
  prompts: { sentimentScorer?: string }
  sources: { trust: Partial<Record<SentimentSource, 0..1>> }
  estimation: { halfLifeSec: number, evidenceWeight: number }
  marketFilter: { topicTagAllowlist?: string[], topicTagBlocklist?: string[] }
}
```

The framework — gates, orchestrator, schemas, audit chain, HTTP API —
stays public. Only the strategy is private.

## 8. Operator wiring

`@nktkas/hyperliquid` does not yet surface HIP-4 outcome-market endpoints,
so `OutcomeMarketProvider` and `OrderRouter` are operator-owned. Copy
`apps/oracle/wiring.template.ts` to `apps/oracle/wiring.ts` (gitignored)
and implement `makeMarketProvider(hl)` + `makeOrderRouter(hl)` against
HL HIP-4. Oracle main refuses to start until that file exists.

## 9. Audit

Every estimate / proposal / decision / fill is appended to `hlpv2.audit`
through `AuditChain.append`, which:

1. Builds a canonical body `{ type, ts, prevHash, payload }`.
2. Computes `hash = sha256(canonicalize(body))`.
3. Publishes the envelope with `payload = { ...body, hash }`.
4. Stores `prevHash := hash` for the next entry.

Stream MAXLEN is 0 — never trimmed, operator compliance.

## 10. HTTP surface

```
GET  /healthz                   — mode + metrics + equityUsd + openMarkets
GET  /metrics                   — Prometheus 0.0.4: mode + equity gauge + 6 counters
GET  /v1/public/markets         — Markets with pHat + edge (privacy-safe)
GET  /v1/public/floor           — Mode + markets + tape + pnlPct (vs baseline)
GET  /v1/public/floor-tape      — Recent role tape (last ~50 lines)
POST /v1/operator/halt          — Bearer-token; 401 when token unset
POST /v1/operator/resume        — Bearer-token; 401 when token unset
```

`pnlPct` on `/v1/public/floor` is `(equity − ORACLE_PNL_BASELINE_USD) /
ORACLE_PNL_BASELINE_USD` when the baseline is set; otherwise `null`.

## 11. Invariants

- **AI proposes, never executes.** `outcome-risk.evaluate()` is the only
  ALLOW path. `OrderRouter.place()` is the only fill path.
- **Fail-closed.** Any dependency error or failed gate denies the proposal.
  Single-failure short-circuit.
- **No fallbacks.** Production paths require real HL access. Tests inline
  their own fakes.
- **Pure-function gates.** `outcome-risk` and `outcome-engine` have zero
  I/O. Deterministic test surface.
- **Hash-chained audit.** Tamper-evident replay.
- **Privacy by default.** Public surface omits positions, notional,
  bankroll, sentiment payloads, and proposal rationale.
- **Hyperliquid is the source of truth.** No parallel ledger.
- **Per-market mutex.** Concurrent signals can't over-fill the cap.

## 12. Test surface

87 vitest cases across 11 files:

| Package / app          | Cases | What's covered |
|------------------------|-------|----------------|
| `packages/contracts`   | 8     | Schema parsing, defaults, rejections |
| `packages/event-bus`   | 2     | InMemory publish/replay |
| `packages/outcome-engine` | 21 | All exports + edge cases (decay, Kelly, propose) |
| `packages/outcome-risk` | 19   | Each gate + short-circuit semantics |
| `packages/strategy`    | 4     | Defaults, file load, env override, validation |
| `apps/sentinel`        | 8     | LlmScorer, parseScore, createSentinel.tick |
| `apps/oracle`          | 24    | Orchestrator end-to-end (6), HTTP (9), accountant (7), audit (2) |
| `apps/web`             | 1     | Smoke |

`bun run test` runs them all; `bun run build` and `bun run typecheck` are
clean from a fresh `dist/` tree.
