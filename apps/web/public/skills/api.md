# HL Privateer Skills API Reference

## Base URLs
- REST API: `https://api.hlprivateer.xyz`

## Authentication
- Public routes: none
- Operator routes: bearer token via `AGENT_OPERATOR_TOKEN`.

## Public routes
- `GET /healthz`
- `GET /metrics`
- `GET /v1/public/markets`
- `GET /v1/public/floor`
- `GET /v1/public/floor-tape`

## Public route details
- `/v1/public/markets`: market question, status, yesPrice, optional pHat,
  optional edge, resolutionAt, and topicTags.
- `/v1/public/floor`: mode, optional pnlPct, marketsTracked, first 12 public
  markets, and recent role tape.
- `/v1/public/floor-tape`: recent role tape only.

## Operator routes
- `POST /v1/operator/halt`
- `POST /v1/operator/resume`
