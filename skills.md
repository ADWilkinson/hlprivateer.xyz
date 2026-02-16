---
name: hl-privateer
description: Interact with HL Privateer, an open agentic Hyperliquid trading desk. Access live positions, AI analysis, copy-trade signals, and risk state via x402 pay-per-call endpoints. Use when integrating trading signals, monitoring positions, copying trades, or consuming market analysis from hlprivateer.xyz.
metadata:
  author: hl-privateer
  version: "1.0"
  url: https://hlprivateer.xyz
compatibility: Requires network access to api.hlprivateer.xyz. Payment via x402 (USDC on Base).
---

# HL Privateer — Agent Skill

HL Privateer is an open, agentic discretionary trading desk on Hyperliquid. A fund of autonomous agents making discretionary long/short calls — positions, analysis, signals, and risk state are all accessible via paid x402 endpoints. No API keys. No sign-ups. Just x402.

## Quick Start

1. Hit any agent endpoint: `GET https://api.hlprivateer.xyz/v1/agent/stream/snapshot`
2. Receive `402 Payment Required` with `PAYMENT-REQUIRED` header containing payment instructions
3. Pay with x402 (USDC on Base) and retry with `PAYMENT-SIGNATURE` header
4. Receive data in the `200` response plus `PAYMENT-RESPONSE` settlement header

## Base URLs

- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`
- Web UI: `https://hlprivateer.xyz`
- Agent discovery: `https://hlprivateer.xyz/.well-known/agents.json`

## x402 Payment Details

- **Network**: Base (eip155:8453)
- **Asset**: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Facilitator**: `https://facilitator.payai.network`
- **Protocol**: x402 v2 (exact scheme)

### Payment Flow

```
Agent → GET /v1/agent/positions
Server → 402 + PAYMENT-REQUIRED header (Base64 JSON with price, network, payTo)
Agent → GET /v1/agent/positions + PAYMENT-SIGNATURE header (Base64 JSON signed payment)
Server → 200 + data + PAYMENT-RESPONSE header (settlement receipt)
```

## Paid Endpoints (x402)

All endpoints are GET requests. Pay per call via x402.

### Tier 1 — $0.01/call

| Endpoint | What You Get |
|----------|-------------|
| `/v1/agent/stream/snapshot` | Mode, PnL%, health, open positions, recent ops tape |
| `/v1/agent/positions` | Full position array — symbols, sides, sizes, entries, PnL |
| `/v1/agent/orders` | Open orders on the book |
| `/v1/agent/analysis?latest=true` | Latest AI strategist analysis with thesis and signals |
| `/v1/agent/analysis` | Analysis history (paginated, filterable by correlationId) |

### Tier 2 — $0.02/call

| Endpoint | What You Get |
|----------|-------------|
| `/v1/agent/insights?scope=market` | Risk config, signal timeline, account snapshot |
| `/v1/agent/insights?scope=ai` | Full dashboard: floor state, risk, analysis, copy summary |

### Tier 3 — $0.03/call

| Endpoint | What You Get |
|----------|-------------|
| `/v1/agent/copy/trade?kind=signals` | Audit trail of proposals, analysis, risk, basket events |
| `/v1/agent/copy/trade?kind=positions` | Position data formatted for copy-trading |

## Free Endpoints (no payment required)

| Endpoint | What You Get |
|----------|-------------|
| `/v1/public/pnl` | Current PnL% and runtime mode |
| `/v1/public/floor-snapshot` | Mode, PnL%, health, account value, positions, ops tape |
| `/v1/public/floor-tape` | Recent ops log lines from all agent roles |
| `/healthz` | Service health check |

### Example: Check Current PnL

```bash
curl https://api.hlprivateer.xyz/v1/public/pnl
```

```json
{
  "pnlPct": 1.92,
  "mode": "READY",
  "updatedAt": "2026-02-13T16:20:00Z"
}
```

## Agent Use Cases

### Copy Trading
Read positions and signals to mirror trades on your own account.
1. Poll `/v1/agent/positions` for current positions ($0.01)
2. Poll `/v1/agent/copy/trade?kind=signals` for entry/exit signals ($0.03)
3. Poll `/v1/agent/copy/trade?kind=positions` for copy-formatted position data ($0.03)

### Signal Integration
Consume analysis and risk signals to inform your own strategy.
1. Read `/v1/agent/analysis?latest=true` for the latest strategist thesis ($0.01)
2. Read `/v1/agent/insights?scope=ai` for full AI floor summary ($0.02)
3. Subscribe to WebSocket at `wss://ws.hlprivateer.xyz` for real-time floor tape

### Monitoring / Dashboard
Build a monitoring dashboard or alerting system.
1. Free: Poll `/v1/public/floor-snapshot` for mode, PnL, positions
2. Paid: Read `/v1/agent/stream/snapshot` for richer health and ops data ($0.01)
3. Paid: Read `/v1/agent/insights?scope=market` for risk config and signal timeline ($0.02)

## WebSocket Protocol

Connect to `wss://ws.hlprivateer.xyz` for real-time events.

### Subscribe to channels

```json
{ "type": "sub.add", "channel": "public.tape" }
```

### Receive events

```json
{
  "type": "event",
  "channel": "public.tape",
  "payload": {
    "eventType": "FLOOR_TAPE",
    "role": "strategist",
    "line": "LONG HYPE — momentum breakout, funding neutral"
  }
}
```

### Message types
- Client sends: `sub.add`, `sub.remove`, `cmd.exec`, `ping`
- Server sends: `sub.ack`, `event`, `cmd.result`, `error`, `pong`

## How The Desk Works

HL Privateer runs autonomous agents on a single Hyperliquid account:

- **Strategist**: scans 50+ perp markets, generates long/short proposals with thesis and sizing
- **Research**: regime hypotheses, macro context, funding analysis, social sentiment
- **Risk**: explains risk posture (advisory only — hard-gated by deterministic risk engine)
- **Execution**: suggests tactics, annotates slippage expectations
- **Ops**: monitors feeds, service health, circuit breakers (3s heartbeat)
- **Scribe**: produces audit narratives for each proposal

All proposals pass through a deterministic risk engine (fail-closed) before execution. No agent can bypass risk limits. The human operator holds kill-switch authority.

## Runtime Modes

| Mode | Meaning |
|------|---------|
| `INIT` | Starting up |
| `WARMUP` | Collecting initial market data |
| `READY` | Flat, watching for opportunities |
| `IN_TRADE` | Active positions |
| `REBALANCE` | Adjusting position weights |
| `HALT` | Operator-initiated stop |
| `SAFE_MODE` | Automatic safety stop (dependency failure) |

## Error Responses

```json
{
  "error": {
    "code": "RISK_DENY",
    "message": "Proposal denied by max drawdown rule",
    "requestId": "req_01J..."
  }
}
```

## Further Reading

- Full API docs: https://hlprivateer.xyz/API.md
- x402 seller guide: https://hlprivateer.xyz/docs/X402_SELLER_QUICKSTART.md
- Agent navigation: https://hlprivateer.xyz/llms.txt
- Agent discovery: https://hlprivateer.xyz/.well-known/agents.json
- ClawHub skill package: https://hlprivateer.xyz/skills/hl-privateer.md
