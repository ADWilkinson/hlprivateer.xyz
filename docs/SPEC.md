# HL Privateer: End-to-End PRD + Technical Design + Implementation Plan

## 1) Product vision (PRD)

### 1.1 One-liner + elevator pitch + why now
- One-liner: HL Privateer is a self-hosted, agentic Hyperliquid trading platform with discretionary long/short strategy selection, deterministic risk gates, and a real-time ASCII trade floor.
- Elevator pitch: You run one Linux home server, connect it through Cloudflare Tunnel, and get a full autonomous trading desk: market data, strategy agents, execution, risk hard-gates, audit replay, and a monetizable external agent interface via x402 access tiers.
- Why now:
  - Hyperliquid latency/liquidity is now sufficient for systematic directional trading.
  - LLM agents are useful for hypothesis generation and adaptation, but only safe when hard-gated by deterministic controls.
  - x402-style machine payments unlock bot-to-bot markets where external agents can buy streams/insights programmatically.

### 1.2 Target users/personas
- Human operator (primary): owns risk budget, config, kill-switch authority, and incident response.
- Internal agents (7 roles):
  - `scout`: tick collection, feed freshness monitoring, watchlist management.
  - `research`: synthesizes new market context, regime analysis, and trade hypotheses.
  - `risk`: explains risk posture (GREEN/YELLOW/RED), but cannot bypass hard-gates.
  - `strategist`: proposes long/short directives with sizing, stop-loss, and take-profit levels.
  - `execution`: transforms strategy plans into structured `StrategyProposal` orders.
  - `scribe`: audit narrative synthesis, rationale documentation per proposal.
  - `ops`: monitors service health, floor stability, auto-halt watchdog.
- External agents/bots:
  - `subscriber-agent`: consumes obfuscated/public stream.
  - `premium-agent`: pays via x402 to unlock tiered endpoints/commands.
  - `integration-agent`: provides plugins (new feeds/skills/tools).

### 1.3 Jobs-to-be-done and key user stories
- JTBD: “Run a continuously trading, directional long/short fund with bounded downside and full auditability from my own server.”
- Human stories:
  - As operator, I can set hard risk limits and know no trade can bypass them.
  - As operator, I can halt all trading within one command and force safe mode.
  - As operator, I can replay any incident session and see every AI proposal and risk decision.
 - Agent stories:
  - As research-agent, I can propose trade hypotheses with rationale and confidence.
  - As execution-agent, I can request child-order slicing but only within deterministic slippage caps.
  - As external agent, I can authenticate, pay via x402, negotiate capabilities, and receive only tier-allowed data.

### 1.4 Core differentiators
- Agent-first control plane: system is built around agent loops and machine-readable contracts.
- Live ASCII floor UX: not dashboards only; operational floor with role avatars and event drama.
- Paid machine access: external agents unlock higher tiers with x402 payments.
- Privacy by default: public output shows only PnL percentage and obfuscated feed details.

### 1.5 Product scope

#### MVP (2-4 weeks)
- Included:
  - Hyperliquid market data + OMS with discretionary long/short strategy execution.
  - Deterministic risk engine hard-gate for every order.
  - Strategy plan state machine with long/short exposure parity constraints.
  - Production live mode with optional DRY_RUN parity mode, sharing identical contracts.
  - ASCII trade floor with `public` and `operator` views.
  - External agent API tiering + x402 verification (Tier 0 and Tier 1).
  - Append-only event store + audit trail + session replay (basic).
- Explicit cuts:
  - No multi-exchange routing in MVP.
  - No advanced ML training pipeline.
  - No mobile app.
  - No fixed-symbol strategy assumptions; discretion is plan-config driven.

#### V1 (next milestone)
- Tier 2/Tier 3 external access.
- Plugin marketplace with signed plugin bundles.
- Advanced replay UI with timeline scrub and branch comparisons.
- Better execution tactics (TWAP/VWAP micro-slicing under hard caps).

#### V2 (future)
- Multi-strategy portfolios.
- Cross-venue hedging adapters.
- Formal verification for high-risk invariants.
- Revenue share model for external plugin developers.

### 1.6 UX principles
- Every screen must show current risk state (`READY`, `HALT`, `SAFE_MODE`) prominently.
- Operator-critical actions require explicit confirmation and audit reason.
- Public view never leaks raw positions/notional; only sanctioned fields.
- All agent suggestions are displayed as proposals until validated.
- Fast situational awareness over visual polish: text-first, event-first, role-first.

### 1.7 Success metrics
- Technical:
  - 99.9% websocket uptime.
  - Event lag p95 < 200ms internal, < 700ms external tier streams.
  - Order acknowledgment p95 < 300ms (exchange-dependent).
- Product/ops:
  - Kill-switch latency < 1s end-to-end.
  - 100% executed orders have linked audit trail.
  - Mean time to incident root cause < 20 minutes via replay.
- Trading:
  - Max configured drawdown never exceeded during `IN_TRADE`.
  - Slippage breaches < 0.5% of fills.
  - Max configured drawdown never exceeded in live mode.
- Ecosystem:
  - 10+ external paying agents by end of V1.
  - Payment verification failure rate < 0.1%.

### 1.8 Non-goals
- Not a brokerage or custody service.
- Not “fully automatic profits” marketing software.
- Not financial advice or signal-selling platform for retail promises.

