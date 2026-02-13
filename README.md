# hlprivateer.xyz

Self-hosted, TypeScript-first, agentic Hyperliquid trading platform with deterministic risk gates, ASCII trade floor UI, and x402-based external agent marketplace.

## Status
- Phase: Core implementation complete; issue-level hardening and deployment verification active.
- Primary spec: `docs/SPEC.md`.
- Issue backlog: `docs/GITHUB_ISSUES.md`.

## Core invariants
- Strategy is always pair-trade: `LONG HYPE` vs `SHORT basket`.
- Equal notional across both legs is enforced by deterministic risk checks.
- AI can propose, never execute directly.
- Public output is restricted to PnL percentage and obfuscated stream fields.

## Monorepo layout
```text
apps/
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

## Quick start (local planning stage)
1. Install Bun 1.2+ (Node.js 22 runtime included via Bun compatibility layer).
2. Copy env template:
   - `cp config/.env.example config/.env`
3. Install dependencies:
   - `bun install`
4. Prepare decrypted credentials:
   - `cp config/secrets.prod.example.yaml config/secrets.prod.plain.yaml`
   - populate values
   - `SOPS_AGE_RECIPIENT=<age recipient> bun run secrets:rotate`
   - `bun run secrets:decrypt`
5. Run workspace tasks:
   - `bun run typecheck`
   - `bun run test`
   - `bun run deploy:web:cloudflare` (optional) to deploy the static web UI to Cloudflare Pages

Optional Cloudflare Pages web:
- `bun run deploy:web:cloudflare` builds a static Next output and deploys to Cloudflare Pages.
- Requires `wrangler` auth (`npx wrangler login`) and a Pages project named `hlprivateer-xyz`.
- DNS can be synced via `CF_API_TOKEN=<token with Zone:DNS:Edit> bash scripts/cloudflare/sync-dns.sh hlprivateer.xyz`.
- `NEXT_PUBLIC_FIREBASE_*` env vars enable client analytics bootstrap in the web app.

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

## Safety notice
This repository is for experimental automation and systems research. It is not financial advice software. Operators bear full trading risk.
