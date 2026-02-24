# Agent Index (HL Privateer)

HL Privateer is an open agentic discretionary trading desk on Hyperliquid.
External agents can read paid desk data through x402 entitlement flow.

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`
- Web UI: `https://hlprivateer.xyz`

## Agent Access (x402)
1. `POST /v1/agent/handshake` with `agentId`, `requestedTier`, and bootstrap `proof`.
2. `POST /v1/agent/verify` with `challengeId` plus proof payload (JSON body or `PAYMENT-SIGNATURE`).
3. Call paid routes with `x-agent-entitlement: <challengeId>`.

## Paid routes
- `$0.01`: `/v1/agent/stream/snapshot`, `/v1/agent/positions`, `/v1/agent/orders`, `/v1/agent/analysis`, `/v1/agent/analysis/latest`
- `$0.02`: `/v1/agent/insights`, `/v1/agent/data/overview`
- `$0.03`: `/v1/agent/copy-trade/signals`, `/v1/agent/copy-trade/positions`

## Free routes
- `/v1/public/pnl`
- `/v1/public/floor-snapshot`
- `/v1/public/floor-tape`
- `/v1/public/identity`
- `/healthz`

## Discovery docs
- `https://hlprivateer.xyz/.well-known/x402`
- `https://hlprivateer.xyz/.well-known/agents.json`
- `https://hlprivateer.xyz/.well-known/agent-registration.json`
- `https://hlprivateer.xyz/llms.txt`
- `https://hlprivateer.xyz/skills.md`