### 1.9 Risk & safety disclaimer copy
> HL Privateer is experimental software for research and operational automation. It does not provide financial advice. All trading decisions and losses are the sole responsibility of the operator. Use at your own risk. Past performance and simulations are not indicative of future results.

---

## 2) Core constraints (must be enforced in design)

- Strategy invariant: discretionary long/short structure with explicit thesis and risk budgets; no fixed symbol is assumed.
- AI invariant: AI can only `propose`; deterministic risk engine must `approve` before execution.
- Privacy invariant: public outputs expose PnL only in percent plus obfuscated status stream.
- Ecosystem invariant: external agents can interact only through authenticated tiered contracts; x402 required for paid tiers.
- Extensibility invariant: new feeds/integrations arrive as plugins implementing strict contract.
- Documentation invariant: `llms.txt`, `skills.md`, and full developer docs are first-class and versioned.
- Deployment invariant: self-hosted server with Cloudflare Tunnel ingress.
- Stack invariant: TypeScript-first across services, contracts, and plugin SDK.

---

## 3) System architecture (design + data flows)

### 3.1 Text-based architecture diagram

```text
                            +-----------------------------+
                            |        Cloudflare Edge      |
                            |  hlprivateer.xyz / api / ws |
                            +--------------+--------------+
                                           |
                                  Cloudflare Tunnel
                                           |
+---------------------------------------------------------------------------------+
| Home Server (Linux)                                                             |
|                                                                                 |
|  +-----------------+      +----------------+      +--------------------------+  |
|  | apps/web        |<---->| apps/ws-gateway|<---->| Redis Streams (event bus)|  |
|  | Next.js ASCII UI|      | Realtime fanout|      | + pub/sub cache          |  |
|  +--------+--------+      +--------+-------+      +-------------+------------+  |
|           |                        |                            |               |
|           v                        v                            v               |
|  +-----------------+      +----------------+      +--------------------------+  |
|  | apps/api        |<---->| apps/runtime   |<---->| packages/risk-engine     |  |
|  | REST/x402/Auth  |      | agent loop + OMS|     | deterministic gate       |  |
|  +--------+--------+      +--------+-------+      +-------------+------------+  |
|           |                        |                            |               |
|           +------------------------+----------------------------+               |
|                                    v                                            |
|                           +-----------------------+                             |
|                           | Postgres (primary DB) |                             |
|                           | events, orders, audit |                             |
|                           +-----------+-----------+                             |
|                                       |                                         |
|                                       v                                         |
|                         +-------------------------------+                       |
|                         | Observability stack           |                       |
|                         | OTel Collector + Prom + Loki  |                       |
|                         +-------------------------------+                       |
+---------------------------------------------------------------------------------+

External:
- Hyperliquid API/WebSocket
- x402 Verifier / chain RPC
```

### 3.2 Event-driven design (Redis Streams default)
- Stream names:
  - `hlp.market.raw`
  - `hlp.market.normalized`
  - `hlp.market.watchlist`
  - `hlp.strategy.proposals`
  - `hlp.plugin.signals`
  - `hlp.risk.decisions`
  - `hlp.execution.commands`
  - `hlp.execution.fills`
  - `hlp.audit.events`
  - `hlp.ui.events`
  - `hlp.payments.events`
  - `hlp.commands`
- Event envelope (all streams):

```ts
export interface EventEnvelope<T = unknown> {
  id: string; // ULID
  stream: string;
  type: string;
  ts: string; // ISO8601
  source: string; // service name
  correlationId: string;
  causationId?: string;
  actorType: "human" | "internal_agent" | "external_agent" | "system";
  actorId: string;
  payload: T;
  signature?: string; // optional HMAC for tamper evidence
  riskMode?: string; // SIM or LIVE
  sensitive?: boolean; // marks payload as containing sensitive data
}
```

- Flow:
  - Market connectors write normalized ticks.
  - Strategy runtime consumes ticks/state and emits proposals.
  - Risk engine consumes proposal + current exposure and emits `ALLOW`/`DENY`.
  - OMS executes only `ALLOW` commands, writes order/fill events.
  - UI and API consume derived projections.
  - Audit service mirrors every event to append-only table.

### 3.3 Trust boundaries
- Public boundary:
  - `GET /v1/public/pnl` and public websocket topics only.
  - Data limited to PnL percentage, health code, obfuscated state markers.
- Authenticated operator boundary:
  - Full telemetry, controls, configs, overrides, replay.
  - Strong authN + role-based authZ + optional IP allowlist.
- External agent boundary:
  - x402-validated entitlements map to tier capabilities.
  - Commands constrained by policy and rate quota.
- Internal-only boundary:
  - Risk engine, raw market feeds, full positions, signing keys.

### 3.4 Key management approach
- Hyperliquid trading key (EVM private key):
  - Stored as a plaintext `0x...` value in a local secret file referenced by `HL_PRIVATE_KEY_FILE`.
  - Generated by `scripts/ops/generate-trading-wallet.ts` into `secrets/` (gitignored, `chmod 600`).
  - Optional offline backup uses 2-of-2 XOR shards (`secrets/hl_trading_private_key.shard*.hex`).
  - Never logged, never sent over websocket/API.
