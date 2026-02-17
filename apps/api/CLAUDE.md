# API Server - Development Context

## Overview
Fastify-based REST API providing authenticated HTTP endpoints for operators, external agents, and public access. Enforces x402 payment gates, tiered access control, and audit trails for all actions.

## Key Files and Structure
```
src/
├── index.ts                 # Server, route registration, event bus consumption
├── config.ts                # Env loading with *_FILE secret pattern
├── middleware.ts             # JWT auth, role-based authorization
├── x402.ts                  # Mock x402 challenge/verify (dev)
├── x402-facilitator.ts      # Facilitator-backed x402 (prod)
├── erc8004-feedback.ts      # ERC-8004 batched reputation feedback after x402 settlements
├── security.ts              # Prompt injection filters, sanitization, abuse tracking
├── store.ts                 # In-memory state + persistence layer (ApiStore)
├── telemetry.ts             # OpenTelemetry initialization
├── db/
│   ├── schema.ts            # Drizzle ORM schema (Postgres)
│   └── persistence.ts       # DB operations interface
└── *.test.ts                # Unit tests
```

## Architecture Patterns
- **Framework**: Fastify (schema-first)
- **Auth**: JWT via @fastify/jwt (8h tokens, operator/agent roles)
- **Rate Limiting**: Global + per-route (@fastify/rate-limit)
- **Persistence**: Drizzle ORM + Postgres (resilient to DB unavailability)
- **Event Bus**: Redis Streams (or InMemoryEventBus for dev)
- **Telemetry**: OpenTelemetry + Prometheus
- **Secret Handling**: `*_FILE` pattern

**Middleware Chain**: CORS → Rate limiting → Security hooks → Auth → Route handlers → Error handler

**x402 Modes**: `mock` (dev, HMAC verification) or `facilitator` (prod, @x402/core settlement)

## API Surface

### Public Routes
- `GET /v1/public/pnl` - PnL % + mode + timestamp
- `GET /v1/public/floor-snapshot` - Public snapshot (positions, tape)
- `GET /v1/public/floor-tape` - Recent floor tape
- `GET /v1/public/identity` - ERC-8004 on-chain identity + reputation (cached 5min)

### Operator Routes (JWT)
- `POST /v1/operator/login` - Mint JWT (requires `OPERATOR_LOGIN_SECRET`)
- `POST /v1/operator/refresh` - Refresh token
- `GET /v1/operator/status` - Mode, PnL, risk config
- `GET /v1/operator/positions` - All positions
- `GET /v1/operator/orders?limit=N&cursor=M` - Order history (paginated)
- `GET /v1/operator/audit?limit=N&cursor=M` - Audit log (paginated)
- `POST /v1/operator/command` - Execute command
- `PATCH /v1/operator/config/risk` - Update risk policy (admin)
- `POST /v1/operator/replay/start` - Start audit replay
- `GET /v1/operator/replay` - Query audit range
- `GET /v1/operator/replay/export` - Download audit events

### Agent Routes (x402 protected)
- `POST /v1/agent/handshake` - Establish entitlement
- `GET /v1/agent/entitlement` - Check status
- `GET /v1/agent/stream/snapshot` - Floor snapshot (paid)
- `GET /v1/agent/analysis/latest` - Latest analysis
- `GET /v1/agent/positions` - Current positions
- `GET /v1/agent/orders` - Current orders
- `GET /v1/agent/data/overview` - Market overview
- `GET /v1/agent/insights` - Floor insights
- `GET /v1/agent/copy-trade/signals` - Copy-trade signals
- `POST /v1/agent/command` - Submit command

### Internal
- `GET /health`, `/healthz` - Health checks
- `GET /metrics` - Prometheus metrics

## Auth Model
**Operator**: JWT with `sub`, `roles` (`operator_view`, `operator_admin`), `mfa`. Admin commands require admin role + MFA (if enabled).

**Agent**: x402 payment flow (402 → proof → 200 + entitlement). Entitlement header: `x-agent-entitlement`. Quota tracking + abuse protection (8 failures → 60s ban).

**Security**: Prompt injection detection, suspicious path blocking, large payload rejection (>1MB), rate limiting.

## Event Bus Integration
**Consumes**: `hlp.ui.events` (STATE_UPDATE, FLOOR_TAPE, POSITION_UPDATE, ORDER_UPDATE), `hlp.audit.events`
**Publishes**: `hlp.commands` (operator/agent commands)

## Database (Postgres)
Tables: `system_state`, `orders`, `positions`, `audits`, `commands`, `entitlements`, `tier_capabilities`, `payments`, `users`. Audit trail with hash chaining (SHA-256).

## Adding New Routes
1. Define route in `index.ts` with `routeRateLimit(max, windowMs)`
2. Add auth: `preHandler: [app.authenticate]` or `x402AgentReadGate('capability')`
3. Validate input with Zod from `@hl/privateer-contracts`
4. Sanitize text: `sanitizeText(input, { maxLength: 200 })`
5. Emit audit: `addAudit(store, actorId, action, details)`

## Metrics
`hlp_api_requests_total`, `hlp_api_request_duration_seconds`, `hlp_command_total`, `hlp_audit_records_total`
