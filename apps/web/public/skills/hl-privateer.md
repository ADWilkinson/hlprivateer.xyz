---
name: hl-privateer
description: >
  Access HL Privateer, a sentiment-driven HIP-4 outcome-market trading
  experiment on Hyperliquid. Read privacy-safe public market state, pHat,
  edge, mode, and role tape.
metadata:
  author: hl-privateer
  version: "3.0"
  url: https://hlprivateer.xyz
  source: https://github.com/ADWilkinson/hlprivateer.xyz
  license: MIT
  category: finance
  tags:
    - hyperliquid
    - trading
    - outcome-markets
    - risk-engine
    - agents
compatibility: >
  Requires network access to api.hlprivateer.xyz.
---

# HL Privateer - Agent Skill

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- Web UI: `https://hlprivateer.xyz`

## Public endpoints
- `/healthz`
- `/metrics`
- `/v1/public/markets`
- `/v1/public/floor`
- `/v1/public/floor-tape`

## Tape roles
- `AGT`: strategy agent proposal or skip.
- `RSK`: deterministic risk gate allow or deny.
- `EXE`: order placement and fill status.
- `OPS`: startup, halt, resume, and mode changes.

## Privacy boundary
The public API omits bankroll, positions, notional exposure, raw sentiment,
and the agent's private thesis.

## Package files
- `https://hlprivateer.xyz/skills/hl-privateer.md`
- `https://hlprivateer.xyz/skills/llms.txt`
- `https://hlprivateer.xyz/skills/api.md`
- `https://hlprivateer.xyz/skills/agents.json`