- Operator auth secrets:
  - Operator JWT signing is symmetric (`JWT_SECRET` / `JWT_SECRET_FILE`).
  - Operator login bootstrap uses `OPERATOR_LOGIN_SECRET` / `OPERATOR_LOGIN_SECRET_FILE` (see `API.md`).
- x402:
  - `X402_PROVIDER=facilitator`: no local verifier secret (verification is facilitator-backed).
  - `X402_PROVIDER=mock`: uses `X402_VERIFIER_SECRET` / `X402_VERIFIER_SECRET_FILE` for deterministic local gating.
- Secret handling:
  - Prefer the `*_FILE` pattern everywhere so secrets never live in `.env` or git history.
  - For systemd deployments, mount secrets via `LoadCredential=`/`systemd-creds` or point `*_FILE` at gitignored files.
  - At-rest protection is provided by host hardening (and optionally full-disk encryption); SOPS/age is not required by the current implementation.

### 3.5 Failure modes and safe degradation
- Exchange websocket stale > threshold:
  - Enter `SAFE_MODE`; no new entries, only risk-reducing actions.
- Risk engine unavailable:
  - Fail closed: reject all execution commands.
- Redis outage:
  - Runtime buffers limited in-memory queue; if exceeded, switch `HALT`.
- DB unavailable:
  - Execution disabled (audit requirement). Existing open positions can be reduced via emergency path with local journal fallback.
- Cloudflare outage:
  - Local LAN/operator CLI still available; trading loop continues if internal health is green.

---

## 4) Components (detailed specs)

### 4.1 Hyperliquid connectivity + OMS

Interfaces:

```ts
export interface MarketDataAdapter {
  subscribe(symbols: string[]): Promise<void>;
  onTick(handler: (tick: NormalizedTick) => void): void;
  getOrderBook(symbol: string): Promise<OrderBookSnapshot>;
}

export interface OrderManager {
  place(order: ProposedOrder, ctx: ExecutionContext): Promise<PlacedOrder>;
  cancel(orderId: string, reason: string): Promise<void>;
  modify(orderId: string, patch: ModifyOrderInput): Promise<PlacedOrder>;
  reconcile(): Promise<ReconciliationReport>;
}
```

- Market data subscription:
  - Primary: exchange WS; secondary REST polling heartbeat.
  - Normalizer assigns monotonic sequence numbers and server timestamps.
- Order placement/cancel/modify:
  - All calls require `riskDecisionId` and `idempotencyKey`.
  - OMS enforces state transitions: `NEW -> WORKING -> PARTIALLY_FILLED -> FILLED|CANCELLED|FAILED`.
- Fill tracking/reconciliation:
  - Poll open orders every 3s as fallback.
  - Reconcile exchange fills with local ledger every 30s.
  - Any mismatch emits `execution.reconcile_mismatch` and enters `SAFE_MODE` if critical.
- Rate limiting and retry:
  - Token bucket per route (`orders`, `cancel`, `query`).
  - Retries: exponential backoff with jitter; max 3 for transient network errors.
  - No retry for semantic rejects (insufficient margin, invalid size).
- Idempotency:
  - Key format: `strategyCycleId:leg:action:nonce`.
  - Persist hash in `orders.idempotency_key` unique index.

### 4.2 Strategy + decision loop (agentic)

Loop model: `Sense -> Think -> Propose -> Validate -> Execute -> Review`

```ts
export interface StrategyProposal {
  proposalId: string;
  cycleId: string;
  summary: string;
  confidence: number; // 0-1
  actions: Array<{
    type: "ENTER" | "EXIT" | "REBALANCE" | "HOLD";
    rationale: string;
    notionalUsd: number;
    legs: Array<{
      symbol: string;
      side: "BUY" | "SELL";
      notionalUsd: number;
      targetRatio?: number; // 0-1
    }>;
    expectedSlippageBps: number;
    maxSlippageBps?: number;
  }>;
  createdBy: string;
  requestedMode: "SIM" | "LIVE";
}
```

- Tool/feed discovery:
  - Registry-backed plugin catalog in DB.
  - Runtime loads only enabled plugins matching `compatVersion`.
- AI output structuring:
  - LLM must emit strict JSON conforming to zod schema.
  - Parser rejects unknown fields and natural-language-only outputs.
- Prompt-injection resistance:
  - Tool inputs are labeled untrusted and passed through sanitizers.
  - Agent cannot call execution tools directly.
  - Critical policy/risk prompts are immutable, loaded from signed config.

### 4.3 Deterministic risk engine (hard gate)

Risk checks (sequential, all run unconditionally):
1. **DEPENDENCY_FAILURE**: external dependencies unavailable and `failClosedOnDependencyError` enabled.
2. **SYSTEM_GATED**: system is in HALT state.
3. **ACTOR_NOT_ALLOWED**: external agents blocked from direct execution.
4. **INVALID_PROPOSAL**: proposal has no actionable orders.
5. **SLIPPAGE_BREACH**: expected/max slippage exceeds `maxSlippageBps`.
6. **LEVERAGE**: projected gross/accountValue exceeds `maxLeverage`.
7. **DRAWDOWN**: projected drawdown% exceeds `maxDrawdownPct`.
8. **EXPOSURE**: projected gross exposure exceeds `maxExposureUsd`.
9. **LIQUIDITY**: order notional * `liquidityBufferPct` exceeds L2 book depth.
10. **SAFE_MODE**: proposal would increase gross notional (only risk-reducing allowed).
11. **STALE_DATA**: tick age exceeds `staleDataMs`.

