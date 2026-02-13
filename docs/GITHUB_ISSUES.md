# HL Privateer Issue Backlog

## Issue Closure Notes
- HLP-001 Repo bootstrap and workspace tooling: DONE — bun/turborepo monorepo bootstrapped, shared path aliases and scripts added; documented in README/config.
- HLP-002 Event envelope and Redis Streams foundation: DONE — Redis stream envelopes, producer/consumer, and event bus abstractions added in `packages/event-bus`.
- HLP-003 Postgres schema v1 with migrations: DONE — runtime schema and initial migration now include orders, fills, positions, users, payments, audits, entitlements, commands, and indexed fields.
- HLP-004 Hyperliquid market data adapter: DONE — synthetic market adapter plus ws adapter with normalized ticks, age telemetry, and reconnect implemented.
- HLP-005 OMS order lifecycle engine: DONE — strict order state transitions, idempotency dedupe, reconciliation and snapshoting implemented in `apps/runtime/src/services/oms.ts`.
- HLP-006 Fill reconciliation worker: DONE — periodic reconciliation hooks and reconcile publish path exist in runtime orchestrator and OMS lifecycle.
- HLP-007 Deterministic risk engine package: DONE — hard-gate checks for leverage, drawdown, exposure, notional parity, stale data, slippage and fail-closed posture in `packages/risk-engine`.
- HLP-008 Pair-trade state machine: DONE — `INIT/WARMUP/READY/IN_TRADE/REBALANCE/HALT/SAFE_MODE` machine enforced with audited transitions in runtime.
- HLP-009 Strategy proposal schema and parser: DONE — zod parser and proposal contracts defined in `packages/contracts` plus runtime decision workflow.
- HLP-010 Paper trading execution adapter: DONE — simulator uses identical execution adapter contract and latency/slippage options.
- HLP-011 Runtime orchestrator loop: DONE — Sense/Think/Propose/Validate/Execute/Review loop with cycle audit and urgent triggers in `apps/runtime/src/orchestrator/state.ts`.
- HLP-012 Operator auth and RBAC: DONE — JWT auth, role enforcement, and MFA gate in API and websocket operator channels.
- HLP-013 Public API endpoints: DONE — `v1/public/pnl` and obfuscated snapshots in API handlers.
- HLP-014 Operator API endpoints: DONE — operator status/positions/orders/config/audit/replay endpoints added and guarded.
- HLP-015 Agent handshake API: DONE — `/v1/agent/handshake` implemented with capability negotiation and entitlement response.
- HLP-016 x402 payment flow: DONE — challenge/verify and payment status checks in public agent routes with abuse counter hooks.
- HLP-017 Entitlements and tier enforcement middleware: DONE — entitlement checks on command/route scopes and quota enforcement in API + ws paths.
- HLP-018 WS gateway base transport: DONE — ws gateway service with heartbeat and channel pub/sub scaffolding.
- HLP-019 WS channel auth and subscription controls: DONE — role/tier isolation and rate/backpressure handling per subscription.
- HLP-020 ASCII floor public UI: DONE — public floor page uses terminal-style ASCII event tape and obfuscated fields.
- HLP-021 ASCII floor operator UI: DONE — operator floor and command feedback panels implemented in Next.js web app.
- HLP-022 Command parser and execution bus: DONE — slash command parser, command envelope publishing, and operator audit metadata.
- HLP-023 Kill switch and safe-mode command path: DONE — `/halt`, `/safe`, `/resume`, `/flatten` command handling with deterministic gating.
- HLP-024 Audit log writer and tamper evidence: DONE — append-only audit stream, hash-chained row writes, replay events included.
- HLP-025 Session replay endpoint and UI timeline: DONE — replay endpoint and operator replay timeline in web route.
- HLP-026 Plugin SDK and loader: DONE — plugin contracts, manifest validation, and runtime plugin manager.
- HLP-027 Initial feed plugins: DONE — correlation/funding/vol plugins produce normalized signals with tests.
- HLP-028 Observability stack integration: DONE — OTel, Prometheus, Loki services and metrics hooks in runtime/ws/api.
- HLP-029 Security baseline: DONE — headers, rate limiting, abuse counters, and injection hardening hooks configured.
- HLP-030 Secrets management with SOPS+age: DONE — SOPS secret envelope and scripts for decrypt/rotate plus systemd credential flow docs.
- HLP-031 systemd deployment and Cloudflare tunnel: IN PROGRESS — units/config are committed; clean-VM deployment verification evidence is still pending.
- HLP-032 End-to-end sim + live readiness checklist: IN PROGRESS — readiness gates are implemented; required 24h sim run and drill evidence are still pending.

## HLP-001 Repo bootstrap and workspace tooling
Description: Initialize bun+turborepo monorepo with TypeScript base config and package boundaries.
Acceptance Criteria:
- Root scripts run (`build`, `lint`, `test`, `typecheck`).
- Workspace packages resolve internal imports.
- CI validates install and typecheck.
Dependencies: none

