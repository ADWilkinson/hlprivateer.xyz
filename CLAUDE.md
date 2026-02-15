# Claude Index (HL Privateer)

Self-hosted, TypeScript-first, agentic Hyperliquid trading platform with deterministic risk hard-gates.

## Read First
- `AGENT.md`: single index to the full documentation set and code entry points.
- `llms.txt`: LLM-oriented map of the repo.
- `README.md`: quick start and high-level product framing.

## Monorepo Structure
```
apps/
├── runtime/         # Core trading orchestrator + OMS + state machine
├── api/             # Fastify REST API (operator, agent, public routes)
├── ws-gateway/      # WebSocket real-time event fanout
├── agent-runner/    # LLM agent orchestration (7 roles, structured proposals)
└── web/             # Next.js ASCII UI (operator dashboard + landing)
packages/
├── contracts/       # Zod schemas + shared types (single source of truth)
├── risk-engine/     # Deterministic risk evaluation (pure functions, fail-closed)
├── event-bus/       # Redis Streams abstraction + in-memory fallback
├── plugin-sdk/      # External plugin contract + signal types
└── agent-sdk/       # External agent client (handshake, x402 proofs, commands)
infra/               # systemd, Docker, Cloudflare Tunnel, observability
scripts/             # Deployment, readiness, secrets, x402 demos
config/              # .env template, secrets structure
```

Each directory has its own `CLAUDE.md` with architecture details and development guidelines.

## Tech Stack
- **Runtime**: Bun 1.2.19, TypeScript 5.7
- **Build**: Turborepo, workspace protocol
- **Database**: Postgres 16 (Drizzle ORM), Redis 7 (event bus)
- **Exchange**: Hyperliquid (`@nktkas/hyperliquid`)
- **Payments**: x402 protocol (@x402/core, @x402/evm)
- **LLMs**: Claude CLI + Codex CLI (structured output)
- **Web**: Next.js 15, Tailwind, ASCII aesthetic
- **Observability**: OpenTelemetry, Prometheus, Grafana, Loki
- **Deployment**: systemd (bare-metal) or Docker Compose, Cloudflare Tunnel + Pages

## Key Architectural Invariants
- **Fail-closed**: Risk engine denies on any critical check failure. Dependency errors trigger SAFE_MODE.
- **Deterministic risk gates**: Pure function evaluation, no I/O, same inputs → same output.
- **State machine**: INIT → WARMUP → READY ⇄ IN_TRADE ⇄ REBALANCE. HALT and SAFE_MODE are escape states.
- **Event-sourced**: All inter-service communication flows through typed Redis Streams with correlation IDs.
- **Audit trail**: Hash-chained (SHA-256) audit events. Every operator/agent action logged.
- **Secret handling**: `*_FILE` pattern (e.g., `JWT_SECRET_FILE` overrides `JWT_SECRET`).

## Common Commands
```bash
bun install              # Install deps
bun run dev              # Parallel dev servers
bun run build            # Sequential builds (turbo)
bun run test             # Vitest across workspaces
bun run typecheck        # TypeScript check
LOCAL=1 bash scripts/readiness/smoke.sh  # Smoke test
```

## System/Architecture Docs
- `docs/SPEC.md`: architecture and invariants (discretionary long/short strategy, deterministic risk gates).
- `docs/AGENT_RUNNER.md`: agent runner behavior (prompts, structured outputs, proposal flow).
- `API.md`: HTTP/WS endpoints and payload contracts.

## Operations (Prod)
- `docs/GO_LIVE.md`: live-mode checklist (Hyperliquid + Postgres + x402), verification steps.
- `RUNBOOK.md`: day-2 operations (systemd services, smoke tests, troubleshooting).
- `infra/systemd/` and `infra/cloudflared/`: deployment units + Cloudflare Tunnel ingress.

## Security + Secrets
- `SECURITY.md`: secret handling model (`*_FILE` pattern) and operator safety.
- `scripts/secrets/`: rotate/decrypt helpers (do not commit secrets).

## x402
- `docs/X402_SELLER_QUICKSTART.md`: seller implementation guidance and expected 402/200 flows.
- `scripts/x402/`: local payer demo scripts for E2E validation.

## Data Flow
```
Agent Runner → hlp.strategy.proposals → Runtime (risk eval → OMS execution)
                                           ↓
                                    hlp.ui.events → API + WS Gateway → Web UI
                                    hlp.audit.events → API (audit trail)
                                    hlp.commands ← API/WS (operator commands)
```

## Quality Bar
- Prefer small, reviewable diffs.
- Keep runtime fail-closed on dependency errors (risk gates must be deterministic).
- Do not add placeholders/TODOs in production paths.
- Read `packages/contracts` before editing service code. Propose changes as typed interfaces first.
- New endpoints/events must be reflected in `API.md`.
- Security-sensitive changes must update `SECURITY.md`.
- Operational changes must update `RUNBOOK.md`.

# currentDate
Today's date is 2026-02-15.
