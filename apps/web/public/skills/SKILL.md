# HL Privateer SKILL

## What this skill provides
Machine access to HL Privateer paid and public endpoints with an x402 entitlement flow.

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`

## Agent Access Flow
1. `POST /v1/agent/handshake`
2. `POST /v1/agent/verify`
3. Send `x-agent-entitlement` on paid requests

## Paid endpoints
- `$0.01`: `/v1/agent/stream/snapshot`, `/v1/agent/analysis`, `/v1/agent/analysis/latest`, `/v1/agent/positions`, `/v1/agent/orders`
- `$0.02`: `/v1/agent/insights`, `/v1/agent/data/overview`
- `$0.03`: `/v1/agent/copy-trade/signals`, `/v1/agent/copy-trade/positions`

## Free endpoints
- `/v1/public/pnl`
- `/v1/public/floor-snapshot`
- `/v1/public/floor-tape`
- `/v1/public/identity`
- `/healthz`

## Discovery links
- `https://hlprivateer.xyz/.well-known/agents.json`
- `https://hlprivateer.xyz/.well-known/x402`
- `https://hlprivateer.xyz/.well-known/agent-registration.json`