## HLP-002 Event envelope and Redis Streams foundation
Description: Implement event envelope contracts and Redis Streams producer/consumer utilities.
Acceptance Criteria:
- All services can publish/consume typed envelopes.
- Correlation and causation IDs are enforced.
- Basic replay reader can read by stream and time window.
Dependencies: HLP-001

## HLP-003 Postgres schema v1 with migrations
Description: Create initial database schema for orders, fills, positions, events, audits, users, and payments.
Acceptance Criteria:
- Migration applies cleanly on empty DB.
- Unique idempotency constraint exists on orders.
- Indexes created per spec.
Dependencies: HLP-001

## HLP-004 Hyperliquid market data adapter
Description: Build market data websocket adapter and normalizer for required symbols.
Acceptance Criteria:
- Tick stream published to `hlp.market.normalized`.
- Feed freshness metrics exported.
- Reconnect with exponential backoff works.
Dependencies: HLP-002

## HLP-005 OMS order lifecycle engine
Description: Implement order submission/cancel/modify logic with strict lifecycle states.
Acceptance Criteria:
- State transitions are validated.
- Idempotency key deduplicates retries.
- Exchange errors mapped to deterministic internal codes.
Dependencies: HLP-003, HLP-004

## HLP-006 Fill reconciliation worker
Description: Build periodic reconciliation of exchange fills and local ledger.
Acceptance Criteria:
- Reconciliation report generated every 30s.
- Mismatch events emitted with severity.
- Critical mismatch triggers safe mode.
Dependencies: HLP-005

## HLP-007 Deterministic risk engine package
Description: Implement hard-gate risk checks and deterministic decision outputs.
Acceptance Criteria:
- Position/leverage/drawdown checks implemented.
- Notional-equality check enforced.
- Unit tests cover deny and allow paths.
Dependencies: HLP-003

## HLP-008 Pair-trade state machine
Description: Implement `INIT/WARMUP/READY/IN_TRADE/REBALANCE/HALT/SAFE_MODE` state machine.
Acceptance Criteria:
- Valid transitions enforced.
- Invalid transitions rejected and audited.
- State transitions emit events.
Dependencies: HLP-002, HLP-007

## HLP-009 Strategy proposal schema and parser
Description: Create zod schema and parser for AI-generated proposals.
Acceptance Criteria:
- Invalid or unknown fields are rejected.
- Parser returns explicit error reasons.
- Parsed proposal IDs are trace-linked.
Dependencies: HLP-001

## HLP-010 Paper trading execution adapter
Description: Build sim adapter with orderbook-based synthetic fills.
Acceptance Criteria:
- Same interface as live OMS.
- Sim fills include configurable latency/slippage.
- Toggle between sim/live is audited.
Dependencies: HLP-005

## HLP-011 Runtime orchestrator loop
Description: Implement Sense->Think->Propose->Validate->Execute->Review orchestration.
Acceptance Criteria:
- 5-second cycle execution works.
- Event-triggered urgent cycles supported.
- Every cycle writes audit entries.
Dependencies: HLP-007, HLP-008, HLP-009, HLP-010

## HLP-012 Operator auth and RBAC
Description: Add operator authentication and role-based authorization.
Acceptance Criteria:
- `operator_view` and `operator_admin` roles enforced.
- MFA flag required for admin actions.
- Session expiration and refresh implemented.
Dependencies: HLP-001

## HLP-013 Public API endpoints (PnL + obfuscated snapshot)
Description: Implement public endpoints exposing only safe public fields.
Acceptance Criteria:
- `/v1/public/pnl` returns percent only.
- Snapshot endpoint contains no raw position notional.
- Contract tests verify redaction.
Dependencies: HLP-003, HLP-012

## HLP-014 Operator API endpoints
Description: Implement operator status/positions/orders/config/audit/replay routes.
Acceptance Criteria:
- Endpoints require valid operator JWT.
- All mutating endpoints require audit reason.
- Pagination available on audit and orders.
Dependencies: HLP-003, HLP-012

## HLP-015 Agent handshake API
Description: Implement external agent handshake and capability negotiation endpoint.
Acceptance Criteria:
- Handshake validates identity and requested capabilities.
- Server returns granted tier and quotas.
- Handshake events are audited.
Dependencies: HLP-003, HLP-017

## HLP-016 x402 payment challenge/verify flow
Description: Implement 402 challenge responses and payment proof verification.
Acceptance Criteria:
- Protected routes return payment challenge when needed.
- Verification writes payment record and status.
- Failed verification increments abuse counters.
Dependencies: HLP-003

## HLP-017 Entitlements and tier enforcement middleware
Description: Add middleware enforcing data fields, endpoints, and command permissions per tier.
Acceptance Criteria:
- Tier matrix loaded from DB config.
- Unauthorized fields stripped from responses.
- Quota limits are enforced and metered.
Dependencies: HLP-003, HLP-016

