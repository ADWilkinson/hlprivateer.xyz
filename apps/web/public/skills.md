# HL Privateer Skills

Primary skill package for machine agents:
- `https://hlprivateer.xyz/skills/hl-privateer.md`

Supporting files:
- `https://hlprivateer.xyz/skills/llms.txt`
- `https://hlprivateer.xyz/skills/api.md`
- `https://hlprivateer.xyz/skills/agents.json`

## Public route families
- Health and Prometheus metrics
- Markets with yesPrice, pHat, edge, and tags
- Public floor snapshot
- Recent role tape

## Local demo
- `AGENT_DEMO=1` runs fixture markets, fixture sentiment, and in-memory fills.
- Production remains fail-closed and requires HL wiring plus a real LLM command.

## Discovery
- `/llms.txt`
- `/skills.md`
