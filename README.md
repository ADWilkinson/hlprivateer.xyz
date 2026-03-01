# HL Privateer

Self-hosted, agentic Hyperliquid trading platform. Autonomous AI agents propose discretionary long/short trades, a deterministic risk engine hard-gates every execution, and a real-time ASCII trade floor streams it all live.

```
+--------------------------------------------------------------------------------+
| HL PRIVATEER FLOOR | MODE: READY | PNL: +2.84% | DD: 1.2% | LAT: 142ms       |
+--------------------------------------------------------------------------------+
| RCH [^]  "SOL momentum weakening, funding negative"                            |
| RSK [!]  "Exposure within limits, drawdown 1.2%"                               |
| EXE [>]  "Placed BUY HYPE 4.32 @ 23.14"                                       |
| OPS [#]  "Redis lag 8ms | WS clients 42"                                      |
+--------------------------------------------------------------------------------+
```

**Live**: [hlprivateer.xyz](https://hlprivateer.xyz) | **API**: [api.hlprivateer.xyz](https://api.hlprivateer.xyz) | **WebSocket**: `wss://ws.hlprivateer.xyz`

## How It Works

```
                  ┌───────────────────────────────────────┐
                  │           Cloudflare Edge              │
                  │    hlprivateer.xyz / api.* / ws.*      │
                  └──────────────────┬────────────────────┘
                                     │ Tunnel
┌────────────────────────────────────┼────────────────────────────────┐
│ Home Server                        │                                │
│                                    v                                │
│ ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────────┐ │
│ │  Web UI    │◄─│ WS Gateway │◄─│Redis Streams │──│Agent Runner │ │
│ │  :3000     │  │ :4100      │  │ (event bus)  │  │ (LLM crew)  │ │
│ └────────────┘  └─────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│                       │                │                  │        │
│ ┌────────────┐  ┌─────┴──────┐  ┌──────┴───────┐         │        │
│ │  REST API  │◄─│  Runtime   │──│ Risk Engine  │         │        │
│ │  :4000     │  │  (OMS +    │  │ (pure, fail- │         │        │
│ │  x402/JWT  │  │   state    │  │  closed)     │         │        │
│ └────────────┘  │   machine) │  └──────────────┘         │        │
│                 └─────┬──────┘                            │        │
│                       │                                   │        │
│                 ┌─────┴──────┐                            │        │
│                 │  Postgres  │◄───────────────────────────┘        │
│                 │  (orders,  │                                     │
│                 │  audit,    │                                     │
│                 │  PnL)      │                                     │
│                 └────────────┘                                     │
└────────────────────────┬──────────────────────────────────────────-┘
                         │
          ┌──────────────┼──────────────┐
          v              v              v
    Hyperliquid    x402 Verifier   OTel/Prom/Loki
    API + WS       (Base USDC)    (observability)
```

### Data Flow

```
Agent Runner ──proposals──> Runtime ──risk eval──> Risk Engine
                               |                       |
                               |<──── ALLOW/DENY ──────┘
                               |
                               |──orders──> Hyperliquid
                               |
                               |──> hlp.ui.events ──> WS Gateway ──> Web UI
                               |──> hlp.audit.events ──> API (audit trail)
                               └──< hlp.commands <── API/WS (operator commands)
```

### Agent Crew (7 Roles)

| Role | Code | Job |
|------|------|-----|
| Scout | `SCT` | Tick collection, feed freshness, watchlist |
| Research | `RCH` | Regime analysis, macro context, trade hypotheses |
| Risk | `RSK` | Explains risk posture (advisory; hard-gated by engine) |
| Strategist | `STR` | Proposes long/short directives with sizing, SL/TP |
| Execution | `EXE` | Transforms plans into structured `StrategyProposal` orders |
| Scribe | `SCR` | Audit narrative synthesis per proposal |
| Ops | `OPS` | Service health, floor stability, auto-halt watchdog |

### State Machine

```
INIT ──► WARMUP ──► READY ◄──► IN_TRADE
                      │            │
                      ▼            ▼
                   SAFE_MODE     HALT
```

- **READY**: flat, watching for opportunities
- **IN_TRADE**: active positions with SL/TP on exchange
- **SAFE_MODE**: dependency failure -- only risk-reducing actions allowed
- **HALT**: operator kill-switch -- no new orders

## Key Design Decisions

- **AI proposes, never executes.** Every trade passes through deterministic risk gates (pure functions, no I/O, fail-closed).
- **Fire-and-forget trades.** SL/TP placed on Hyperliquid at entry. No trailing stops or runtime rebalancing.
- **Event-sourced.** All inter-service communication via typed Redis Streams with correlation IDs.
- **Hash-chained audit trail.** SHA-256 chained audit events for every proposal, decision, and execution.
- **Privacy by default.** Public endpoints expose PnL percentage only. No raw positions or notionals.

## Monorepo Structure

```
apps/
├── runtime/          Core trading orchestrator, OMS, state machine
├── api/              Fastify REST API (operator, agent, public routes)
├── ws-gateway/       WebSocket real-time event fanout
├── agent-runner/     LLM agent orchestration (7 roles, structured output)
└── web/              Next.js ASCII UI (operator dashboard + landing)

packages/
├── contracts/        Zod schemas + shared types (single source of truth)
├── risk-engine/      Deterministic risk evaluation (pure functions, fail-closed)
├── event-bus/        Redis Streams abstraction + in-memory fallback
├── plugin-sdk/       External plugin contract + signal types
└── agent-sdk/        External agent client (handshake, x402, commands)

infra/
├── docker/           Multi-stage Dockerfile
├── systemd/          Service units for bare-metal deployment
├── cloudflared/      Cloudflare Tunnel ingress config
└── observability/    OTel + Prometheus + Loki + Grafana
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Bun, TypeScript 5.7 |
| Build | Turborepo |
| API | Fastify |
| Database | Postgres 16 (Drizzle ORM) |
| Event Bus | Redis 7 (Streams) |
| Exchange | Hyperliquid (`@nktkas/hyperliquid`) |
| Agent LLMs | Claude CLI + Codex CLI (structured output) |
| Web | Next.js 15, Tailwind, ASCII aesthetic |
| Payments | x402 protocol (USDC on Base) |
| Observability | OpenTelemetry, Prometheus, Grafana, Loki |
| Deployment | Docker Compose or systemd, Cloudflare Tunnel |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/ADWilkinson/hlprivateer.xyz.git
cd hlprivateer.xyz
bun install

# 2. Configure
cp config/.env.example config/.env
# Edit config/.env with your settings

# 3. Deploy (Docker Compose -- recommended)
npm run deploy:docker

# 4. Verify
npm run compose:ps
curl -sf http://127.0.0.1:4000/healthz
curl -sf http://127.0.0.1:4000/v1/public/pnl

# 5. Open the UI
open http://127.0.0.1:3000
```

### Local Development

```bash
bun run dev          # Start all services in parallel
bun run build        # Build all packages + apps
bun run test         # Run tests (Vitest)
bun run typecheck    # TypeScript check
```

### Deployment Options

**Docker Compose** (recommended):
```bash
npm run deploy:docker          # Full stack
npm run compose:logs           # Tail logs
npm run compose:ps             # Service status
npm run compose:down           # Stop everything
```

**Cloudflare Pages** (web frontend only):
```bash
bun run deploy:web:cloudflare  # Static export + deploy
```

**systemd** (bare-metal):
See `infra/systemd/` for service unit files.

## API

Full API documentation: [`API.md`](API.md)

### Free Endpoints

| Endpoint | Response |
|----------|----------|
| `GET /v1/public/pnl` | PnL% and mode |
| `GET /v1/public/floor-snapshot` | Mode, PnL%, health, positions, ops tape |
| `GET /v1/public/floor-tape` | Recent ops log lines |
| `GET /healthz` | Health check |

### Agent Endpoints (x402 pay-per-call)

| Endpoint | Price | Data |
|----------|-------|------|
| `/v1/agent/stream/snapshot` | $0.01 | Mode, PnL%, health, positions, ops tape |
| `/v1/agent/positions` | $0.01 | Full position array |
| `/v1/agent/orders` | $0.01 | Open orders |
| `/v1/agent/analysis` | $0.01 | AI strategist analysis |
| `/v1/agent/insights?scope=market` | $0.02 | Risk config, signals, account snapshot |
| `/v1/agent/insights?scope=ai` | $0.02 | Full AI dashboard |
| `/v1/agent/copy/trade?kind=signals` | $0.03 | Proposal + risk audit trail |
| `/v1/agent/copy/trade?kind=positions` | $0.03 | Copy-trade position data |

Payment: x402 v2 (USDC on Base). No API keys. No sign-ups.

### WebSocket

Connect to `wss://ws.hlprivateer.xyz` for real-time events:

```json
{ "type": "sub.add", "channel": "public.tape" }
```

### Operator

JWT-authenticated endpoints for status, positions, orders, audit, replay, commands (`/halt`, `/resume`, `/flatten`), and risk config.

## Risk Engine

The risk engine is a pure function library with zero runtime dependencies. Every execution must pass 11 sequential checks:

1. **DEPENDENCY_FAILURE** -- external deps unavailable
2. **SYSTEM_GATED** -- system in HALT state
3. **ACTOR_NOT_ALLOWED** -- external agents blocked from execution
4. **INVALID_PROPOSAL** -- no actionable orders
5. **SLIPPAGE_BREACH** -- exceeds max slippage bps
6. **LEVERAGE** -- exceeds max leverage
7. **DRAWDOWN** -- exceeds max drawdown %
8. **EXPOSURE** -- exceeds max gross exposure USD
9. **LIQUIDITY** -- order size exceeds L2 book depth
10. **SAFE_MODE** -- would increase exposure during safe mode
11. **STALE_DATA** -- tick age exceeds threshold

Any check failure = **DENY**. No exceptions.

## Security

See [`SECURITY.md`](SECURITY.md) for the full threat model.

- Secrets loaded via `*_FILE` env pattern (never in `.env` or git history)
- Deterministic risk engine hard-gate before every execution
- Fail-closed on any dependency error
- Public surface limited to PnL% and obfuscated metadata
- External agents gated by tier entitlements and x402 verification
- Hash-chained audit trail for tamper evidence

## Documentation

| Document | Description |
|----------|-------------|
| [`API.md`](API.md) | REST + WebSocket endpoint contracts |
| [`SECURITY.md`](SECURITY.md) | Threat model, safeguards, key rotation |
| [`RUNBOOK.md`](RUNBOOK.md) | Operational runbook, deployment, incident response |
| [`docs/SPEC.md`](docs/SPEC.md) | Full architecture + technical design |
| [`docs/GO_LIVE.md`](docs/GO_LIVE.md) | Live trading checklist |
| [`docs/AGENT_RUNNER.md`](docs/AGENT_RUNNER.md) | LLM agent development guide |
| [`llms.txt`](llms.txt) | LLM-oriented overview for agent consumption |
| [`skills.md`](skills.md) | Agent skill definition |

## Disclaimer

This is experimental software for research and operational automation. It is not financial advice. All trading decisions and losses are the sole responsibility of the operator. Use at your own risk.

## License

MIT
