# HL Privateer

> **v2 — Sentiment-driven outcome market trading agents on Hyperliquid (HIP-4).**
>
> v1 (discretionary perp trading desk) is concluded. The code is preserved
> under [`legacy/`](legacy/), the on-site retrospective lives at
> [`/v1`](https://hlprivateer.xyz/v1), and the writeup is in
> [`legacy/README.md`](legacy/README.md). Read those if you want the
> story of what came before.

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
  an LLM you wire in (`SENTINEL_LLM_COMMAND`), and emits a `SentimentSignal`
  per item onto the `hlpv2.sentiment` Redis stream.
- **Oracle** (`apps/oracle`) is the orchestrator. It consumes sentiment, runs
  three roles, and serves the public HTTP surface in one process:
  - **SNT** aggregates signals and estimates a probability `p̂` per market.
  - **EXE** builds an `OutcomeProposal` (side, limit, Kelly-sized stake).
  - **RSK** evaluates the proposal through 14 fail-closed gates. ALLOW or DENY.
- **outcome-engine** is the pure-math core: weighted sentiment aggregation,
  Bayesian-style probability update, edge calculation, binary Kelly.
- **outcome-risk** is the deterministic gate library: pure functions, no I/O,
  fail-closed, single-failure short-circuit.
- **HyperliquidAccountant** is the source of truth for positions and equity —
  it reads `clearinghouseState` from HL with a TTL cache. We don't maintain
  parallel state.

## Risk gates (14)

In order, cheapest first:

1. `OPERATOR_HALT`
2. `INVALID_PROPOSAL`
3. `PROPOSAL_EXPIRED`
4. `STALE_SENTIMENT`
5. `MARKET_NOT_TRADING`
6. `RESOLUTION_TOO_SOON`
7. `RESOLUTION_TOO_FAR`
8. `CHALLENGE_WINDOW_OPEN`
9. `EDGE_TOO_THIN`
10. `STAKE_PER_MARKET`
11. `CONCURRENT_MARKETS`
12. `CORRELATED_EXPOSURE`
13. `BANKROLL_DEPLETED`
14. `LOW_LIQUIDITY`

Any failure = **DENY**.

## Monorepo

```
apps/
├── oracle/              Orchestrator (3-role crew + HTTP API) + wiring.template.ts
├── sentinel/            Sentiment ingestion + LLM scoring (shell-out completer)
└── web/                 Next.js landing + /floor + /v1 retrospective

packages/
├── contracts/           Zod schemas (single source of truth)
├── outcome-engine/      Pure math: aggregate, estimate, edge, Kelly, propose
├── outcome-risk/        Pure fail-closed risk gates (14)
├── strategy/            Strategy config loader (gitignored JSON + template)
├── event-bus/           Redis Streams abstraction (in-memory test impl)
└── hl-client/           Hyperliquid HTTP transport + typed info wrappers

config/
├── strategy.template.json   Public defaults (committed)
└── strategy.json            Operator's real strategy (gitignored)

legacy/
├── README.md            v1 retrospective writeup
├── apps/                v1: runtime, api, agent-runner, ws-gateway
├── packages/            v1: risk-engine, plugin-sdk, agent-sdk, erc8004, contracts-v1
└── docs/                v1: SPEC, AGENT_RUNNER, GO_LIVE, X402_SELLER_QUICKSTART, audit
```

## No fallbacks

There are no built-in simulators, fake data sources, or "kicks in if the
real thing isn't configured" paths in this repo. Production paths require
real Hyperliquid access. Tests inline their own fakes where they need them.

What that means in practice:

- **No `LocalAccountant`** — `HyperliquidAccountant` only. HL errors propagate.
- **No `DryRunRouter`** — operator wires the real router in `apps/oracle/wiring.ts`.
- **No `FixtureMarketProvider`** — operator wires the real market provider too.
- **No `HeuristicScorer`** — sentinel requires `SENTINEL_LLM_COMMAND` (a shell
  that pipes a prompt over stdin and emits the model response on stdout).

If a required env var or wiring file is missing, the binary refuses to start.

## Quick start

```bash
bun install
bun run typecheck    # all v2 packages + apps
bun run test         # 87 vitest cases across the workspace
bun run build        # production build

# Wire HL access:
export ORACLE_HL_USER=0xYourWalletAddress     # required
export ORACLE_OPERATOR_TOKEN=...              # required for /v1/operator/*
export SENTINEL_LLM_COMMAND="claude -p"       # required for sentinel

cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts
$EDITOR apps/oracle/wiring.ts                 # implement against HL HIP-4

cp config/strategy.template.json config/strategy.json
$EDITOR config/strategy.json                  # your real strategy

# Run
(cd apps/oracle && bun run dev) &
(cd apps/sentinel && SENTINEL_FIXTURE=path/to/items.json bun run dev) &

curl http://127.0.0.1:4100/healthz
curl http://127.0.0.1:4100/v1/public/floor
```

## Hyperliquid is the source of truth

Positions, equity, fills — exchange truth. The orchestrator depends on the
**`Accountant`** interface, implemented by `HyperliquidAccountant` which
reads `clearinghouseState` (TTL-cached) and `userFillsByTime`. HL errors
are not swallowed — they propagate, the orchestrator fails the call, and
the operator's monitoring catches it.

```bash
ORACLE_HL_USER=0xYourWallet         # required
ORACLE_HL_TESTNET=1                 # optional — point at testnet
ORACLE_HL_API_URL=...               # optional — override base URL
ORACLE_HL_INFO_URL=...              # optional — override /info URL
ORACLE_HL_RPM=1000                  # rate limit (default 1000/min)
ORACLE_HL_TTL_MS=4000               # accountant cache TTL
ORACLE_PNL_BASELINE_USD=10000       # baseline for /v1/public/floor pnlPct%
```

## Operator wiring (markets + router)

`@nktkas/hyperliquid` does not yet surface HIP-4 outcome-market endpoints,
so `OutcomeMarketProvider` and `OrderRouter` are operator-owned. Copy the
template and implement against your HL access:

```bash
cp apps/oracle/wiring.template.ts apps/oracle/wiring.ts   # gitignored
```

`apps/oracle/wiring.ts` exports `makeMarketProvider(hl)` and
`makeOrderRouter(hl)`. Oracle main refuses to start until the file exists
and both are implemented. There is no shipped fake.

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

## HTTP surface

| Method | Path                         | Auth   | Notes                                  |
|--------|------------------------------|--------|----------------------------------------|
| GET    | `/healthz`                   | —      | mode + metrics + equity + open markets |
| GET    | `/metrics`                   | —      | Prometheus 0.0.4 (mode + 6 counters)   |
| GET    | `/v1/public/markets`         | —      | List with pHat + edge                  |
| GET    | `/v1/public/floor`           | —      | Mode + markets + recent role tape      |
| GET    | `/v1/public/floor-tape`      | —      | Recent role tape only                  |
| POST   | `/v1/operator/halt`          | Bearer | 401 when token unset (fail-closed)     |
| POST   | `/v1/operator/resume`        | Bearer | Same                                   |

## Tech stack

| Layer       | Choice                                       |
|-------------|----------------------------------------------|
| Runtime     | Bun, TypeScript 5.7                          |
| Build       | Turborepo                                    |
| Schemas     | Zod                                          |
| Event bus   | Redis 7 (Streams), in-memory impl for tests  |
| Exchange    | Hyperliquid (`@nktkas/hyperliquid`)          |
| Agent LLMs  | Claude / Codex (operator-supplied via shell) |
| Web         | Next.js 15, Tailwind, ASCII aesthetic        |

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
- **Hyperliquid is the source of truth.** Positions and equity are read from
  HL, not maintained locally. No parallel ledger.

## Documentation

| Path | What |
|------|------|
| [`README.md`](README.md) | This file |
| [`docs/SPEC.md`](docs/SPEC.md) | v2 architecture + invariants |
| [`legacy/README.md`](legacy/README.md) | v1 retrospective |
| [`apps/oracle/README.md`](apps/oracle/README.md) | Orchestrator + HTTP API |
| [`apps/sentinel/README.md`](apps/sentinel/README.md) | Sentiment ingestion |
| [`packages/*/README.md`](packages/) | Per-package docs |
| [`llms.txt`](llms.txt) | LLM-friendly summary |
| [`skills.md`](skills.md) | agentskills.io skill manifest |

## Disclaimer

This is experimental software for research and operational automation. It is
not financial advice. All trading decisions and losses are the sole
responsibility of the operator. Use at your own risk.

## License

MIT
