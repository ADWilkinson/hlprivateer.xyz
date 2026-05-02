# HL Privateer

> **v2 — Sentiment-driven outcome market trading agents on Hyperliquid (HIP-4).**
>
> v1 (discretionary perp trading desk) is concluded; the code is preserved
> under `legacy/`. See [`/legacy/README.md`](legacy/README.md) for the v1
> writeup and [`apps/web/app/v1/page.tsx`](apps/web/app/v1/page.tsx) for the
> on-site retrospective.

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

**Live**: [hlprivateer.xyz](https://hlprivateer.xyz) · **Source**:
[github.com/ADWilkinson/hlprivateer.xyz](https://github.com/ADWilkinson/hlprivateer.xyz)

---

## What this is

An experiment in trading [HIP-4 outcome
contracts](https://blog.quicknode.com/hip4-hyperliquid-outcome-contracts/) on
Hyperliquid using sentiment as the edge signal.

Outcome contracts are binary: they settle to **0 or 1 in USDH** based on a
real-world event, and trade between the two on the same CLOB as spot/perp.
Price is implied probability. Sentiment is a fuzzier estimate of the same
thing. The experiment is whether the gap between them is tradeable.

The pipeline:

```
news/x/farcaster ──► apps/sentinel ──► hlpv2.sentiment ──► apps/oracle
                       (LLM scorer)                          │
                                                             │ SNT → estimate
                                                             │ EXE → proposal
                                                             │ RSK → fail-closed gates
                                                             ▼
                                                       Hyperliquid HIP-4
```

## How it works

- **Sentinel** (`apps/sentinel`) polls pluggable sources, scores each item via
  an LLM (Claude/Codex), and emits a `SentimentSignal` per item onto the
  `hlpv2.sentiment` Redis stream.
- **Oracle** (`apps/oracle`) is the orchestrator. It consumes sentiment, runs
  three roles, and serves the public HTTP/WS surface in one process:
  - **SNT** aggregates signals and estimates a probability `p̂` per market.
  - **EXE** builds an `OutcomeProposal` (side, limit, Kelly-sized stake).
  - **RSK** evaluates the proposal through 13 fail-closed gates. ALLOW or DENY.
- **outcome-engine** is the pure-math core: weighted sentiment aggregation,
  Bayesian-style probability update, edge calculation, binary Kelly.
- **outcome-risk** is the deterministic gate library: pure functions, no I/O,
  fail-closed, single-failure short-circuit.

## Risk gates (13)

In order, cheapest first:

1. `OPERATOR_HALT`
2. `INVALID_PROPOSAL`
3. `STALE_SENTIMENT`
4. `MARKET_NOT_TRADING`
5. `RESOLUTION_TOO_SOON`
6. `RESOLUTION_TOO_FAR`
7. `CHALLENGE_WINDOW_OPEN`
8. `EDGE_TOO_THIN`
9. `STAKE_PER_MARKET`
10. `CONCURRENT_MARKETS`
11. `CORRELATED_EXPOSURE`
12. `BANKROLL_DEPLETED`
13. `LOW_LIQUIDITY`

Any failure = **DENY**.

## Monorepo

```
apps/
├── oracle/              Orchestrator (3-role crew + HTTP API + WS broadcast)
├── sentinel/            Sentiment ingestion + LLM scoring
└── web/                 Next.js landing + /floor + /v1 retrospective

packages/
├── contracts/           Zod schemas (single source of truth)
├── outcome-engine/      Pure math: aggregate, estimate, edge, Kelly, propose
├── outcome-risk/        Pure fail-closed risk gates
├── strategy/            Strategy config loader (gitignored JSON + template)
├── event-bus/           Redis Streams abstraction (in-memory fallback)
└── hl-client/           Hyperliquid HTTP transport (rate-limited, cached)

legacy/
├── apps/                v1: runtime, api, agent-runner, ws-gateway
├── packages/            v1: risk-engine, plugin-sdk, agent-sdk, erc8004, contracts-v1
└── docs/                v1: SPEC, AGENT_RUNNER, GO_LIVE, X402_SELLER_QUICKSTART, audit
```

## Quick start

```bash
bun install
bun run typecheck      # all v2 packages + apps
bun run test           # vitest across the workspace

# Run the full pipeline locally (in-memory bus, fixture markets, dry-run router)
(cd apps/oracle && bun run dev) &
(cd apps/sentinel && SENTINEL_FIXTURE=apps/sentinel/fixtures/items.json bun run dev) &

# Inspect
curl http://127.0.0.1:4100/v1/public/markets
curl http://127.0.0.1:4100/v1/public/floor
```

### Lean on Hyperliquid for accountancy

Positions, equity, and fills are exchange truth — we don't reinvent them.
The orchestrator depends on an **`Accountant`** interface; two implementations:

- **`HyperliquidAccountant`** (default when `ORACLE_HL_USER` is set) — reads
  `clearinghouseState` from Hyperliquid for positions and equity, with a
  TTL cache so risk gates don't stampede the info endpoint. On startup,
  `warmup()` reconciles in-process state with the exchange. Degrades
  gracefully when HL is unreachable: serves last-known values rather than
  failing.
- **`LocalAccountant`** (fallback for dev / DryRun) — in-process state
  driven by simulated fills. No HL connection required.

Risk gates ask the accountant; nothing in our code is a "source of truth"
for what's open on the exchange.

```bash
ORACLE_HL_USER=0xYourWallet         # enables HyperliquidAccountant
ORACLE_HL_TESTNET=1                 # optional — point at testnet
ORACLE_HL_API_URL=...               # optional — override base URL
ORACLE_HL_INFO_URL=...              # optional — override /info URL
ORACLE_HL_RPM=1000                  # rate limit (default 1000/min)
ORACLE_HL_TTL_MS=4000               # accountant cache TTL
ORACLE_PNL_BASELINE_USD=10000       # baseline for /v1/public/floor pnlPct%
```

### Wire up real markets / orders

Two remaining adapters that go live when `@nktkas/hyperliquid` surfaces
HIP-4 endpoints:

- **`OutcomeMarketProvider`** (`apps/oracle/src/markets.ts`) — currently
  `FixtureMarketProvider` (JSON). Live HL provider is a one-file add.
- **`OrderRouter`** (`apps/oracle/src/order-router.ts`) — currently
  `DryRunRouter` (simulated fill). Live router is another one-file add.

## Strategy (private, gitignored)

The repo is public; the strategy isn't. Risk knobs, the LLM system prompt,
source-trust priors, estimation parameters, and the market filter all live
in a single file:

```bash
cp config/strategy.template.json config/strategy.json
$EDITOR config/strategy.json   # gitignored — your real strategy goes here
```

Resolution order at startup (first hit wins): `STRATEGY_CONFIG_PATH` env →
`config/strategy.json` → `config/strategy.template.json` → schema defaults.

Every field in the JSON is optional; missing keys fall back to the Zod
defaults in `StrategyConfigSchema` (see `packages/contracts/src/index.ts`).

The framework — gates, orchestrator, audit chain, schemas, HTTP API,
sentinel scaffolding — stays public.

## Tech stack

| Layer       | Choice                                    |
|-------------|-------------------------------------------|
| Runtime     | Bun, TypeScript 5.7                       |
| Build       | Turborepo                                 |
| Schemas     | Zod                                       |
| Event bus   | Redis 7 (Streams) with in-memory fallback |
| Exchange    | Hyperliquid (`@nktkas/hyperliquid`)       |
| Agent LLMs  | Claude / Codex (structured output)        |
| Web         | Next.js 15, Tailwind, ASCII aesthetic     |

## Key design invariants (ported from v1)

- **AI proposes, never executes.** `outcome-risk.evaluate()` is the only path
  to ALLOW; `OrderRouter.place()` is the only path to a fill.
- **Fail-closed.** Any dependency error or failed gate denies the proposal.
  Single-failure short-circuit by design.
- **Hash-chained audit.** Every estimate / proposal / decision / fill is
  appended to `hlpv2.audit` with a SHA-256 prev-hash chain.
- **Privacy by default.** Public HTTP exposes pHat / edge / question only —
  no positions, no notional, no bankroll.
- **Pure-function gates.** `outcome-risk` and `outcome-engine` have zero I/O
  and a deterministic test surface.

## Disclaimer

This is experimental software for research and operational automation. It is
not financial advice. All trading decisions and losses are the sole
responsibility of the operator. Use at your own risk.

## License

MIT
