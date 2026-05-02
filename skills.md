---
name: hl-privateer
description: Interact with HL Privateer v2, a sentiment-driven outcome market trading experiment on Hyperliquid HIP-4. Read public market state (questions, market price, model probability pHat, edge, resolution time) over HTTP. v1 (perp discretionary desk) is concluded; v1 agent endpoints are archived under /legacy in the repo.
metadata:
  author: hl-privateer
  version: 2.0.0
  homepage: https://hlprivateer.xyz
  repository: https://github.com/ADWilkinson/hlprivateer.xyz
---

# HL Privateer v2 — Sentiment-driven outcome market trading

## What this is

An experimental, self-hosted trading agent for HIP-4 outcome contracts on
Hyperliquid. Outcome contracts are binary — they settle to 0 or 1 in USDH on
the same CLOB as spot/perp, and the trading price ∈ [0,1] is the market's
implied probability of YES. The agent estimates a probability `pHat` from
weighted sentiment signals and trades the gap when it exceeds an edge
threshold and clears 13 fail-closed risk gates.

## Public endpoints

Base URL: `https://api.hlprivateer.xyz`

| Endpoint                       | Description                                              |
|--------------------------------|----------------------------------------------------------|
| `GET /healthz`                 | Health check + runtime mode (`INIT` / `READY` / `HALT`)  |
| `GET /v1/public/markets`       | Markets with `yesPrice`, `pHat`, `edge`, `topicTags`     |
| `GET /v1/public/floor`         | Mode + markets + recent role tape                        |
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
    { "ts": "2026-05-01T12:00:00Z", "role": "SNT", "message": "mkt-fed-pause: pHat=68% (mkt 62%) edge +6.0pp" }
  ]
}
```

## Use cases

- **Cross-reference your own outcome models against pHat/edge.** Pull
  `/v1/public/markets`, compare your estimate, decide whether to act on your
  own venue.
- **Watch the role tape.** `floor-tape` exposes the SNT/RSK/EXE/OPS narrative
  in chronological order — useful as a low-cost agent activity feed.
- **Build dashboards.** All endpoints are CORS-enabled and JSON-native.

## What's *not* exposed

- No raw positions, notionals, or bankroll on the public surface.
- No proposal-level rationale (private to operator).
- No sentiment signal payloads (private; proposal aggregates only).

## v1 (concluded)

The first HL Privateer experiment was a 7-role discretionary perp trading
crew. Its agent surface (positions, copy-trade signals, x402 paid analysis) is
archived. If you previously consumed `/v1/agent/*` endpoints, those return
`410 Gone` — see [`/legacy`](https://github.com/ADWilkinson/hlprivateer.xyz/tree/main/legacy)
for the historical code.
