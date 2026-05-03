---
name: hl-privateer
description: Interact with HL Privateer v3, an agentic outcome market trading experiment on Hyperliquid HIP-4. Read public market state (questions, market price, model probability pHat, edge, resolution time) over HTTP. v1 (perp discretionary desk) is concluded; v1 agent endpoints are archived under /legacy in the repo.
metadata:
  author: hl-privateer
  version: 3.0.0
  homepage: https://hlprivateer.xyz
  repository: https://github.com/ADWilkinson/hlprivateer.xyz
---

# HL Privateer v3 — Agentic outcome market trading

## What this is

An experimental, self-hosted trading agent for HIP-4 outcome contracts on
Hyperliquid. Outcome contracts are binary — they settle to 0 or 1 in USDH on
the same CLOB as spot/perp, and the trading price ∈ [0,1] is the market's
implied probability of YES. A StrategyAgent (LLM) reads market state plus
recent raw sentiment items and proposes a single order; deterministic Kelly
clipping, exposure caps, and 14 fail-closed risk gates decide whether the
proposal is allowed to reach the operator's order router.

Hyperliquid is the source of truth for accountancy: positions and equity
are read from `clearinghouseState`, not maintained locally. There are no
fallbacks or simulators in the production code path.

## v3 vs v2

v2 was a two-process system (sentinel + oracle) communicating over Redis
Streams, with six internal packages and a static aggregate-then-blend math
pipeline. v3 collapses everything into one app, drops the bus, drops the
internal packages, and replaces the static math pipeline with a single
`StrategyAgent.propose()` seam. The agent is the only dynamic piece;
everything around it is pure-function plumbing.

## Public endpoints

Base URL: `https://api.hlprivateer.xyz`

| Endpoint                       | Description                                              |
|--------------------------------|----------------------------------------------------------|
| `GET /healthz`                 | Mode (`INIT` / `READY` / `HALT`) + metrics + equityUsd   |
| `GET /metrics`                 | Prometheus 0.0.4: mode + equity gauge + counters         |
| `GET /v1/public/markets`       | Markets with `yesPrice`, `pHat`, `edge`, `topicTags`     |
| `GET /v1/public/floor`         | Mode + markets + recent role tape + pnlPct (vs baseline) |
| `GET /v1/public/floor-tape`    | Recent role tape only (last ~50 lines)                   |

### `GET /v1/public/markets` shape

```json
{
  "markets": [
    {
      "id": "mkt-fed-pause-2026q3",
      "question": "Will the Fed pause rate hikes at the September 2026 meeting?",
      "status": "trading",
      "yesPrice": 0.62,
      "pHat": 0.68,
      "edge": 0.06,
      "resolutionAt": "2026-09-18T18:00:00.000Z",
      "topicTags": ["macro", "fed", "rates"]
    }
  ]
}
```

### `GET /v1/public/floor` shape

```json
{
  "mode": "READY",
  "pnlPct": null,
  "marketsTracked": 12,
  "markets": [ /* PublicMarket[] */ ],
  "tape": [
    { "ts": "2026-05-01T12:00:00Z", "role": "AGT", "message": "mkt-fed-pause: pHat=68% (mkt 62%) YES@0.620 $200 edge +6.0pp" }
  ]
}
```

Tape roles:
- `AGT` — strategy agent decisions (propose / skip).
- `RSK` — risk-gate decisions (ALLOW / DENY + failure codes).
- `EXE` — order placement and fill confirmations.
- `OPS` — operator events (start, halt, resume).

## Use cases

- **Cross-reference your own outcome models against pHat/edge.** Pull
  `/v1/public/markets`, compare your estimate, decide whether to act on your
  own venue.
- **Watch the role tape.** `floor-tape` exposes the AGT/RSK/EXE/OPS narrative
  in chronological order — useful as a low-cost agent activity feed.
- **Build dashboards.** All endpoints are CORS-enabled and JSON-native.

## What's *not* exposed

- No raw positions, notionals, or bankroll on the public surface.
- No agent thesis (private to operator).
- No raw sentiment items (private; the agent ingests them).

## v1 (concluded)

The first HL Privateer experiment was a 7-role discretionary perp trading
crew. Its agent surface (positions, copy-trade signals, x402 paid analysis) is
archived with the v1 code under
[`/legacy`](https://github.com/ADWilkinson/hlprivateer.xyz/tree/main/legacy).