Decision contract:

```ts
export interface RiskDecision {
  decisionId: string;
  proposalId: string;
  status: "ALLOW" | "DENY" | "ALLOW_REDUCE_ONLY";
  reasons: string[];
  computed: {
    grossExposureUsd: number;
    netExposureUsd: number;
    projectedDrawdownPct: number;
    notionalImbalancePct: number;
  };
  ts: string;
}
```

Hard-gate pseudocode:

```ts
export function evaluateRisk(config: RiskConfig, context: RiskContext): RiskDecisionResult {
  const reasons = [];

  if (!context.dependenciesHealthy && config.failClosedOnDependencyError)
    reasons.push("DEPENDENCY_FAILURE");
  if (context.state === "HALT") reasons.push("SYSTEM_GATED");
  if (context.actorType === "external_agent") reasons.push("ACTOR_NOT_ALLOWED");
  if (noActionableOrders(context.proposal)) reasons.push("INVALID_PROPOSAL");
  if (slippage > config.maxSlippageBps) reasons.push("SLIPPAGE_BREACH");
  if (projectedLeverage > config.maxLeverage) reasons.push("LEVERAGE");
  if (projectedDrawdown > config.maxDrawdownPct) reasons.push("DRAWDOWN");
  if (grossExposure > config.maxExposureUsd) reasons.push("EXPOSURE");
  if (bookDepth < orderNotional * config.liquidityBufferPct) reasons.push("LIQUIDITY");
  if (state === "SAFE_MODE" && wouldIncreaseExposure) reasons.push("SAFE_MODE");
  if (tickAge > config.staleDataMs) reasons.push("STALE_DATA");

  // Exit proposals exempt from DRAWDOWN if reducing exposure
  return hasBlockers ? "DENY" : state === "SAFE_MODE" ? "ALLOW_REDUCE_ONLY" : "ALLOW";
}
```

Risk configuration:

```ts
interface RiskConfig {
  maxLeverage: number;              // e.g. 2
  targetLeverage?: number;          // optional sizing hint for agent layers
  maxDrawdownPct: number;           // e.g. 5
  maxExposureUsd: number;           // e.g. 10000
  maxSlippageBps: number;           // e.g. 20
  staleDataMs: number;              // e.g. 3000
  liquidityBufferPct: number;       // e.g. 1.1
  failClosedOnDependencyError: boolean;
}
```

- Kill switch and safe mode:
  - `HALT`: reject all new orders; allow cancel/flatten only.
  - `SAFE_MODE`: deny new entries, allow rebalances that reduce risk. Exit proposals that reduce gross notional are exempted from DRAWDOWN checks.
- Human override controls:
  - AuthZ role `operator_admin` required.
  - All overrides require reason code and expire automatically.
- DRY_RUN operator mode:
  - Same interfaces/events, non-execution adapter with no exchange side-effects.

### 4.4 Data feeds + plugin system

Plugin contract:

```ts
export interface PrivateerPlugin {
  id: string;
  version: string;
  kind: "feed" | "tool" | "signal";
  compatVersion: string; // platform semver range
  permissions: Array<"NET_OUTBOUND" | "READ_CACHE" | "WRITE_EVENT">;
  init(ctx: PluginContext): Promise<void>;
  tick?(ctx: PluginTickContext): Promise<void>;
  shutdown(): Promise<void>;
}

export interface PluginContext {
  emit(event: EventEnvelope): Promise<void>;
  readCache<T>(key: string): Promise<T | null>;
  httpGet?(url: string, opts?: { timeoutMs?: number }): Promise<unknown>;
}
```

- Example plugins:
  - `feed.price.hyperliquid`
  - `feed.funding.hyperliquid`
  - `signal.sentiment.news`
  - `signal.onchain.flow`
  - `signal.correlation.rolling`
  - `signal.realized_vol`
- Versioning:
  - Semver for plugin and platform compatibility.
  - Canary enablement for one cycle before global enable.
- Sandboxing:
  - Run plugins in isolated worker threads with memory/time limits.
  - Permission manifest required; default deny outbound network.

### 4.5 ASCII Trade Floor UI (visual + real-time)

Roles/avatars:
- `SCT` Scout, `RCH` Research, `RSK` Risk, `STR` Strategist, `EXE` Execution, `SCR` Scribe, `OPS` Ops.

Render rules:
- Each event maps to lane + severity color + sound cue (optional).
- Avatar “movement” is deterministic: event count per role influences position.
- Speech bubbles are structured and rate-limited, max 140 chars.

Views:
- Public read-only:
  - PnL percentage, uptime, obfuscated tape (`EVENT#A3`, `RISK:GREEN|AMBER|RED`).
- Operator:
  - Full positions, risk metrics, order lifecycle, command console.
- External agent view:
  - Tier-scoped fields and commands only.

Interaction:
- Slash commands and structured actions over websocket.
- Commands are converted into typed command envelopes then authZ checked.

ASCII mockup:

