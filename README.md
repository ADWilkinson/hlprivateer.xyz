# hlprivateer.xyz

Self-hosted, TypeScript-first, agentic Hyperliquid trading platform with deterministic risk gates, ASCII trade floor UI, and x402-based external agent marketplace.

## What It Does
- Runs a continuous pair-trade strategy: `LONG HYPE` vs `SHORT basket` (basket configurable).
- Streams a public ASCII "trading floor" UI (mode/health/drift/PnL + event tape).
- Provides operator controls via JWT API: `/halt`, `/resume`, `/flatten`, `/status`, etc.
- Runs an internal `agent-runner` that proposes rebalances + publishes structured analysis (Claude/Codex CLIs optional).
- Exposes x402 paywalled agent endpoints (facilitator-backed).

## Reference URLs (production)
- Web: `https://hlprivateer.xyz`
- API: `https://api.hlprivateer.xyz`
- WebSocket: `wss://ws.hlprivateer.xyz`

## Core invariants
- Strategy is always pair-trade: `LONG HYPE` vs `SHORT basket`.
- Equal notional across both legs is enforced by deterministic risk checks.
- AI can propose, never execute directly.
- Public output is restricted to PnL percentage and obfuscated stream fields.

## Monorepo layout
```text
apps/
  agent-runner/
  api/
  runtime/
  ws-gateway/
  web/
packages/
  contracts/
  risk-engine/
  event-bus/
  plugin-sdk/
  agent-sdk/
infra/
  systemd/
  cloudflared/
config/
  .env.example
docs/
  SPEC.md
  GITHUB_ISSUES.md
```

## Quick Start (SIM / local dev)
1. Install Bun 1.2+.
2. Copy env template:
   - `cp config/.env.example config/.env`
3. Start Redis (or set `REDIS_URL` to an existing instance):
   - `docker run -d --name hlprivateer-redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7-alpine`
4. Install deps + run the workspace:
   - `bun install`
   - `bun run dev`
5. Open the UI:
   - `http://127.0.0.1:3000`

Optional Cloudflare Pages web:
- `bun run deploy:web:cloudflare` builds a static Next output and deploys to Cloudflare Pages.
- Requires `wrangler` auth (`npx wrangler login`) and a Pages project named `hlprivateer-xyz`.
- DNS can be synced via `CF_API_TOKEN=<token with Zone:DNS:Edit> bash scripts/cloudflare/sync-dns.sh hlprivateer.xyz`.

## Go Live (Hyperliquid mainnet + x402 + Postgres)
See `docs/GO_LIVE.md` (wallet creation, Postgres bootstrap, live trading gates, x402 facilitator config, and verification steps).

## Deployment model
- Single Linux home server.
- Services supervised by systemd.
- Web UI served by Cloudflare Pages.
- API + WebSocket ingress through Cloudflare Tunnel.

See:
- `infra/systemd/`
- `infra/cloudflared/config.yml.example`
- `RUNBOOK.md`

## Documentation index
- Product + architecture: `docs/SPEC.md`
- API contracts: `API.md`
- Full engineer handover prompt: `docs/HANDOVER_PROMPT.md`
- Agent navigation: `llms.txt`
- Agent skill contracts: `skills.md`
- Security model and reporting: `SECURITY.md`
- Ops runbook: `RUNBOOK.md`
- x402 seller integration notes: `docs/X402_SELLER_QUICKSTART.md`
- Live go-live steps: `docs/GO_LIVE.md`
- Agent/LLM development notes: `docs/AGENT_RUNNER.md`

## Safety notice
This repository is for experimental automation and systems research. It is not financial advice software. Operators bear full trading risk.
