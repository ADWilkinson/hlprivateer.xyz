# API.md

## Base URLs
- Public web: `https://hlprivateer.xyz`
- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`

## Auth model
- Public endpoints: no auth.
- Operator endpoints: Bearer JWT with role claims.
- Agent endpoints: x402 entitlement flow (`/v1/agent/handshake` -> `/v1/agent/verify` -> `x-agent-entitlement` header).

## Operator token bootstrap
- Development: `POST /v1/operator/login` can mint a short-lived JWT.
- Production: `POST /v1/operator/login` is disabled unless `OPERATOR_LOGIN_SECRET` is configured.
  - Send `x-operator-login-secret: <secret>` to mint a JWT.

## REST endpoints

### Public
- `GET /v1/public/pnl`
- `GET /v1/public/floor-snapshot`
- `GET /v1/public/floor-tape`
- `GET /v1/public/performance`
- `GET /v1/public/trajectory`
- `GET /v1/public/identity`

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

### External agent
- `POST /v1/agent/handshake`
- `POST /v1/agent/verify`
- `GET /v1/agent/entitlement`
- `GET /v1/agent/stream/snapshot`
- `GET /v1/agent/analysis`
- `GET /v1/agent/analysis/latest` (compatibility alias)
- `GET /v1/agent/insights`
- `GET /v1/agent/data/overview` (compatibility alias)
- `GET /v1/agent/copy-trade/signals`
- `GET /v1/agent/copy-trade/positions`
- `GET /v1/agent/positions`
- `GET /v1/agent/orders`
- `POST /v1/agent/command`
- `POST /v1/agent/unlock/:tier` (non-production admin utility)

### Internal / platform
- `GET /v1/security/refresh-secrets` (operator auth required)
- `GET /health`
- `GET /healthz`
- `GET /metrics`

## x402 behavior
- Paid agent routes require `x-agent-entitlement`.
- If missing, API returns `402 PAYMENT_REQUIRED` with guidance to call handshake + verify.
- Verification accepts proof in request body or headers:
  - `PAYMENT-SIGNATURE`
  - `x402-payment`
  - `x-agent-proof`
  - `x-payment`
- Network target: Base (`eip155:8453`).

## WebSocket protocol

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

## Error model
```json
{
  "error": {
    "code": "PAYMENT_REQUIRED",
    "message": "missing x-agent-entitlement header; use /v1/agent/handshake then /v1/agent/verify"
  }
}
```
