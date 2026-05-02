# HL Privateer

> A self-hosted trading agent for **Hyperliquid HIP-4 outcome contracts**,
> driven by sentiment.
>
> v1 was a different experiment — a 7-role LLM crew running discretionary
> long/short perpetual trades on Hyperliquid. It's concluded. The
> retrospective lives at [`/v1`](https://hlprivateer.xyz/v1) and
> [`legacy/README.md`](legacy/README.md), and the frozen v1 code is at
> [`/legacy`](legacy/). Read those if you want the story of what came
> before; the rest of this document is about v2.

```
+--------------------------------------------------------------------------------+
| HL PRIVATEER FLOOR // v2 // OUTCOME MARKETS                                    |
+--------------------------------------------------------------------------------+
| SNT [^]  "mkt-fed-pause: pHat=68% (mkt 62%) edge +6.0pp"                       |
| RSK [!]  "ALLOW $200 YES@0.620 (kelly 8.0% of cap 25%)"                        |
| EXE [>]  "filled $200 @0.620 — 0 fees on open (HIP-4)"                         |
| OPS [#]  "tracking 12 markets · sentiment 4.2 signals/min"                     |
+--------------------------------------------------------------------------------+
```

[hlprivateer.xyz](https://hlprivateer.xyz) ·
[github.com/ADWilkinson/hlprivateer.xyz](https://github.com/ADWilkinson/hlprivateer.xyz)

## The idea

Hyperliquid's [HIP-4 outcome
contracts](https://blog.quicknode.com/hip4-hyperliquid-outcome-contracts/)
are binary instruments: they settle to **0 or 1 in USDH** based on a
real-world event, and trade between the two on the same CLOB as spot and
perpetuals. The price at any moment is the market's implied probability
that the event will occur.

Sentiment — news flow, social posts, discussion on Farcaster, whatever
your feed — is also an estimate of that probability, just a fuzzier one.
The experiment is whether the gap between the sentiment-derived estimate
and the market price is tradeable, gated by a deterministic risk engine
strict enough that you can actually leave it running.

## How it runs

Two long-running processes share a Redis Streams bus:

1. **`apps/sentinel`** polls a set of source adapters (RSS, X, Farcaster,
   whatever the operator wires in), pipes each item through an LLM
   you configure (`SENTINEL_LLM_COMMAND` — `claude -p`, `codex`, your
   own wrapper), and publishes one validated `SentimentSignal` envelope
   per item to `hlpv2.sentiment`.

2. **`apps/oracle`** is the orchestrator. A signal arrives; the orchestrator
   runs three roles back to back:
   - **SNT** aggregates the buffered signals for that market — weighted
     by source trust, freshness decay (re-computed from each signal's
     `ts` at evaluation time, never frozen at publish time), and
     confidence — and folds the result into a probability estimate
     `p̂` via a Bayesian-style update from the market price prior.
   - **EXE** turns the estimate into an `OutcomeProposal`: side
     (YES if `p̂ ≥ price`, otherwise NO), limit price, Kelly-fraction
     sizing capped by per-market, gross, and per-cluster bankroll
     limits.
   - **RSK** runs the proposal through 14 fail-closed gates (full ladder
     below). Single-failure short-circuit. ALLOW or DENY, no maybes.

   On ALLOW, the operator-supplied `OrderRouter` places the order on
   Hyperliquid. The fill returns, the orchestrator publishes it to
   `hlpv2.fills` and appends an entry to the SHA-256-chained
   `hlpv2.audit` stream alongside the estimate, proposal, and decision
   that produced it.

A per-market mutex serialises evaluations so two near-simultaneous signals
for the same market can't both see pre-fill exposure and over-fill the
cap. The property-style invariant (total filled exposure ≤
`maxGrossExposureUsd` under any concurrency) is tested.

## Hyperliquid is the source of truth

Positions, equity, and fills live on the exchange. v2 doesn't keep a
parallel ledger. `HyperliquidAccountant` reads `clearinghouseState`
(TTL-cached, 4 s default), maps `assetPositions` into our
`OutcomeSide`/`sizeUsd` shape, and sources equity from
`crossMarginSummary.accountValue`. Risk gates ask the accountant; the
accountant asks Hyperliquid.

HL errors are **not** swallowed. There is no graceful degradation, no
"serve last known on failure", no fallback ledger. If `clearinghouseState`
throws, the orchestrator's call throws, and the operator's monitoring
catches it. That's the contract.

## No fallbacks

Every fake implementation that "kicks in if the real thing isn't
configured" has been deliberately removed:

- No `LocalAccountant`. `HyperliquidAccountant` only.
- No `DryRunRouter`. The real router is operator-supplied via
  [`apps/oracle/wiring.ts`](#operator-wiring) (gitignored).
- No `FixtureMarketProvider`. Same wiring file supplies the live
  market provider.
- No `HeuristicScorer`. Sentinel requires `SENTINEL_LLM_COMMAND`;
  refuses to start without one.

If a required environment variable or wiring file is missing, the binary
exits with a clear error. Tests inline their own fakes locally — those
are tests, not production paths.

The 14 risk gates, in evaluation order (cheapest first; any DENY
short-circuits the rest):

```
OPERATOR_HALT  →  INVALID_PROPOSAL  →  PROPOSAL_EXPIRED  →  STALE_SENTIMENT
              →  MARKET_NOT_TRADING  →  RESOLUTION_TOO_SOON
              →  RESOLUTION_TOO_FAR  →  CHALLENGE_WINDOW_OPEN
              →  EDGE_TOO_THIN       →  STAKE_PER_MARKET
              →  CONCURRENT_MARKETS  →  CORRELATED_EXPOSURE
              →  BANKROLL_DEPLETED   →  LOW_LIQUIDITY
```

Each failure carries `{ code, reason, observed, threshold }` so the audit
trail is debuggable end-to-end.

## Running it

The repo is public; the strategy that drives it isn't. Two pieces of
configuration are operator-owned and gitignored — both have committed
templates that document the shape:

### Strategy — `config/strategy.json`

Risk knobs, the LLM system prompt, source-trust priors, estimation
parameters, and the market topic filter all live in a single JSON file.
Resolution order at startup, first hit wins:

```
$STRATEGY_CONFIG_PATH  →  config/strategy.json  →  config/strategy.template.json  →  schema defaults
```

Every field is optional; missing keys fall back to Zod defaults baked
into `StrategyConfigSchema` in `@hl/privateer-contracts`. The shape:

```ts
{
  risk:          RiskConfig                          // bankroll, caps, edge thresholds, kelly
  prompts:       { sentimentScorer?: string }        // LLM system prompt
  sources:       { trust: Partial<Record<Source, 0..1>> }
  estimation:    { halfLifeSec: number, evidenceWeight: number }
  marketFilter:  { topicTagAllowlist?: string[], topicTagBlocklist?: string[] }
}
```

### Wiring — `apps/oracle/wiring.ts`

`@nktkas/hyperliquid` does not yet surface HIP-4 outcome-market endpoints,
so the live `OutcomeMarketProvider` and `OrderRouter` are operator-owned.
Copy the template and implement against your HL access:

```bash
cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts
```

The file exports `makeMarketProvider(hl)` and `makeOrderRouter(hl)`.
Oracle main dynamic-imports it at startup and refuses to start if the file
is missing or either factory throws.

### Putting it together

```bash
bun install
bun run typecheck    # all v2 packages + apps
bun run test         # 87 vitest cases
bun run build        # production build

# Required environment for the oracle:
export ORACLE_HL_USER=0xYourWalletAddress
export ORACLE_OPERATOR_TOKEN=...               # for /v1/operator/halt|resume

# Required for sentinel:
export SENTINEL_LLM_COMMAND="claude -p"        # or codex, or your wrapper

# Optional knobs (oracle):
#   ORACLE_HL_TESTNET=1          point at testnet
#   ORACLE_HL_API_URL=...        override base URL
#   ORACLE_HL_INFO_URL=...       override /info URL
#   ORACLE_HL_RPM=1000           rate limit
#   ORACLE_HL_TTL_MS=4000        accountant cache TTL
#   ORACLE_PNL_BASELINE_USD=...  baseline for /v1/public/floor pnlPct%
#   ORACLE_REDIS_URL=redis://... opt-in Redis (default: in-memory)

cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts && $EDITOR $_
cp config/strategy.template.json config/strategy.json   && $EDITOR $_

(cd apps/oracle   && bun run dev) &
(cd apps/sentinel && bun run dev) &

curl http://127.0.0.1:4100/healthz
curl http://127.0.0.1:4100/v1/public/floor
```

## HTTP surface

| Method | Path                      | Auth   | Returns                                       |
|--------|---------------------------|--------|-----------------------------------------------|
| GET    | `/healthz`                | —      | mode, metrics, equityUsd, openMarkets         |
| GET    | `/metrics`                | —      | Prometheus 0.0.4 — mode + equity + 6 counters |
| GET    | `/v1/public/markets`      | —      | Markets with `pHat` + `edge` (no sizes)       |
| GET    | `/v1/public/floor`        | —      | Mode + markets + role tape + `pnlPct`         |
| GET    | `/v1/public/floor-tape`   | —      | Last ~50 role-tape lines                      |
| POST   | `/v1/operator/halt`       | Bearer | Halts the orchestrator                        |
| POST   | `/v1/operator/resume`     | Bearer | Resumes it                                    |

Operator routes return 401 when `ORACLE_OPERATOR_TOKEN` is unset
(fail-closed; never default-open). The public surface deliberately omits
positions, notional, bankroll, sentiment payloads, and proposal
rationale — pHat and edge are enough for someone to cross-reference
their own model.

## Repo shape

```
apps/
  oracle/             3-role orchestrator + HTTP API + wiring.template.ts
  sentinel/           Sentiment ingestion + LLM scoring (shell-out completer)
  web/                Next.js: landing, /floor, /v1 retrospective
packages/
  contracts/          Zod schemas (single source of truth)
  outcome-engine/     Pure math: aggregate, estimate, edge, Kelly, propose
  outcome-risk/       Pure fail-closed risk gates (14)
  strategy/           Strategy config loader (gitignored JSON + template)
  event-bus/          Redis Streams abstraction (in-memory test impl)
  hl-client/          Hyperliquid HTTP transport + typed info wrappers
config/
  strategy.template.json    Public defaults (committed)
  strategy.json             Operator's real strategy (gitignored)
legacy/               Frozen v1 code, docs, and infra. See legacy/README.md.
docs/SPEC.md          v2 architecture + invariants + risk gate table
```

## Invariants (the things that don't change)

- **AI proposes, never executes.** `outcome-risk.evaluate()` is the only
  path to ALLOW; `OrderRouter.place()` is the only path to a fill.
- **Pure-function policy.** Gates and engine math have zero I/O and a
  fully deterministic test surface.
- **Hash-chained audit.** Every estimate, proposal, decision, and fill is
  appended to `hlpv2.audit` with a SHA-256 prev-hash chain. Replay-capable.
- **Privacy by default.** The public HTTP surface exposes pHat / edge /
  question — never positions, notional, bankroll, or sentiment payloads.
- **Hyperliquid is the source of truth.** No parallel ledger. HL errors
  propagate; no graceful degradation.
- **Per-market mutex.** Concurrent signals for the same market can't
  over-fill the cap.
- **No fallbacks.** Production paths require real HL access, real LLM
  access, and a real wiring file. Tests inline their own fakes.

## Tech stack

Bun + TypeScript 5.7, Turborepo, Zod schemas everywhere. Redis 7 Streams
for the event bus (in-memory adapter for tests). Hyperliquid via
`@nktkas/hyperliquid`. Claude or Codex for LLM scoring (operator-supplied
shell). Next.js 15 + Tailwind for the public site.

## More

- [`docs/SPEC.md`](docs/SPEC.md) — full v2 architecture, gate table,
  test surface
- [`apps/oracle/README.md`](apps/oracle/README.md) — orchestrator + HTTP API
- [`apps/sentinel/README.md`](apps/sentinel/README.md) — sentiment ingestion
- [`packages/*/README.md`](packages/) — per-package docs
- [`legacy/README.md`](legacy/README.md) — v1 retrospective
- [`/v1`](https://hlprivateer.xyz/v1) — on-site v1 retrospective
- [`llms.txt`](llms.txt) — LLM-friendly summary
- [`skills.md`](skills.md) — agentskills.io manifest

## Disclaimer

Experimental software for research and operational automation. Not
financial advice. All trading decisions and losses are the operator's
responsibility. Use at your own risk.

## License

MIT
