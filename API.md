# API.md

## Base URLs
- Public web: `https://hlprivateer.xyz`
- REST API: `https://api.hlprivateer.xyz`
- Websocket: `wss://ws.hlprivateer.xyz`

## Auth model
- Public endpoints: no auth.
- Operator endpoints: Bearer JWT with role claims.
- Agent endpoints: API key + entitlement token and/or x402 proof.

## Operator token bootstrap
- Development: `POST /v1/operator/login` can mint a short-lived JWT.
- Production: `POST /v1/operator/login` is disabled unless `OPERATOR_LOGIN_SECRET` is configured.
  - Send `x-operator-login-secret: <secret>` to mint a JWT.

## REST endpoints

### Public
- `GET /v1/public/pnl`
- `GET /v1/public/floor-snapshot`
- `GET /v1/public/floor-tape`

Response example:
```json
{
  "pnlPct": 1.92,
  "mode": "READY",
  "updatedAt": "2026-02-13T16:20:00Z"
}
```

### Operator
- `POST /v1/operator/login`
- `POST /v1/operator/refresh`
- `GET /v1/operator/status`
- `GET /v1/operator/positions`
- `GET /v1/operator/orders`
- `GET /v1/operator/audit`
- `POST /v1/operator/command`
- `PATCH /v1/operator/config/risk`
- `POST /v1/operator/replay/start`
- `GET /v1/operator/replay`
- `GET /v1/operator/replay/export`

Replay endpoint parameters:
- `from` (ISO datetime)
- `to` (ISO datetime)
- `correlationId` (optional)
- `resource` (optional: audit resource or stream)
- `limit` (1-5000, default 200)

Command request example:
```json
{
  "command": "/halt",
  "args": [],
  "reason": "volatility-breakout"
}
```

### External agent
- `POST /v1/agent/handshake`
- `GET /v1/agent/entitlement`
- `GET /v1/agent/stream/snapshot`
- `GET /v1/agent/analysis`
- `GET /v1/agent/insights`
- `GET /v1/agent/copy/trade`
- `GET /v1/agent/positions`
- `GET /v1/agent/orders`
- `POST /v1/agent/command`
- `POST /v1/agent/unlock/:tier`

Deprecated compatibility aliases:
- `GET /v1/agent/analysis/latest`
- `GET /v1/agent/data/overview`
- `GET /v1/agent/copy-trade/signals`
- `GET /v1/agent/copy-trade/positions`

### Internal
- `GET /v1/security/refresh-secrets` (operator auth required)
- `GET /health`
- `GET /healthz`
- `GET /metrics`

Required x402 capability (minimum tier) examples:
- `stream.read.public`: `/v1/agent/stream/snapshot`
- `analysis.read`: `/v1/agent/analysis` (`latest=true` for latest, otherwise paged history)
- `market.data.read`: `/v1/agent/insights?scope=market`
- `agent.insights.read`: `/v1/agent/insights?scope=ai`
- `copy.signals.read`: `/v1/agent/copy/trade?kind=signals`
- `copy.positions.read`: `/v1/agent/copy/trade?kind=positions`
- `command.positions`: `/v1/agent/positions`, `/v1/agent/orders`

## x402 behavior
- This repo supports two x402 modes (configured via `X402_PROVIDER`):
- `X402_PROVIDER=mock`:
  - A local deterministic “x402-like” payment gate for agent routes.
  - On insufficient entitlement, API returns `402 Payment Required` plus a `PAYMENT-REQUIRED` header (Base64 JSON payload).
  - Client retries with payment proof in `PAYMENT-SIGNATURE` (or `x402-payment` for dev clients).
  - On success, response includes `PAYMENT-RESPONSE` (Base64 JSON payload) with an `entitlementId`.
    - Subsequent requests can send `x-agent-entitlement: <entitlementId>` without re-sending the payment proof until the entitlement expires or quota is exhausted.
  - Local demo (runs against `http://127.0.0.1:4000` by default): `bun scripts/x402/demo.ts`
- `X402_PROVIDER=facilitator`:
  - Canonical x402 v2 seller flow with facilitator-backed settlement (per x402 docs).
  - `402` returns `PAYMENT-REQUIRED` (PaymentRequired payload) and paid retries use `PAYMENT-SIGNATURE`.
  - Successful responses include `PAYMENT-RESPONSE` (settlement response).
  - Demo client: `bun scripts/x402/facilitator-demo.ts`
- Route price configuration (override via env):
  - `X402_PRICE_STREAM_SNAPSHOT` (default `$0.001`)
- `X402_PRICE_ANALYSIS_LATEST` (default `$0.005`, `/v1/agent/analysis?latest=true`)
- `X402_PRICE_ANALYSIS_HISTORY` (default `$0.01`, `/v1/agent/analysis`)
  - `X402_PRICE_POSITIONS` (default `$0.01`)
  - `X402_PRICE_ORDERS` (default `$0.01`)
- `X402_PRICE_MARKET_DATA` (default `$0.02`, `/v1/agent/insights?scope=market`)
- `X402_PRICE_AGENT_INSIGHTS` (default `$0.02`, `/v1/agent/insights?scope=ai`)
- `X402_PRICE_COPY_TRADE_SIGNALS` (default `$0.03`, `/v1/agent/copy/trade?kind=signals`)
- `X402_PRICE_COPY_TRADE_POSITIONS` (default `$0.03`, `/v1/agent/copy/trade?kind=positions`)
- Notes + seller quickstart reference: `docs/X402_SELLER_QUICKSTART.md`.

## Websocket protocol

### Client -> server
- `sub.add`
- `sub.remove`
- `cmd.exec`
- `ping`

### Server -> client
- `sub.ack`
- `event`
- `cmd.result`
- `error`
- `pong`

Event payload example:
```json
{
  "type": "event",
  "channel": "operator.execution",
  "payload": {
    "eventType": "execution.fill",
    "orderId": "ord_01J...",
    "symbol": "HYPE",
    "qty": 12.5,
    "price": 23.14,
    "ts": "2026-02-13T16:21:12Z"
  }
}
```

## Zod contracts
```ts
import { z } from "zod";

export const PublicPnlResponseSchema = z.object({
  pnlPct: z.number(),
  mode: z.enum(["INIT", "WARMUP", "READY", "IN_TRADE", "REBALANCE", "HALT", "SAFE_MODE"]),
  updatedAt: z.string().datetime()
});

export const OperatorCommandSchema = z.object({
  command: z.enum(["/status", "/positions", "/simulate", "/halt", "/resume", "/flatten", "/explain"]),
  args: z.array(z.string()).default([]),
  reason: z.string().min(3)
});
```

## Error model
```json
{
  "error": {
    "code": "RISK_DENY",
    "message": "Proposal denied by max drawdown rule",
    "requestId": "req_01J..."
  }
}
```
