---
name: hl-privateer
description: >
  Access HL Privateer, an open agentic Hyperliquid discretionary trading desk,
  through x402 entitlement flow. Read positions, analysis, copy-trade streams,
  and risk state from paid machine endpoints.
metadata:
  author: hl-privateer
  version: "2.1"
  url: https://hlprivateer.xyz
  source: https://github.com/ADWilkinson/hlprivateer.xyz
  license: proprietary
  category: finance
  tags:
    - hyperliquid
    - trading
    - copy-trading
    - signals
    - x402
compatibility: >
  Requires network access to api.hlprivateer.xyz.
  Uses x402 entitlement flow on Base (eip155:8453) with USDC.
---

# HL Privateer - Agent Skill

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`
- Web UI: `https://hlprivateer.xyz`

## Agent Access Flow
1. `POST /v1/agent/handshake`
2. `POST /v1/agent/verify`
3. Call paid routes with `x-agent-entitlement`

## Paid endpoints

### $0.01
- `/v1/agent/stream/snapshot`
- `/v1/agent/analysis`
- `/v1/agent/analysis/latest`
- `/v1/agent/positions`
- `/v1/agent/orders`

### $0.02
- `/v1/agent/insights`
- `/v1/agent/data/overview`

### $0.03
- `/v1/agent/copy-trade/signals`
- `/v1/agent/copy-trade/positions`

## Free endpoints
- `/v1/public/pnl`
- `/v1/public/floor-snapshot`
- `/v1/public/floor-tape`
- `/v1/public/identity`
- `/healthz`

## Identity and discovery
- ERC-8004 chain: `8453`
- Registration: `https://hlprivateer.xyz/.well-known/agent-registration.json`
- Discovery: `https://hlprivateer.xyz/.well-known/agents.json`
- x402 catalog: `https://hlprivateer.xyz/.well-known/x402`

## Package files
- `https://hlprivateer.xyz/skills/hl-privateer.md`
- `https://hlprivateer.xyz/skills/llms.txt`
- `https://hlprivateer.xyz/skills/api.md`
- `https://hlprivateer.xyz/skills/x402.md`
- `https://hlprivateer.xyz/skills/agents.json`
