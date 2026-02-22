# Scripts - Development Context

## Overview
Operational scripts for deployment, readiness, secret management, and x402 demos.

## Directory Structure
```
scripts/
├── workspace.sh          # Monorepo task orchestrator (dev/build/test/lint/typecheck)
├── ops/                  # Deployment + operational utilities
├── readiness/            # Smoke tests + burn-in validation
├── cloudflare/           # DNS sync automation
└── x402/                 # Payment protocol demos
```

## workspace.sh
Executes tasks across all workspace packages in dependency order. `dev` runs parallel with trap cleanup. All others sequential.

## ops/
| Script | Purpose |
|--------|---------|
| `deploy-systemd.sh` | Bare-metal deploy to `/opt/hlprivateer.xyz` with validation gates |
| `deploy-docker.sh` | Docker Compose orchestration (up/down/logs/ps/restart) |
| `bootstrap-postgres.sh` | Idempotent Postgres container with random password |
| `generate-trading-wallet.ts` | Hyperliquid private key + XOR shard backup |
| `usd-class-transfer.ts` | Spot ↔ Perp USD transfer on Hyperliquid |
| `llm-smoke.ts` | Validate Claude + Codex structured output endpoints |

**deploy-systemd.sh gates**: Validates `EnvironmentFile` paths, service users (`getent`), `LoadCredential` sources, working dir permissions. Runs smoke after deploy.

**deploy-docker.sh flags**: `NUKE_ON_START=1` (fresh restart), `NUKE_LEGACY=1` (remove old systemd units), `RUN_SMOKE=1` (post-deploy smoke).

## readiness/
| Script | Purpose |
|--------|---------|
| `smoke.sh` | E2E validation: public endpoints, CORS, WebSocket, local health |
| `burnin.sh` | Loop smoke checks for 24h stability (`INTERVAL_SEC`, `DURATION_SEC`) |

`LOCAL=1 bash scripts/readiness/smoke.sh` adds localhost health checks (api:4000, ws:4100, runtime:9400).

## cloudflare/
`sync-dns.sh` - Idempotent DNS setup via Cloudflare API. Creates CNAME records for apex/www (→ Pages) and api/ws (→ Tunnel).

## x402/
| Script | Purpose |
|--------|---------|
| `demo.ts` | Mock x402 flow (SHA256 dev verifier) |
| `facilitator-demo.ts` | Real x402 via facilitator + EVM on-chain settlement |

## Repository Documentation
- `AGENTS.md`: operational runbook and deployment flow.
- `README.md`: repo overview and setup commands.
- `API.md`: endpoint contracts and x402 pricing.
- `docs/SPEC.md`: architecture and behavioral invariants.
- `RUNBOOK.md`: operational recovery and day-to-day runbook.
- `SECURITY.md`: secret handling and threat model.
