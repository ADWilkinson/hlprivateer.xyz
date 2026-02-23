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
- `GET /v1/public/identity`

Response example (`/v1/public/pnl`):
```json
{
  "pnlPct": 1.92,
  "mode": "READY",
  "updatedAt": "2026-02-13T16:20:00Z"
}
```

Response example (`/v1/public/identity`):
```json
{
  "erc8004": {
    "chainId": 8453,
    "agentId": 1,
    "identityRegistry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    "reputationRegistry": "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    "registrationFile": "https://hlprivateer.xyz/.well-known/agent-registration.json"
  },
  "reputation": {
    "count": 42,
    "summaryValue": 42,
    "summaryValueDecimals": 0
  }
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

## x402 behavior
- x402 payment gating is disabled by default in the simplified core runtime path.
- Agent routes are directly readable/writable with existing API authentication/rate limiting.

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
  command: z.enum(["/status", "/positions", "/risk-policy", "/halt", "/resume", "/flatten", "/explain"]),
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