## HLP-018 WebSocket gateway base transport
Description: Create websocket service for pub/sub channels and heartbeats.
Acceptance Criteria:
- Supports connect, ping/pong, disconnect cleanup.
- Can broadcast typed events by channel.
- Exposes connection metrics.
Dependencies: HLP-002

## HLP-019 WS channel auth and subscription controls
Description: Enforce auth tier/role for websocket channel subscriptions.
Acceptance Criteria:
- Public, operator, and agent channels isolated.
- Unauthorized subscriptions denied.
- Backpressure drop policy implemented.
Dependencies: HLP-012, HLP-017, HLP-018

## HLP-020 ASCII floor public UI
Description: Build public read-only floor showing PnL% and obfuscated feed.
Acceptance Criteria:
- Renders live event tape.
- No sensitive fields displayed.
- Handles websocket reconnect gracefully.
Dependencies: HLP-013, HLP-018

## HLP-021 ASCII floor operator UI
Description: Build operator floor with full telemetry and command console.
Acceptance Criteria:
- Positions/risk/execution lanes render correctly.
- Command submission flow works with feedback.
- Role badges and state banners are visible.
Dependencies: HLP-014, HLP-019, HLP-022

## HLP-022 Command parser and execution bus
Description: Implement slash command parser and command event bus.
Acceptance Criteria:
- `/status`, `/positions`, `/simulate`, `/halt`, `/resume`, `/flatten` supported.
- Unknown commands return typed error.
- Command events include actor metadata.
Dependencies: HLP-002, HLP-012

## HLP-023 Kill switch and safe-mode command path
Description: Implement deterministic halt/safe-mode transitions and flatten controls.
Acceptance Criteria:
- `/halt` stops new order placement within 1s.
- `/flatten` emits risk-reducing close commands only.
- Actions require `operator_admin` and reason codes.
Dependencies: HLP-007, HLP-008, HLP-022

## HLP-024 Audit log writer and tamper evidence
Description: Ensure all critical actions/proposals/decisions are append-only and tamper-evident.
Acceptance Criteria:
- Every execution event has linked audit row.
- Audit hash chain or HMAC field stored.
- Audit export tool available.
Dependencies: HLP-002, HLP-003

## HLP-025 Session replay endpoint and UI timeline
Description: Build replay API and UI timeline for incident reconstruction.
Acceptance Criteria:
- Replay by time range and correlation ID works.
- Timeline shows proposal->decision->execution chain.
- Can export replay bundle.
Dependencies: HLP-024, HLP-021

## HLP-026 Plugin SDK and loader
Description: Implement plugin interfaces, manifest validation, and runtime loader.
Acceptance Criteria:
- Plugins validated for compatVersion and permissions.
- Loader can enable/disable plugins at runtime.
- Plugin crashes do not crash runtime process.
Dependencies: HLP-002, HLP-009

## HLP-027 Initial feed plugins (funding/correlation/vol)
Description: Build first-party plugins for funding, rolling correlation, and realized volatility.
Acceptance Criteria:
- Plugins emit normalized signal events.
- Signals consumed by strategy loop.
- Each plugin has test coverage.
Dependencies: HLP-026

## HLP-028 Observability stack integration
Description: Integrate OTel traces, Prometheus metrics, and Loki logs.
Acceptance Criteria:
- Golden metrics dashboard exists.
- Trace spans connect across services.
- Alert rules for stale data and risk denies configured.
Dependencies: HLP-011, HLP-018

## HLP-029 Security baseline (headers, rate limits, WAF hooks)
Description: Apply secure defaults across REST and websocket gateways.
Acceptance Criteria:
- Security headers and CORS policy configured.
- Route-level rate limiting enforced.
- Abuse events can trigger temporary bans.
Dependencies: HLP-014, HLP-017, HLP-019

## HLP-030 Secrets management with SOPS+age
Description: Add encrypted config management and runtime secret injection.
Acceptance Criteria:
- Secret files encrypted in repo.
- Boot-time decryption path documented.
- Rotation command documented and tested.
Dependencies: HLP-001

## HLP-031 systemd deployment and Cloudflare tunnel setup
Description: Add systemd services and tunnel config for home server deployment.
Acceptance Criteria:
- Services start on boot and auto-restart.
- Cloudflare tunnel routes web/api/ws hostnames.
- Deployment checklist verified on clean VM.
Dependencies: HLP-020, HLP-021, HLP-028, HLP-030

## HLP-032 End-to-end sim + live readiness checklist
Description: Build final readiness suite with sim burn-in and live guard checks.
Acceptance Criteria:
- 24h sim run with no critical errors.
- Kill-switch and safe-mode drills pass.
- Live mode enable gate requires explicit operator approval.
Dependencies: HLP-006, HLP-023, HLP-025, HLP-031
