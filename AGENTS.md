# AGENTS.md (Internal Operator/Agent Notes)

This file is the internal runbook for people/agents working on this repo.

## Repo Purpose
`hlprivateer.xyz` is a monorepo for the HL Privateer trading stack:
- runtime (risk + execution orchestration)
- agent-runner (LLM discretionary strategy pipeline)
- api (public/operator/x402 endpoints)
- ws-gateway (websocket fanout)
- web UI
- shared contracts/sdk/plugin/risk packages

## Canonical Deploy Flow (Docker Compose)
Deployment is Docker Compose-based from `infra/`.

### Full stack deploy
```bash
cd /home/dappnode/projects/hlprivateer.xyz/infra
docker compose build
docker compose up -d
docker compose ps
```

### Single-service deploy
```bash
cd /home/dappnode/projects/hlprivateer.xyz/infra
docker compose build <service>
docker compose up -d <service>
docker compose ps <service>
```

Typical app service names:
- `hlprivateer-runtime`
- `hlprivateer-agent-runner`
- `hlprivateer-api`
- `hlprivateer-ws`

Core deps:
- `postgres`
- `redis`

## Post-Deploy Verification
Wait for health checks:
```bash
cd /home/dappnode/projects/hlprivateer.xyz/infra
docker compose ps
docker inspect -f '{{.State.Health.Status}}' <container>
```

Check recent logs:
```bash
docker logs --since 2m <container>
```

Validate API:
```bash
curl -sf http://127.0.0.1:4000/healthz
curl -sf http://127.0.0.1:4000/v1/public/pnl
```

Validate WS metrics endpoint:
```bash
curl -sf http://127.0.0.1:4100/metrics >/dev/null
```

## Environment + Config Notes
- Compose uses `../config/.env` (from `infra/docker-compose.yml`).
- Secrets are mounted from `../secrets` into containers.
- Runtime/agent safety knobs are managed via `config/.env`.
- New infra auto-flatten env keys:
  - `RUNTIME_INFRA_AUTO_FLATTEN_MIN_OUTAGE_MS`
  - `RUNTIME_INFRA_AUTO_FLATTEN_NOTICE_COOLDOWN_MS`
  - `RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_USD`
  - `RUNTIME_INFRA_AUTO_FLATTEN_MIN_GROSS_PCT`

## Repo Layout (Quick Map)
- `apps/runtime`: runtime state machine, risk evaluation, execution orchestration
- `apps/agent-runner`: LLM agent pipeline, strategy directives, proposal publishing
- `apps/api`: HTTP API, x402 gateway, public/operator endpoints
- `apps/ws-gateway`: websocket relay and metrics endpoint
- `apps/web`: Next.js frontend
- `packages/contracts`: schemas/contracts shared across services
- `packages/risk-engine`: risk policy evaluation logic
- `packages/hl-client`: Hyperliquid client wrapper
- `infra/`: Docker + deployment infra
- `config/`: env templates and local runtime env

## Build/Test Commands
From repo root:
```bash
bun install
bun run build
```

UI note:
- `/floor` now defaults to a compact mobile-first dashboard layout with minimal noncritical sections collapsed.

Targeted tests:
```bash
cd apps/runtime && bunx vitest run --passWithNoTests
cd apps/agent-runner && bunx vitest run --passWithNoTests
```

Typechecks:
```bash
cd apps/runtime && bunx tsc --noEmit -p tsconfig.json
cd apps/agent-runner && bunx tsc --noEmit -p tsconfig.json
```

## Operational Notes
- Prefer Compose deploy flow for this repo.
- `scripts/ops/deploy-systemd.sh` exists but is not the canonical deployment path for current operations.
- Agent runner healthcheck is heartbeat-based (`/tmp/.agent-runner-heartbeat`); container can be up but unhealthy if heartbeat stalls.
- API may log low wallet balance warnings for ERC8004 feedback wallet; this is operationally relevant, not necessarily a startup failure.
