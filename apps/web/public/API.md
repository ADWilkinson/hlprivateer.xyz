# HL Privateer Public API

## Base URLs
- Public web: `https://hlprivateer.xyz`
- REST API: `https://api.hlprivateer.xyz`

## Auth model
- Public endpoints: no auth.
- Operator endpoints: bearer token via `AGENT_OPERATOR_TOKEN`.
- When `AGENT_OPERATOR_TOKEN` is unset, operator endpoints return `401`.

## REST endpoints

### Public
- `GET /healthz`
- `GET /metrics`
- `GET /v1/public/markets`
- `GET /v1/public/floor`
- `GET /v1/public/floor-tape`

### Operator
- `POST /v1/operator/halt`
- `POST /v1/operator/resume`

## Public shapes

`GET /v1/public/markets`

```json
{
  "markets": [
    {
      "id": "mkt-fed-pause-2026q3",
      "question": "Will the Fed pause at the September 2026 meeting?",
      "status": "trading",
      "yesPrice": 0.62,
      "pHat": 0.68,
      "edge": 0.06,
      "resolutionAt": "2026-09-18T18:00:00.000Z",
      "topicTags": ["macro", "fed", "rates"]
    }
  ]
}
```

`GET /v1/public/floor`

```json
{
  "mode": "READY",
  "pnlPct": null,
  "marketsTracked": 12,
  "markets": [],
  "tape": [
    {
      "ts": "2026-05-01T12:00:00.000Z",
      "role": "AGT",
      "message": "mkt-fed-pause: pHat=68.0% (mkt 62.0%) YES@0.620 $200 edge +6.00pp"
    }
  ]
}
```

Tape roles:
- `AGT`: strategy agent proposed or skipped.
- `RSK`: deterministic risk gates allowed or denied.
- `EXE`: order placement and fill status.
- `OPS`: startup, halt, resume, and mode changes.

## Error model
```json
{
  "error": "unauthorized"
}
```
