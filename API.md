# API.md

## Base URLs
- Public web: `https://hlprivateer.xyz`
- REST API: `https://api.hlprivateer.xyz`
- Websocket: `wss://ws.hlprivateer.xyz`

## Auth model
- Public endpoints: no auth.
- Operator endpoints: Bearer JWT with role claims.
- Agent endpoints: API key + entitlement token and/or x402 proof.

## REST endpoints

### Public
- `GET /v1/public/pnl`
- `GET /v1/public/floor-snapshot`

Response example:
```json
{
  "pnlPct": 1.92,
  "mode": "READY",
  "updatedAt": "2026-02-13T16:20:00Z"
}
```

### Operator
- `GET /v1/operator/status`
- `GET /v1/operator/positions`
- `GET /v1/operator/orders`
- `GET /v1/operator/audit`
- `POST /v1/operator/command`
- `PATCH /v1/operator/config/risk`
- `POST /v1/operator/replay/start`

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
- `POST /v1/agent/command`
- `POST /v1/agent/unlock/:tier`

## x402 behavior
- If protected resource has insufficient entitlement, API returns `402 Payment Required` with challenge payload.
- Client submits `x402-payment` proof.
- On success, entitlement is granted with expiry and quota.

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