```text
+--------------------------------------------------------------------------------+
| HL PRIVATEER FLOOR | MODE: READY | PNL: +2.84% | DD: 1.2% | LAT: 142ms        |
+--------------------------------------------------------------------------------+
| RCH [^]  "SOL momentum weakening, funding negative"                           |
| RSK [!]  "Exposure within limits, drawdown 1.2%"                              |
| EXE [>]  "Placed BUY BTC 4.32 @ 23.14"                                       |
| MKT [~]  "Funding divergence +12 bps"                                        |
| OPS [#]  "Redis lag 8ms | WS clients 42"                                     |
| CON [$]  "Agent tier1 unlocked: bot_0x9f..."                                 |
+--------------------------------------------------------------------------------+
| /status  /positions  /risk-policy  /halt  /resume  /unlock tier2             |
+--------------------------------------------------------------------------------+
```

Implementation:
- Next.js frontend renders terminal-like grid.
- Websocket updates through `apps/ws-gateway` using topic subscriptions.
- ANSI-like style mapping done in client with deterministic parser.

### 4.6 External agent API + x402 payments + access tiers

Access tiers:
- Tier 0 (free): public pnl percent + delayed obfuscated events.
- Tier 1 (paid): near-real-time obfuscated events + basic command `/status`.
- Tier 2 (paid+): limited positions summary bands, strategy state, `/risk-policy`.
- Tier 3 (whitelisted): richer telemetry and command APIs with strict quotas.

Payment flow:
1. Agent requests protected endpoint without entitlement.
2. API responds `402 Payment Required` with `x402-challenge` payload.
3. Agent signs/submits payment proof in `x402-payment` header.
4. `payments-service` verifies proof via verifier/RPC.
5. Entitlement row created with expiry and quota.

Anti-abuse:
- Per-key and per-IP token buckets.
- Daily quota per tier.
- Reputation score with auto-throttle for anomalous behavior.
- Ban list at API gateway and websocket layer.

Agent handshake protocol:

```json
{
  "type": "agent.hello",
  "agentId": "bot-abc",
  "agentVersion": "1.2.0",
  "capabilities": ["stream.read", "command.status"],
  "requestedTier": "tier2",
  "proof": "<jwt-or-x402-proof>"
}
```

Server response:

```json
{
  "type": "agent.welcome",
  "sessionId": "ses_01J...",
  "grantedTier": "tier1",
  "capabilities": ["stream.read", "command.status"],
  "quota": { "rpm": 120, "daily": 5000 },
  "expiresAt": "2026-02-14T12:00:00Z"
}
```

### 4.7 Observability + audit trail
- Structured logs (JSON): include `correlationId`, `proposalId`, `decisionId`, `orderId`.
- Metrics:
  - `risk_denies_total`, `orders_submitted_total`, `fill_slippage_bps`, `event_lag_ms`, `ws_connected_clients`.
- Traces:
  - OTel spans from proposal generation through order execution.
- Event sourcing/replay:
  - Append-only `events` table stores canonical envelopes.
  - Replay tool can reconstruct state at timestamp T.
- Mandatory audit log entries:
  - Every AI proposal.
  - Every risk decision with reasons.
  - Every order action and external command.

---

## 5) Data model (storage)

Primary datastore: PostgreSQL 16 (single-node, WAL archiving, optional TimescaleDB extension for metrics).

Core tables:
- `accounts(id, name, mode, status, created_at)`
- `key_refs(id, account_id, key_type, encrypted_blob_ref, rotated_at, created_at)`
- `configs(id, scope, version, config_json, active, created_at)`
- `strategy_state(id, state, cycle_id, basket_json, updated_at)`
- `orders(id, external_order_id, proposal_id, decision_id, symbol, side, type, price, qty, notional_usd, status, idempotency_key, created_at, updated_at)`
- `fills(id, order_id, external_fill_id, symbol, qty, price, fee, liquidity_flag, ts)`
- `positions(id, symbol, side, qty, avg_price, notional_usd, unrealized_pnl_usd, updated_at)`
- `pnl_snapshots(id, ts, pnl_pct, pnl_usd, drawdown_pct, gross_exposure_usd)`
- `events(id, stream, type, envelope_json, ts)` append-only
- `audits(id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, ts)`
- `users(id, email, role, status, mfa_enabled, created_at)`
- `api_keys(id, principal_type, principal_id, key_hash, tier, status, last_used_at, created_at)`
- `tiers(id, name, limits_json, fields_json, created_at)`
- `payments(id, principal_id, network, tx_hash, amount, currency, status, verified_at, metadata_json, created_at)`
- `entitlements(id, principal_id, tier_id, starts_at, ends_at, quota_json, status)`
- `plugins(id, plugin_key, version, kind, manifest_json, status, checksum, created_at)`
- `plugin_releases(id, plugin_id, version, artifact_url, signature, created_at)`

Indexes:
- `orders(idempotency_key)` unique.
- `orders(status, created_at desc)`.
- `fills(order_id, ts desc)`.
- `events(stream, ts desc)` + BRIN on `events.ts`.
- `audits(ts desc, actor_id)`.
- `payments(principal_id, status, created_at desc)`.
- `entitlements(principal_id, status, ends_at)`.

Retention:
- `events`: 180 days hot, then compressed archive (Parquet) to local object storage/NAS.
- `audits`: 1 year online minimum.
- `market raw ticks`: 30 days unless flagged by incident.

