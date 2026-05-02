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
strict enough to leave running.

## Architecture

Two long-running processes share a Redis Streams bus.

**`apps/sentinel`** polls a set of source adapters (RSS, X, Farcaster —
whatever the operator wires in), pipes each item through an LLM
configured at the shell (`SENTINEL_LLM_COMMAND` — `claude -p`, `codex`,
or your own wrapper), and publishes one validated `SentimentSignal`
envelope per item to `hlpv2.sentiment`.

**`apps/oracle`** is the orchestrator. A signal arrives; the orchestrator
runs three roles back to back:

- **SNT** aggregates the buffered signals for that market — weighted by
  source trust, freshness decay (re-computed from each signal's `ts` at
  evaluation time, never frozen at publish time), and confidence — and
  folds the result into a probability estimate `p̂` via a Bayesian-style
  update from the market price as prior.
- **EXE** turns the estimate into an `OutcomeProposal`: side
  (YES if `p̂ ≥ price`, otherwise NO), limit price, Kelly-fraction sizing
  capped by per-market, gross, and per-cluster bankroll limits.
- **RSK** runs the proposal through 14 fail-closed gates, ordered
  cheapest-first, single-failure short-circuit:

  ```
  OPERATOR_HALT  →  INVALID_PROPOSAL  →  PROPOSAL_EXPIRED  →  STALE_SENTIMENT
                →  MARKET_NOT_TRADING  →  RESOLUTION_TOO_SOON
                →  RESOLUTION_TOO_FAR  →  CHALLENGE_WINDOW_OPEN
                →  EDGE_TOO_THIN       →  STAKE_PER_MARKET
                →  CONCURRENT_MARKETS  →  CORRELATED_EXPOSURE
                →  BANKROLL_DEPLETED   →  LOW_LIQUIDITY
  ```

  Each failure carries `{ code, reason, observed, threshold }`.

On ALLOW, the operator-supplied `OrderRouter` places the order on
Hyperliquid. The fill returns, the orchestrator publishes it to
`hlpv2.fills`, and appends a hash-chained entry to `hlpv2.audit`
alongside the estimate, proposal, and decision that produced it.

A per-market mutex serialises evaluations: two near-simultaneous signals
for the same market can't both see pre-fill exposure and over-fill the
cap. The property-style invariant — total filled exposure ≤
`maxGrossExposureUsd` under any concurrency — is tested.

Positions, equity, and fills live on the exchange. The orchestrator does
not maintain a parallel ledger. `HyperliquidAccountant` reads
`clearinghouseState` (TTL-cached, default 4 s) and exposes the views the
risk gates need. HL errors propagate; there is no graceful degradation.
If the exchange call throws, the orchestrator's call throws, and the
operator's monitoring catches it.

The orchestrator, sentinel, market provider, and order router all refuse
to start if their dependencies aren't wired. Production paths require
real Hyperliquid access and a real LLM completer. Tests inline their own
fakes locally — the production code paths don't ship any.

## Configuration

Two operator-owned, gitignored files drive everything; both have
committed templates that document the shape.

**`config/strategy.json`** holds the risk knobs, the LLM system prompt,
source-trust priors, estimation parameters, and the market topic filter.
Resolution order at startup, first hit wins:

```
$STRATEGY_CONFIG_PATH  →  config/strategy.json  →  config/strategy.template.json  →  schema defaults
```

Every field is optional; missing keys fall back to Zod defaults baked
into `StrategyConfigSchema`:

```ts
{
  risk:          RiskConfig                          // bankroll, caps, edge thresholds, kelly
  prompts:       { sentimentScorer?: string }        // LLM system prompt
  sources:       { trust: Partial<Record<Source, 0..1>> }
  estimation:    { halfLifeSec: number, evidenceWeight: number }
  marketFilter:  { topicTagAllowlist?: string[], topicTagBlocklist?: string[] }
}
```

**`apps/oracle/wiring.ts`** supplies the live `OutcomeMarketProvider` and
`OrderRouter`. `@nktkas/hyperliquid` doesn't yet expose HIP-4
outcome-market endpoints, so the operator implements both factories
against their HL access:

```bash
cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts
```

The file exports `makeMarketProvider(hl)` and `makeOrderRouter(hl)`.
Oracle main dynamic-imports it at startup; if it's missing or either
factory throws, the binary exits with a clear error.

## Running it

```bash
bun install
bun run typecheck     # all v2 packages + apps
bun run test          # 87 vitest cases
bun run build         # production build

export ORACLE_HL_USER=0xYourWalletAddress
export ORACLE_OPERATOR_TOKEN=...                # for /v1/operator/halt|resume
export SENTINEL_LLM_COMMAND="claude -p"         # or codex, or your wrapper

# Optional oracle knobs:
#   ORACLE_HL_TESTNET=1            point at testnet
#   ORACLE_HL_API_URL=...          override base URL
#   ORACLE_HL_INFO_URL=...         override /info URL
#   ORACLE_HL_RPM=1000             rate limit
#   ORACLE_HL_TTL_MS=4000          accountant cache TTL
#   ORACLE_PNL_BASELINE_USD=...    baseline for /v1/public/floor pnlPct%
#   ORACLE_REDIS_URL=redis://...   opt-in Redis (default: in-memory)

cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts && $EDITOR $_
cp config/strategy.template.json   config/strategy.json   && $EDITOR $_

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

Operator routes return 401 when `ORACLE_OPERATOR_TOKEN` is unset. The
public surface deliberately omits positions, notional, bankroll,
sentiment payloads, and proposal rationale — pHat and edge are enough
for someone to cross-reference their own model.

## Repo

```
apps/
  oracle/             3-role orchestrator + HTTP API + wiring.template.ts
  sentinel/           Sentiment ingestion + LLM scoring (shell-out completer)
  web/                Next.js: landing, /floor, /v1 retrospective
packages/
  contracts/          Zod schemas (single source of truth)
  outcome-engine/     Pure math: aggregate, estimate, edge, Kelly, propose
  outcome-risk/       14 fail-closed risk gates
  strategy/           Strategy config loader (gitignored JSON + template)
  event-bus/          Redis Streams abstraction (in-memory test impl)
  hl-client/          Hyperliquid HTTP transport + typed info wrappers
config/
  strategy.template.json    Public defaults (committed)
  strategy.json             Operator's real strategy (gitignored)
legacy/               Frozen v1 code, docs, and infra. See legacy/README.md.
docs/SPEC.md          Full v2 architecture + invariants
```

Bun + TypeScript 5.7, Turborepo, Zod schemas everywhere. Redis 7 Streams
for the bus (in-memory adapter for tests). Hyperliquid via
`@nktkas/hyperliquid`. Next.js 15 + Tailwind for the public site.

## More

- [`docs/SPEC.md`](docs/SPEC.md) — full v2 spec
- [`apps/oracle/README.md`](apps/oracle/README.md), [`apps/sentinel/README.md`](apps/sentinel/README.md)
- [`packages/*/README.md`](packages/) — per-package
- [`legacy/README.md`](legacy/README.md) and [`/v1`](https://hlprivateer.xyz/v1) — v1 retrospective
- [`llms.txt`](llms.txt), [`skills.md`](skills.md) — machine-readable summaries

## Disclaimer

Experimental software for research and operational automation. Not
financial advice. All trading decisions and losses are the operator's
responsibility. Use at your own risk.

## License

MIT
