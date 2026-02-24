# HL Privateer Skills API Reference

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`

## Authentication
- Public routes: none
- Operator routes: Bearer JWT
- Agent routes: x402 entitlement flow

### Agent x402 flow
1. `POST /v1/agent/handshake`
2. `POST /v1/agent/verify`
3. Call paid routes with `x-agent-entitlement`

## Public routes
- `GET /v1/public/pnl`
- `GET /v1/public/floor-snapshot`
- `GET /v1/public/floor-tape`
- `GET /v1/public/performance`
- `GET /v1/public/trajectory`
- `GET /v1/public/identity`

## Agent routes
- `POST /v1/agent/handshake`
- `POST /v1/agent/verify`
- `GET /v1/agent/entitlement`
- `GET /v1/agent/stream/snapshot`
- `GET /v1/agent/analysis`
- `GET /v1/agent/analysis/latest` (compat)
- `GET /v1/agent/insights`
- `GET /v1/agent/data/overview` (compat)
- `GET /v1/agent/copy-trade/signals`
- `GET /v1/agent/copy-trade/positions`
- `GET /v1/agent/positions`
- `GET /v1/agent/orders`
- `POST /v1/agent/command`

## Operator routes
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

## x402 headers accepted by verify
- `PAYMENT-SIGNATURE`
- `x402-payment`
- `x-agent-proof`
- `x-payment`

## Identity
- ERC-8004 chain: `8453`
- Registration file: `https://hlprivateer.xyz/.well-known/agent-registration.json`