Encryption-at-rest and backups:
- Disk-level encryption (LUKS) + PostgreSQL TLS local disabled only if unix socket.
- WAL-G nightly backups to encrypted restic repo.
- Restore drill weekly in staging VM.

---

## 6) API & Protocol specs

### 6.1 HTTP API endpoints (REST)

Public:
- `GET /v1/public/pnl`
- `GET /v1/public/floor-snapshot`
- `GET /v1/public/floor-tape`

Operator:
- `POST /v1/operator/login` (bootstrap auth with `OPERATOR_LOGIN_SECRET`)
- `POST /v1/operator/refresh` (JWT token refresh)
- `GET /v1/operator/status`
- `GET /v1/operator/positions`
- `GET /v1/operator/orders?status=open`
- `GET /v1/operator/audit?from=&to=`
- `POST /v1/operator/command` (`halt`, `resume`, `risk-policy`, `flatten`)
- `PATCH /v1/operator/config/risk`
- `POST /v1/operator/replay/start`
- `GET /v1/operator/replay` (query replay events)
- `GET /v1/operator/replay/export` (export audit range)

External agents:
- `POST /v1/agent/handshake`
- `GET /v1/agent/entitlement`
- `GET /v1/agent/stream/snapshot`
- `GET /v1/agent/analysis`
- `GET /v1/agent/insights`
- `GET /v1/agent/positions`
- `GET /v1/agent/orders`
- `POST /v1/agent/command`
- `POST /v1/agent/unlock/:tier`

Deprecated compatibility aliases:
- `GET /v1/agent/analysis/latest`
- `GET /v1/agent/data/overview`
- `GET /v1/agent/copy-trade/signals`
- `GET /v1/agent/copy-trade/positions`

Internal:
- `GET /v1/security/refresh-secrets` (operator-only, hot-reload secrets)

Example public response:

```json
{
  "pnlPct": 2.84,
  "mode": "READY",
  "updatedAt": "2026-02-13T16:04:11Z"
}
```

### 6.2 Websocket protocol

Connection/auth handshake:
- Public: no token, receives limited topics.
- Operator: JWT with role claims (`operator_view`, `operator_admin`).
- External agent: API key + entitlement token or x402 proof session.

Client → Server messages:

```ts
// Subscribe to a channel
{ type: "sub.add", channel: "public" | "operator" | "agent" | "replay" | "audit", token?: string }
// Unsubscribe
{ type: "sub.remove", channel: string }
// Execute a command
{ type: "cmd.exec", command: string, args: string[] }
// Keep-alive
{ type: "ping" }
```

Server → Client messages:

```ts
// Subscription acknowledgment
{ type: "sub.ack", channel: string, accepted: boolean }
// Event broadcast
{ type: "event", channel: string, payload: unknown }
// Command result
{ type: "cmd.result", requestId: string, result: CommandResult }
// Error
{ type: "error", requestId: string, code: string, message: string }
// Keep-alive response
{ type: "pong" }
```

Example websocket payload:

```json
{
  "type": "risk.decision",
  "ts": "2026-02-13T16:05:00Z",
  "channel": "operator.risk",
  "payload": {
    "decisionId": "dec_01J...",
    "proposalId": "prop_01J...",
    "status": "ALLOW",
    "reasons": [],
    "computed": {
      "grossExposureUsd": 8200,
      "netExposureUsd": 120,
      "projectedDrawdownPct": 1.4,
      "notionalImbalancePct": 0.7
    }
  }
}
```

Subscriptions and backpressure:
- Client sends `sub.add` and `sub.remove`.
- Server maintains bounded queue per connection.
- On overflow, low-priority channels are dropped first; critical alerts always delivered.

### 6.3 Command protocol (human + agent)

Commands:
- `/status`
- `/explain`
- `/positions`
- `/unlock tier2`
- `/risk-policy`
- `/halt`
- `/resume`
- `/flatten`

Command schema:

```ts
export const CommandSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  actorType: z.enum(["human", "external_agent", "internal_agent"]),
  actorId: z.string(),
  sessionId: z.string(),
  reason: z.string().optional()
});
```

Permissions model:
- `public`: none.
- `agent_tier1`: `/status`, `/unlock`.
- `agent_tier2`: `/risk-policy`, `/explain` (redacted).
- `operator_view`: `/status`, `/positions`, `/explain`.
- `operator_admin`: all commands including `/halt`, `/resume`, `/flatten`, config mutations.

---

## 7) Security model

Assets:
- Trading keys, operator credentials, risk configs, position/execution state, payment entitlements.

Adversaries:
- Internet attackers scanning public endpoints.
- Malicious external agents attempting data exfiltration or command abuse.
- Prompt-injection via feed/plugin content.
- Insider with stolen operator session.

Attack surfaces:
- Public REST/WS endpoints.
- Plugin loading and outbound network calls.
- Agent command channel.
- Secret files and runtime env.

Prompt injection scenarios and mitigations:
- Scenario: news plugin contains “ignore risk policy” text.
- Mitigation:
  - LLM prompt separates untrusted data channel from policy channel.
  - LLM output must be schema-valid and cannot call execution tools directly.
  - Deterministic risk gate enforces invariants independent of LLM output.

External agent malicious behavior mitigations:
- Replay attacks: nonce + timestamp window + signature check.
- Quota abuse: token buckets and circuit ban.
- Command spamming: per-command cooldown.
- Data scraping: tiered field redaction and watermarking.

