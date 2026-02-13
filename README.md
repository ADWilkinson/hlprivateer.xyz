# hlprivateer.xyz

Self-hosted, TypeScript-first, agentic Hyperliquid trading platform with deterministic risk gates, ASCII trade floor UI, and x402-based external agent marketplace.

## Status
- Phase: Architecture and implementation planning complete.
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
1. Install Node.js 22+ and pnpm.
2. Copy env template:
   - `cp config/.env.example config/.env`
3. Install dependencies:
   - `pnpm install`
4. Run workspace tasks:
   - `pnpm typecheck`
   - `pnpm test`

## Deployment model
- Single Linux home server.
- Services supervised by systemd.
- Ingress only through Cloudflare Tunnel.

See:
- `infra/systemd/`
- `infra/cloudflared/config.yml.example`
- `RUNBOOK.md`

## Documentation index
- Product + architecture: `docs/SPEC.md`
- API contracts: `API.md`
- Agent navigation: `llms.txt`
- Agent skill contracts: `skills.md`
- Security model and reporting: `SECURITY.md`
- Ops runbook: `RUNBOOK.md`

## Safety notice
This repository is for experimental automation and systems research. It is not financial advice software. Operators bear full trading risk.
