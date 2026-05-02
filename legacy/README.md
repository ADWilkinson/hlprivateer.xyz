# Legacy / v1 — Discretionary Perp Trading Crew

> **Status:** Concluded experiment. Code preserved here for reference.
> **Successor:** v2 — Sentiment-driven outcome market trading agents (root of repo).

This directory holds the original **HL Privateer v1** experiment: a self-hosted,
agentic Hyperliquid trading desk where a 7-role LLM crew proposed discretionary
long/short perpetual trades and a deterministic risk engine hard-gated every
execution. It ran on a single home server behind a Cloudflare Tunnel with
hash-chained audit trails and an x402-monetised agent API.

## Why it's archived

- **Hyperliquid HIP-4 changed the surface area.** Native outcome (binary
  prediction) markets settle 0/1 in USDH on the same CLOB as spot/perp. The
  trading primitive is meaningfully different from leveraged directional perps,
  so the risk gates, sizing, and agent roles needed a clean rewrite rather than
  a refactor.
- **The pattern is what mattered, not the perp specifics.** "AI proposes,
  deterministic risk engine hard-gates, hash-chained audit trail, fail-closed on
  dependency failure" — those invariants port forward. The code that encoded
  perp-specific assumptions (leverage, drawdown%, slippage bps, SL/TP fire-and-
  forget) does not.
- **Surface-area cut.** v1 shipped a 7-role crew (scout/research/strategist/
  execution/scribe/risk/ops). v2 collapses to 3 roles (Sentinel / Risk /
  Execution) — sentiment-derived probability is a narrower job than full
  discretionary regime analysis.

## What's in here

```
legacy/
├── apps/
│   ├── runtime/          OMS + state machine (perp lifecycle)
│   ├── api/              Fastify REST API (perp positions, copy/trade)
│   ├── agent-runner/     7-role LLM crew orchestration
│   └── ws-gateway/       WebSocket fanout for the ASCII floor
└── packages/
    ├── risk-engine/      11 sequential perp risk gates (pure functions)
    ├── plugin-sdk/       External plugin contract for signal feeds
    ├── agent-sdk/        External agent client (handshake, x402, commands)
    └── erc8004/          Identity / ERC-8004 plumbing
```

## Build status

The legacy tree is **excluded from the active workspace** (`package.json`
workspaces and `pnpm-workspace.yaml` only glob `apps/*` and `packages/*`, not
`legacy/*`). Running `bun install` / `bun run build` at the repo root will not
touch this directory.

To rebuild legacy locally:

```bash
cd legacy/apps/runtime && bun install && bun run build
```

…and so on per package. Cross-package `workspace:*` references will not resolve
without ad-hoc rewiring; this is intentional. Treat it as a frozen reference,
not a buildable target.

## Documentation index (frozen)

The original v1 documents are preserved in the repo root with their historical
content (`README.md` predecessor sections), and full architecture lives under
`docs/SPEC.md`, `docs/AGENT_RUNNER.md`, `docs/GO_LIVE.md`, `RUNBOOK.md`,
`SECURITY.md`, `API.md`. Those still describe v1.

## What v2 keeps from v1

- **`packages/event-bus/`** — Redis Streams abstraction with in-memory fallback.
  Generic enough to carry forward unchanged.
- **`packages/hl-client/`** — Hyperliquid client wrapper around
  `@nktkas/hyperliquid`. Same exchange, same SDK; outcome markets surface
  through it too.
- **The fail-closed risk pattern** — re-implemented in
  `packages/outcome-risk/` with outcome-market-specific gates (stake-per-market,
  resolution horizon, challenge window, correlated exposure, stale sentiment,
  edge threshold).
- **Hash-chained audit envelopes** — same `EventEnvelope` shape, different
  stream namespace (`hlpv2.*`).