Key leakage prevention:
- No keys in repo/history.
- systemd credentials and strict file ACLs (`chmod 600`).
- Secret scanning pre-commit and CI.

Network security:
- Inbound only through Cloudflare Tunnel.
- Local firewall allow only loopback/internal ports.
- Optional Cloudflare Access for operator routes.

AuthN/AuthZ:
- Operator: OIDC + MFA + short JWT (15m) and refresh flow.
- Services: mTLS or signed service tokens.
- External agents: API key + entitlement token + optional x402 proof binding.
- Rotation:
  - API keys: manual + automatic expiration.
  - JWT keys: 30-day rotation.

Secure defaults:
- Fresh installs default to `DRY_RUN=true` for initial safety checks, then switch to `DRY_RUN=false` before production execution.
- `LIVE_MODE` requires explicit operator unlock each boot.
- Unknown plugin permissions default deny.

---

## 8) Concrete stack + repo plan (TypeScript-first)

Default choices:
- Monorepo: `bun + turborepo`.
- Backend: `Fastify` (high performance, schema-first, low overhead).
- Web app: `Next.js` for operator/public UI.
- Websocket: dedicated `ws` gateway service for fanout and isolation.
- DB: `PostgreSQL + Drizzle ORM` for explicit SQL + strong TS types.
- Event bus: `Redis Streams` (simple single-node ops for home server).
- Runtime/process manager: `Node.js 22 + systemd`.
- Observability: `OpenTelemetry + Prometheus + Grafana + Loki`.
- Secrets: `*_FILE` pattern + systemd credentials (optional: host disk encryption; future: SOPS/age).

### 8.1 Monorepo structure

```text
hlprivateer.xyz/
  apps/
    api/
    runtime/
    ws-gateway/
    agent-runner/
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
  llms.txt
  skills.md
  README.md
  SECURITY.md
  RUNBOOK.md
  API.md
```

### 8.2 Service boundaries and ports
- `apps/web`: static build for Cloudflare Pages (local dev server 3000).
- `apps/api`: 4000 (REST, auth, x402 enforcement).
- `apps/ws-gateway`: 4100 (WS channels).
- `apps/runtime`: no public port (internal worker).
- `apps/agent-runner`: no public port (internal LLM orchestration worker).
- Postgres: 5432 localhost only.
- Redis: 6379 localhost only.

### 8.3 Env var list and config files
- Source of truth: `config/.env` based on `config/.env.example`.
- Key groups: core, network, db, redis, auth, hyperliquid, risk, x402, observability.

### 8.4 systemd units (preferred)
- `hlprivateer-api.service`
- `hlprivateer-runtime.service`
- `hlprivateer-ws.service`
- `hlprivateer-agent-runner.service`
- `cloudflared.service` (or a dedicated `hlprivateer-cloudflared.service` if you prefer per-app tunnel isolation)

### 8.5 Cloudflare Tunnel config outline
- Config template at `infra/cloudflared/config.yml.example`.
- Hostnames:
  - `hlprivateer.xyz` + `www.hlprivateer.xyz` -> Cloudflare Pages
  - `api.hlprivateer.xyz` -> api 4000 (Tunnel)
  - `ws.hlprivateer.xyz` -> ws 4100 (Tunnel)

---

## 9) Trading framework (explicit rules)

State machine:
- `INIT` -> boot checks and key load.
- `WARMUP` -> collect minimum market windows.
- `READY` -> eligible for entries.
- `IN_TRADE` -> active long/short exposure.
- `REBALANCE` -> adjusting existing position (add/trim/rotate).
- `HALT` -> human/system forced stop.
- `SAFE_MODE` -> only risk-reducing actions.

Transition rules:
- `INIT -> WARMUP` when services healthy.
- `WARMUP -> READY` after N ticks and freshness checks pass.
- `READY -> IN_TRADE` when strategy proposal passes risk.
- `IN_TRADE -> REBALANCE` when adjusting existing exposure.
- `* -> SAFE_MODE` on stale data/high volatility/liquidity breach.
- `* -> HALT` on kill-switch/manual critical incident.

Decision cadence and triggers:
- Time-based: at least once per hour (AGENT loop cadence).
- Event-based immediate cycles on:
  - spread z-score crossing thresholds
  - fill completion events
  - volatility regime change

Universe selection for long/short exposure:
- Start set: top liquid perp assets from Hyperliquid.
- Filter by:
  - minimum 24h volume
  - spread stability
  - borrow/funding constraints
- Recompute universe at configured cadence.

Discretionary sizing math:
- Define target gross notional `G`.
- For each symbol `i`, strategist-proposed leg notional `N_i` includes direction and confidence.
- Quantity = `round_down(|N_i| / markPrice_i, lotSize_i)`.
- Enforce post-rounding imbalance <= policy `maxNotionalImbalancePct`.

Execution rules:
- Default order type: post-only limit.
- Fallback to marketable limit if urgency raised by risk timeout.
- Slippage cap: reject if projected slippage > configured bps.
- Partial fills:
  - track per leg fill ratio.
  - trigger compensating re-quote for lagging leg.

Rebalancing and exits:
- Rebalance trigger if notional imbalance > 1.5% for > 10s.
- Exit trigger:
  - spread mean-reversion target reached,
  - stop-loss breached,
  - regime invalidation,
  - manual flatten.

