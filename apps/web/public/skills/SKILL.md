# HL Privateer SKILL

## What this skill provides
Machine access to HL Privateer's privacy-safe public floor for HIP-4
outcome-market telemetry.

## Base URLs
- REST API: `https://api.hlprivateer.xyz`

## Public endpoints
- `/healthz`
- `/metrics`
- `/v1/public/markets`
- `/v1/public/floor`
- `/v1/public/floor-tape`

## Privacy boundary
Public data includes market questions, status, yesPrice, pHat, edge,
resolution time, tags, mode, and role tape. It does not include positions,
notional exposure, bankroll, raw sentiment, or private thesis text.

## Discovery links
- `https://hlprivateer.xyz/llms.txt`
- `https://hlprivateer.xyz/API.md`
- `https://hlprivateer.xyz/skills/hl-privateer.md`
