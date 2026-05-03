# Agent Index (HL Privateer)

HL Privateer is an agentic outcome-market trading experiment on Hyperliquid
HIP-4. External agents can read the privacy-safe public floor: markets,
mode, pHat, edge, and recent AGT / RSK / EXE / OPS tape.

## Base URLs
- REST API: `https://api.hlprivateer.xyz`
- Web UI: `https://hlprivateer.xyz`

## Public routes
- `/healthz`
- `/metrics`
- `/v1/public/markets`
- `/v1/public/floor`
- `/v1/public/floor-tape`

## Privacy boundary
- Public: question, status, yesPrice, pHat, edge, resolutionAt, tags, tape.
- Private: positions, notional exposure, bankroll, thesis, and raw sentiment.

## Discovery docs
- `https://hlprivateer.xyz/llms.txt`
- `https://hlprivateer.xyz/skills.md`