Risk rules:
- Global max drawdown and max gross exposure.
- Max leverage cap (gross notional / account value).
- Notional parity enforcement (long/short imbalance tolerance).
- Max slippage cap per action.
- Stale data and thin book (liquidity) circuit breakers.
- External agent execution blocked at risk layer.

Dry-run behavior:
- Same API contracts and event streams.
- No exchange execution orders are sent while DRY_RUN is enabled; analysis, proposals, and risk logs continue unchanged.

Worked example:
- Inputs:
  - `G = $10,000`
  - Long SOL `N = $3,200`, Short BTC `N = -$3,100`, Short ETH `N = -$3,700`
  - Prices: SOL `110`, ETH `3400`, BTC `68000`
- Target notionals:
  - Long SOL qty `3200/110 = 29.090` -> `29.1` (lot rounded)
  - Short BTC qty `3100/68000 = 0.0456`
  - Short ETH qty `3700/3400 = 1.088`
- If post-rounding imbalance exceeds policy and persists, transition to `REBALANCE` and submit risk-approved corrective orders.

---

## 10) Build plan

### 10.1 MVP plan (4-week breakdown)

Week 1
- Day 1: repo scaffold, contracts package, env and secret plumbing.
- Day 2: Redis Streams + event envelope + audit writer.
- Day 3: Hyperliquid market adapter + normalized tick stream.
- Day 4: OMS skeleton with idempotency and state transitions.
- Day 5: Basic Fastify API and auth boundaries.

Week 2
- Day 6: deterministic risk engine package + execution hardening.
- Day 7: strategy loop scaffolding + schema-validated proposals.
- Day 8: execution validation, reconciliation, and dry-run/live parity checks.
- Day 9: state machine integration and safe-mode logic.
- Day 10: operator commands (`/halt`, `/resume`, `/risk-policy`).

Week 3
- Day 11: Next.js ASCII floor public view.
- Day 12: operator view with telemetry channels.
- Day 13: websocket gateway with subscription/auth.
- Day 14: external agent handshake API.
- Day 15: x402 verifier integration + Tier 1 entitlement.

Week 4
- Day 16: observability stack (metrics/logs/traces).
- Day 17: session replay from event store.
- Day 18: security hardening, key rotation scripts.
- Day 19: incident drills and kill-switch testing.
- Day 20: deployment runbook validation and production cutover.

### 10.2 GitHub issue backlog (32 issues)

Full details are in `docs/GITHUB_ISSUES.md`. Summary IDs:
- `HLP-001` Repo bootstrap and workspace tooling
- `HLP-002` Event envelope and Redis Streams foundation
- `HLP-003` Postgres schema v1 with migrations
- `HLP-004` Hyperliquid market data adapter
- `HLP-005` OMS order lifecycle engine
- `HLP-006` Fill reconciliation worker
- `HLP-007` Deterministic risk engine package
- `HLP-008` Trading state machine
- `HLP-009` Strategy proposal schema and parser
- `HLP-010` Execution adapter parity and dry-run safeguards
- `HLP-011` Runtime orchestrator loop
- `HLP-012` Operator auth and RBAC
- `HLP-013` Public API endpoints (PnL + obfuscated snapshot)
- `HLP-014` Operator API endpoints
- `HLP-015` Agent handshake API
- `HLP-016` x402 payment challenge/verify flow
- `HLP-017` Entitlements and tier enforcement middleware
- `HLP-018` WebSocket gateway base transport
- `HLP-019` WS channel auth and subscription controls
- `HLP-020` ASCII floor public UI
- `HLP-021` ASCII floor operator UI
- `HLP-022` Command parser and execution bus
- `HLP-023` Kill switch and safe-mode command path
- `HLP-024` Audit log writer and tamper evidence
- `HLP-025` Session replay endpoint and UI timeline
- `HLP-026` Plugin SDK and loader
- `HLP-027` Initial feed plugins (funding/correlation/vol)
- `HLP-028` Observability stack integration
- `HLP-029` Security baseline (headers, rate limits, WAF hooks)
- `HLP-030` Secrets management via `*_FILE` + systemd credentials
- `HLP-031` systemd deployment and Cloudflare tunnel setup
- `HLP-032` End-to-end dry-run + live readiness checklist

### 10.3 Definition of Done checklist
- Deterministic risk checks cover 100% of execution paths.
- Kill switch verified in both dry-run and live adapters.
- Public view exposes only approved fields.
- Every trade/action linked to audit entries.
- Replay can reconstruct at least one full incident.
- Security review completed and documented in `SECURITY.md`.
- Runbook steps tested on clean server.
- At least 80% coverage for risk/state-machine modules.

---

## 11) Agent-first docs artifacts (generated)

- `llms.txt` created with navigation and agent operating rules.
- `skills.md` created with internal and external skill contracts and schemas.
- `README.md` created for human developers.
- `SECURITY.md` created with threat model and disclosure process.
- `RUNBOOK.md` created for deploy/rotation/incident operations.
- `API.md` created with REST, websocket, and command contracts.

---

## 12) Output format

This spec intentionally mirrors sections 1-12 requested by the prompt, with concrete contracts, interfaces, and deploy-ready artifacts in this repository.
