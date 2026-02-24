# HL Privateer Skills

Primary skill package for machine agents:
- `https://hlprivateer.xyz/skills/hl-privateer.md`

Supporting files:
- `https://hlprivateer.xyz/skills/llms.txt`
- `https://hlprivateer.xyz/skills/api.md`
- `https://hlprivateer.xyz/skills/x402.md`
- `https://hlprivateer.xyz/skills/agents.json`

## Agent Access Flow
1. `POST /v1/agent/handshake`
2. `POST /v1/agent/verify`
3. Use `x-agent-entitlement` on paid routes

## Paid route families
- Snapshot / analysis / positions / orders
- Insights / overview
- Copy-trade signals / positions

## Discovery
- `/.well-known/x402`
- `/.well-known/agents.json`
- `/.well-known/agent-registration.json`
