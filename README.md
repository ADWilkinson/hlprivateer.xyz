# hlprivateer.xyz

Self-hosted, TypeScript-first, agentic Hyperliquid trading platform with deterministic risk gates, ASCII trade floor UI, and x402-based external agent marketplace.

## What It Does
- Runs a continuous pair-trade strategy: `LONG HYPE` vs `SHORT basket` (basket selected dynamically by the strategist agent).
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
- The short basket is selected by the strategist agent and only changes when flat (no mid-trade churn).
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
  docker/
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
3. Start compose stack:
   - `npm run deploy:docker`
4. Install deps + run local developer tools:
   - `bun install`
   - `bun run dev`
5. Open the UI:
   - `http://127.0.0.1:3000`

## Full stack deploy (Docker Compose, recommended)

Deploy the full stack (redis, postgres, runtime, api, ws-gateway, agent-runner, web):

- `npm run deploy:docker`

Optional compose env:
- `POSTGRES_PASSWORD` (required for postgres and DB URL if you keep DB auth)
- `HOST_PROJECT_PATH` if your containerized secret mount path should not match `/opt/hlprivateer.xyz`
- `NODE_ENV=production` + `X402_PROVIDER=facilitator` for production behavior

To deploy from scratch:
- set `NUKE_ON_START=1` before running (optional, useful for rebuilds)
- `NUKE_ON_START=1 npm run deploy:docker`
- set `NUKE_LEGACY=1` to remove old systemd units before startup
- `NUKE_LEGACY=1 npm run deploy:docker`
- full hard reset + legacy cleanup:
- `npm run deploy:docker:full`

Useful follow-ups:
- tail logs: `npm run compose:logs`
- list services: `npm run compose:ps`
- stop everything: `npm run compose:down`
- restart one service: `docker compose -f infra/docker-compose.yml --env-file config/.env restart <service>`
- clean legacy systemd units only: `npm run deploy:legacy-clean`

The compose stack uses:
- `infra/docker-compose.yml`
- image build from `infra/docker/Dockerfile`

One-command smoke check is automatically run after `deploy:docker` by default.

Optional Cloudflare Pages web:
- `bun run deploy:web:cloudflare` builds a static Next output and deploys to Cloudflare Pages.
- Requires `wrangler` auth (`npx wrangler login`) and a Pages project named `hlprivateer-xyz`.
- DNS can be synced via `CF_API_TOKEN=<token with Zone:DNS:Edit> bash scripts/cloudflare/sync-dns.sh hlprivateer.xyz`.

## Legacy deployment path (deprecated)

The active deployment path is Docker Compose.

- Optional legacy cleanup:
  - `npm run deploy:legacy-clean`
  - `NUKE_LEGACY=1 npm run deploy:docker:full`

## Go Live (Hyperliquid mainnet + x402 + Postgres)
See `docs/GO_LIVE.md` (wallet creation, Postgres bootstrap, live trading gates, x402 facilitator config, and verification steps).

## Deployment model
- Recommended: single Linux host with Docker Compose.
- Compose stack includes service isolation, restart policy, and dependency ordering.
- Optional: Cloudflare Tunnel/Pages remain available as legacy egress paths.

See:
- `infra/docker-compose.yml`
- `infra/docker/Dockerfile`
- `infra/systemd/` (historical reference)
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
