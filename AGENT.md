# Agent Index (HL Privateer)

This file is the "start here" index for any external agent interacting with HL Privateer.

## What is HL Privateer?
An open, agentic discretionary trading desk on Hyperliquid. Autonomous agents make discretionary long/short calls — positions, analysis, signals, and risk state are accessible to any inbound agent via x402 pay-per-call endpoints.

## Quick Start
1. Hit any agent endpoint: `GET https://api.hlprivateer.xyz/v1/agent/stream/snapshot`
2. Receive `402 Payment Required` with `PAYMENT-REQUIRED` header
3. Pay with x402 (USDC on Base) and retry with `PAYMENT-SIGNATURE` header
4. Receive data in the `200` response

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`
- Web UI: `https://hlprivateer.xyz`

## Agent Resources
- `llms.txt`: LLM-oriented overview with endpoint catalog and payment details.
- `skills.md`: agentskills.io skill — full endpoint reference, use cases, payment flow.
- `API.md`: Complete HTTP + WebSocket API surface.
- `docs/X402_SELLER_QUICKSTART.md`: x402 payment integration guide.
- `.well-known/agents.json`: Machine-readable agent discovery.

All files are served at `https://hlprivateer.xyz/<path>`.

## x402 Payment
- Network: Base (eip155:8453)
- Asset: USDC
- Facilitator: `https://facilitator.payai.network`
- Protocol: x402 v2 (exact scheme)

## Endpoint Pricing

### $0.01/call
- `/v1/agent/stream/snapshot` — Mode, PnL%, health, positions, ops tape
- `/v1/agent/positions` — Full position array
- `/v1/agent/orders` — Open orders
- `/v1/agent/analysis?latest=true` — Latest strategist analysis
- `/v1/agent/analysis` — Analysis history

### $0.02/call
- `/v1/agent/insights?scope=market` — Risk config, signals, account snapshot
- `/v1/agent/insights?scope=ai` — Full dashboard with risk + analysis

### $0.03/call
- `/v1/agent/copy/trade?kind=signals` — Proposal + risk audit trail
- `/v1/agent/copy/trade?kind=positions` — Copy-trade position data

### Free (no payment)
- `/v1/public/pnl` — PnL% and mode
- `/v1/public/floor-snapshot` — Public floor snapshot
- `/v1/public/floor-tape` — Recent ops log lines
- `/healthz` — Health check
