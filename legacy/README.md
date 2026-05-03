# v1 — Discretionary Perp Trading Desk (concluded)

> **Status:** Concluded experiment. Code preserved here for reference.
> **Successor:** v3 — Sentiment-driven HIP-4 outcome-market agent (root
> of repo). On-site retrospective at
> [`/v1`](https://hlprivateer.xyz/v1).

A self-hosted, agentic Hyperliquid trading platform. A 7-role LLM crew
(Claude / Codex CLIs producing structured output) proposed discretionary
long/short perp trades. A deterministic risk engine hard-gated every order.
An ASCII trade floor streamed it all live. The whole thing ran on a single
home server behind a Cloudflare Tunnel, with x402 pay-per-call endpoints
exposing read-only signals to external agents.

v1 ran for several weeks. The architecture worked; the risk engine worked;
the audit chain worked. The trading primitive (leveraged perps) is just not
what we wanted to keep building on.

---

## Why it's archived

- **HIP-4 changed the surface area.** Hyperliquid shipped native outcome
  contracts: binary instruments that settle 0 or 1 in USDH on the same
  CLOB as spot/perp. The trading primitive is meaningfully different from
  leveraged directional perps — risk gates, sizing, and agent roles all
  needed a clean rewrite, not a refactor.
- **The pattern is what mattered, not the perp specifics.** "AI proposes,
  deterministic risk engine hard-gates, hash-chained audit trail,
  fail-closed on dependency failure" — those invariants port forward. The
  perp-specific encoding (leverage, drawdown%, slippage bps, fire-and-forget
  SL/TP) does not.
- **Surface-area cut.** v1 ran 7 LLM roles (scout / research / strategist /
  execution / scribe / risk / ops) and split the runtime across 4 services.
  v3 collapses to one strategy seam and one trading runtime. Sentiment-
  derived probability is a narrower job than full discretionary regime
  analysis, and outcome trading is event-driven and stateless per proposal
  — the v1 split was overkill for it.

## What we shipped

- **11 fail-closed risk gates** — pure functions, no I/O, single-failure
  short-circuit. Any DENY blocked the order; the OMS could not place
  anything the engine hadn't ALLOWed.
- **AI proposes, never executes** — agents emitted structured
  `StrategyProposal` objects with conviction scores; only the runtime
  called the OMS.
- **Fire-and-forget trades** — SL/TP submitted on Hyperliquid at entry. No
  trailing stops, no runtime rebalancing. Either the trade hit a target
  on-exchange or got flattened by an operator command.
- **Hash-chained audit trail** — SHA-256 prev-hash chain across every
  proposal, decision, fill, and operator command. Replay-capable
  end-to-end.
- **x402 machine payments** — pay-per-call HTTP endpoints (USDC on Base)
  exposed obfuscated signals, copy-trade data, and AI analysis. Bot-to-bot
  markets without API keys or sign-ups.
- **State machine** — INIT → WARMUP → READY ↔ IN_TRADE, with HALT
  (operator kill-switch) and SAFE_MODE (dependency failure → only
  risk-reducing actions allowed).
- **ERC-8004 identity** — on-chain agent identity for x402 negotiation.
- **ASCII trade floor** — real-time operator UI; role avatars (SCT, RCH,
  RSK, STR, EXE, SCR, OPS) narrating decisions live.

## What we learned

- The hard-gate pattern is the right shape. An LLM crew producing structured
  proposals + a deterministic engine that's the only path to ALLOW + a
  hash-chained audit trail = a system you can actually reason about.
- Fire-and-forget was correct for perps. Most "smart" runtime rebalancing
  makes the system fragile in ways the audit trail can't capture. Submit
  SL/TP at entry, let the exchange handle exits, treat fills as
  observations.
- 7 roles was too many. Scout / Research / Strategist / Scribe blurred
  together in practice.
- Maintaining parallel state is fragile. v1 had its own positions ledger
  reconciled against Hyperliquid; the reconciliation was a constant source
  of drift bugs. v3 reads exchange state directly via `clearinghouseState`
  and never claims to know better.
- Discretionary perps weren't the venue. Leveraged directional trading on
  a CLOB is a deeply competitive space. Outcome markets — binary, settled,
  sentiment-correlated — are a more interesting fit for an LLM-driven edge.

## What carried forward to v3

- The pattern: AI proposes, deterministic gates permit or deny, and every
  proposal/decision/fill/failure is written to an append-only audit.
- Pure-function discipline. Gates and engine math have zero I/O,
  deterministic test surface, single-failure short-circuit.
- Privacy by default — public surface exposes pHat / edge / question only.
- Hyperliquid as the source of truth. The active accountant reads
  `clearinghouseState`; no parallel ledger claims to know better.
- Role-tape clarity. v1's floor became the public AGT / RSK / EXE / OPS
  tape on the v3 product site.

## What got nuked

- The 11 perp-specific risk gates (leverage, drawdown%, slippage bps,
  exposure caps, etc.) — replaced with 14 outcome-market gates (resolution
  horizon, challenge window, edge threshold, proposal expiry, ...).
- The 4 perp-flavoured services (runtime + api + ws-gateway + agent-runner)
  — collapsed into a single `apps/agent` process.
- x402 paid-data endpoints — interesting experiment but a distraction from
  the trading question. v3 has a smaller free public surface.
- The 7-role crew — replaced with one dynamic `StrategyAgent` seam and
  deterministic RSK / EXE plumbing.

## What's in this directory

```
legacy/
├── README.md                  This retrospective.
├── AGENT.md / API.md / RUNBOOK.md / SECURITY.md
│                              Original v1 operator docs.
├── apps/
│   ├── runtime/               OMS + state machine (perp lifecycle).
│   ├── api/                   Fastify REST API (perp positions, copy/trade).
│   ├── agent-runner/          7-role LLM crew orchestration.
│   └── ws-gateway/            WebSocket fanout for the ASCII floor.
├── packages/
│   ├── contracts-v1/          Frozen v1 Zod schemas.
│   ├── risk-engine/           11 sequential perp risk gates (pure functions).
│   ├── plugin-sdk/            External plugin contract for signal feeds.
│   ├── agent-sdk/             External agent client (handshake, x402, commands).
│   └── erc8004/               Identity / ERC-8004 plumbing.
├── docs/
│   ├── SPEC.md                Full v1 architecture + technical design.
│   ├── AGENT_RUNNER.md        LLM agent development guide.
│   ├── GO_LIVE.md             Live trading checklist.
│   ├── X402_SELLER_QUICKSTART.md   x402 integration guide.
│   └── audit/                 Audit format + replay tooling docs.
├── infra/                     Docker Compose, systemd units, Cloudflared,
│                              observability (OTel + Prom + Loki + Grafana).
└── scripts-{ops,erc8004,cloudflare,readiness,x402}/
                                Original v1 ops + readiness scripts.
```

## Build status

The legacy tree is **excluded from the active workspace**: root
`package.json` only globs `apps/*`, not `legacy/*`. `bun install` /
`bun run build` at the repo root will not touch this directory.

If you want to dust off a legacy package locally, you'll need to install
its deps directly (`cd legacy/apps/runtime && bun install`) and rewire any
`workspace:*` references that have moved or been renamed since v1.

Treat this directory as a frozen reference. Not a buildable target.
