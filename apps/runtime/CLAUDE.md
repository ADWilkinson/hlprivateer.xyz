# Runtime - Development Context

## Overview
Core trading runtime orchestrator. Deterministic state machine that consumes agent proposals via Redis Streams, evaluates them against risk gates (`@hl/privateer-risk-engine`), executes approved trades on Hyperliquid (live or sim adapter), and maintains persistent state (Postgres) with audit trails.

Fail-closed by design: any dependency failure (Redis, Postgres, Hyperliquid API) triggers SAFE_MODE.

## Key Files and Structure
```
src/
├── index.ts                     # Entry: metrics server, signal handlers, bus/store init
├── config.ts                    # Env schema with *_FILE secret loading
├── state-machine.ts             # TradeState transitions
├── telemetry.ts                 # OpenTelemetry (OTLP traces)
├── orchestrator/
│   └── state.ts                 # Main loop: proposal eval, risk checks, execution, mode transitions
├── services/
│   ├── oms.ts                   # OMS: createSimAdapter, createLiveAdapter (Hyperliquid SDK)
│   ├── market.ts                # WebSocket market data (Hyperliquid bbo + allMids)
│   └── plugin-manager.ts        # Plugin lifecycle: poll signals, publish to event bus
├── plugins/
│   ├── funding.ts               # Funding rate signal (BTC default, 30min cooldown)
│   ├── volatility.ts            # Realized volatility (1h window, 10min cooldown)
│   ├── correlation.ts           # Basket correlation (1h window, 10min cooldown)
│   └── hyperliquid.ts           # Shared Hyperliquid API helpers
├── db/
│   ├── schema.ts                # Drizzle ORM schema (system_state, positions, orders, audits, commands)
│   └── persistence.ts           # RuntimeStore: getSystemState, savePositions, saveAudit, etc.
└── types/
    └── ws-shim.d.ts             # WebSocket type augmentation
```

## State Machine
```
INIT → WARMUP → READY ⇄ IN_TRADE ⇄ REBALANCE → READY
                  ↓         ↓         ↓
                HALT      SAFE_MODE
                  ↑         ↓
                  └─────────┘
```
- SAFE_MODE: reduce-only (gross notional must decrease)
- HALT: blocks all proposals until `/resume`
- Dependency failure → SAFE_MODE

## Runtime Cycle (`orchestrator/state.ts`)
1. Live account value refresh (if ENABLE_LIVE_OMS)
2. Position sync (live mode: `adapter.snapshot()` for restart-safety)
3. Market data fetch (WebSocket cache + on-demand L2 book depth)
4. Mark-to-market (update `markPx`, `notionalUsd`, `pnlUsd`)
5. Funding gate (block new exposure if below `RUNTIME_MIN_LIVE_ACCOUNT_VALUE_USD`)
6. Proposal selection (fresh agent proposal from last 60s or skip)
7. Risk evaluation (`evaluateRisk()` from risk-engine)
8. Execution (ALLOW → place orders; ALLOW_REDUCE_ONLY → SAFE_MODE after exec)
9. Mode transition (IN_TRADE / REBALANCE / READY)
10. Auto-mitigation (critical risk DENY + open exposure → `/flatten` + SAFE_MODE)

Cycle interval: `CYCLE_MS` (default 5000ms)

## OMS Adapters (`services/oms.ts`)
**Sim**: In-memory orders/positions, configurable slippage (5 bps), 15% partial fills, idempotency via key map.

**Live**: Hyperliquid SDK (`@nktkas/hyperliquid`), IOC limit orders with slippage buffer, CLOID-based idempotency (SHA256 of idempotencyKey), restart-safe (queries exchange by CLOID before placing). Only enabled when `ENABLE_LIVE_OMS=true` AND `LIVE_MODE_APPROVED=true`.

## Market Data (`services/market.ts`)
Fetch-on-demand via Hyperliquid REST `allMids` endpoint (`HL_INFO_URL`). Returns mid prices for all basket symbols in a single HTTP call. Cached with 4s TTL (within one 5s runtime cycle). Normalizes to `NormalizedTick` schema and publishes to `hlp.market.normalized`. No persistent WebSocket — eliminates reconnect/staleness failure modes.

## Plugin System (`services/plugin-manager.ts`)
Loads `PluginRuntime` implementations from `plugins/`. Poll interval per `manifest.cooldownMs`. Failures isolated (caught/logged). Signals published to `hlp.plugin.signals` (max 256 in-memory).

## Operator Commands
| Command | Role | Effect |
|---------|------|--------|
| `/halt` | admin | → HALT (blocks proposals) |
| `/resume` | admin | HALT → READY |
| `/flatten` | admin | Cancel orders, close positions, → SAFE_MODE if residual |
| `/risk-policy` | admin | Update risk params (validates bounds) |
| `/status` | any | Return state/pnl/cycle |
| `/explain` | any | Detailed state/positions summary |
| `/positions` | any | Position symbols/sides |

## Auto-Mitigation
Risk DENY with critical codes + open exposure → SAFE_MODE + internal `/flatten`. Cooldown: same risk signature won't re-trigger for 60s.

## Key Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `CYCLE_MS` | 5000 | Loop interval |
| `DRY_RUN` | false | Tolerate missing DB |
| `ENABLE_LIVE_OMS` | false | Live trading |
| `LIVE_MODE_APPROVED` | false | Operator safety gate |
| `RISK_MAX_LEVERAGE` | 2 | Hard leverage cap |
| `RISK_MAX_NOTIONAL_USD` | 10000 | Gross exposure cap |
| `BASKET_SYMBOLS` | - | Comma-separated symbols |
| `RUNTIME_METRICS_PORT` | 9400 | Prometheus endpoint |

## Event Bus Integration
**Consumes**: `hlp.commands`, `hlp.strategy.proposals`, `hlp.market.watchlist`
**Publishes**: `hlp.ui.events`, `hlp.audit.events`, `hlp.execution.fills`, `hlp.execution.commands`, `hlp.risk.decisions`, `hlp.market.normalized`, `hlp.plugin.signals`

## Persistence (Drizzle + Postgres)
Append-only audit trail with SHA256 hash chaining. Transactional position/order snapshots. Fail-closed: missing DB → no-op stubs (health=false), triggers SAFE_MODE in live mode.

## Metrics
Prometheus at `/metrics`: `cycles_total`, `proposals_total`, `commands_total` (counters); `mode`, `market_data_age_ms` (gauges); `cycle_duration_ms` (histogram).

## Repository Documentation
- `AGENTS.md`: operational runbook and deployment flow.
- `README.md`: repo overview and setup commands.
- `API.md`: endpoint contracts and x402 pricing.
- `docs/SPEC.md`: architecture and behavioral invariants.
- `RUNBOOK.md`: operational recovery and day-to-day runbook.
- `SECURITY.md`: secret handling and threat model.
