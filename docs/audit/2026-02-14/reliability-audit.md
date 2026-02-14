# Reliability & Correctness Audit (2026-02-14)

Repo: `hlprivateer.xyz` (main)

## System Flow (Dependency / Decision Graph)

```
Hyperliquid (WS + HTTP info)
  | market ticks / L2 snapshots / candles / funding history
  v
runtime (apps/runtime)
  - market adapter + plugin manager
  - deterministic risk engine gate (packages/risk-engine)
  - execution adapter (SIM/LIVE OMS)
  - persistence (Postgres when DRY_RUN=false)
  - publishes UI events + risk decisions + positions
  |
  | hlp.ui.events: STATE_UPDATE, POSITION_UPDATE, FLOOR_TAPE
  | hlp.plugin.signals: funding/correlation/volatility
  | hlp.strategy.proposals: proposals accepted from agent-runner
  v
redis streams (packages/event-bus)
  ^
  |
agent-runner (apps/agent-runner)
  - consumes ticks/signals/state/positions
  - produces StrategyProposal + floor tape + audits
  - can publish /risk-policy (tighten) and /flatten via runtime command channel

api (apps/api) <-> store snapshot
  - operator JWT commands: /halt /resume /flatten /status
  - public pnl/floor snapshot

ws-gateway (apps/ws-gateway) -> web UI (apps/web)
  - streams floor state/tape/positions to the ASCII "trading floor"
```

## Known Issues: Root Cause + Fixes

### 1) Dust Exposure Treated As Material (Recovery Never Settles)

Root cause:
- Runtime defines “meaningful exposure” using `RUNTIME_FLAT_DUST_NOTIONAL_USD` (min 50 USD) and uses that for SAFE_MODE gating and state transitions.
- Agent-runner previously treated any `POSITION_UPDATE` row as exposure (and used a smaller threshold derived from `AGENT_MIN_REBALANCE_LEG_USD`, default 25 USD), which caused the strategist loop to continue issuing EXIT logic and/or suppress “flat recovered” transitions even after runtime considered the system flat enough to resume.

Fix:
- Agent-runner now reads `RUNTIME_FLAT_DUST_NOTIONAL_USD` and filters `POSITION_UPDATE` down to meaningful positions at ingestion time, ensuring dust does not trap the strategist in recovery logic.

Evidence:
- Code path references:
  - Agent-runner aligns its flat threshold: `apps/agent-runner/src/index.ts:717`
  - Agent-runner filters dust at ingestion: `apps/agent-runner/src/index.ts:3168`
- Unit tests added for the exposure helpers: `apps/agent-runner/src/exposure.test.ts`
- Ran:
  - `cd apps/agent-runner && bun run test` (pass)

Patch:
- Commit `89f5d21` (agent-runner + docs)

### 2) SAFE_MODE “No Exposure” Hold Notice Never Fires (Operator Visibility Bug)

Root cause:
- SAFE_MODE used a single timestamp throttle for both 30s and 60s notices, which made the 60s “no open exposure” message unreachable during normal 30s dependency notices.

Fix:
- Introduced a dedicated 60s throttle for the “no exposure” hold notice and return immediately after auto-resolve to READY, avoiding contradictory “hold” messages after state changes.

Evidence:
- Code path references:
  - New throttle state: `apps/runtime/src/orchestrator/state.ts:242`
  - SAFE_MODE hold message: `apps/runtime/src/orchestrator/state.ts:806`
- Ran:
  - `cd apps/runtime && bun run test` (pass)

Patch:
- Commit `3008fcd` (runtime)

### 3) `/flatten` Could Attempt Invalid Orders With Non-finite Notional (Unsafe Operation)

Root cause:
- `/flatten` used `Math.abs(position.notionalUsd)` without guarding non-finite values; if upstream ever delivers `NaN`/`Infinity`, comparisons behave unexpectedly and the runtime can attempt to place an invalid order.

Fix:
- Skip positions with non-finite or non-positive computed notional inside `/flatten`.

Evidence:
- Code path reference: `apps/runtime/src/orchestrator/state.ts:1420`

Patch:
- Commit `3008fcd` (runtime)

## Findings Table

| Sev | Status | Finding | Impact | Root Cause | Fix / Next Step | Evidence |
|---|---|---|---|---|---|---|
| P1 | Fixed | Dust exposure treated as material by agent-runner, preventing recovery from settling | Repeated EXIT posture and operational “stuck” behavior when only sub-dust positions remain | Threshold mismatch + agent-runner ingesting dust positions as exposure | Align to `RUNTIME_FLAT_DUST_NOTIONAL_USD` and filter `POSITION_UPDATE` to meaningful positions | `apps/agent-runner/src/index.ts:717`, `apps/agent-runner/src/index.ts:3168`, commit `89f5d21` |
| P2 | Fixed | SAFE_MODE 60s “no open exposure” hold notice unreachable | Reduced operator visibility during recovery holds | Shared 30s/60s throttle timestamp | Add separate 60s throttle and return after auto-resolve | `apps/runtime/src/orchestrator/state.ts:242`, `apps/runtime/src/orchestrator/state.ts:806`, commit `3008fcd` |
| P1 | Fixed | `/flatten` could try to place invalid orders for non-finite notionals | Potential invalid order attempts in a safety-critical path | Missing non-finite guard | Skip non-finite/non-positive notionals | `apps/runtime/src/orchestrator/state.ts:1420`, commit `3008fcd` |
| P3 | Fixed | Runtime correlation plugin test missing required config | Flaky/incorrect test signal (false negative) | Test context returned `getConfig() => undefined` | Provide `BASKET_SYMBOLS` in test context | `apps/runtime/src/plugins/plugins.test.ts:59`, commit `3008fcd` |
| P2 | Debt | Docker deploy does not force base-image refresh or no-cache rebuild | Risk of stale builds during incident mitigation | `docker compose up --build` relies on cache unless operator opts into additional steps | Add `DEPLOY_PULL=1` or `--pull` option and document rollback semantics | `scripts/ops/deploy-docker.sh` |
| P2 | Debt | No explicit healthcheck for agent-runner in compose | Reduced visibility; runner can be dead while stack appears healthy | `hlprivateer-agent-runner` has no HTTP health endpoint and no compose healthcheck | Add lightweight `/healthz` (or stream heartbeat metric) and wire compose healthcheck | `infra/docker-compose.yml` |

## Immediate Fixes Plan (Stop Incidents First)

1. Stop recovery loops caused by dust exposure mismatch (already fixed in commit `89f5d21`).
2. Make SAFE_MODE recovery status visible and unambiguous (already fixed in commit `3008fcd`).
3. Harden `/flatten` against unsafe input and prevent invalid order attempts (already fixed in commit `3008fcd`).

## Structural Remediation Plan (Hardening)

1. Make “meaningful exposure” a first-class concept in contracts:
   - Emit both `positions` and `meaningfulPositions` (or `dustPositions`) in `POSITION_UPDATE`, so every consumer uses the same semantics.
2. Add an integration test for recovery convergence:
   - Given a partial flatten that leaves sub-dust residual positions, the system should converge to READY and resume proposal flow without repeating flatten/exit attempts.
3. Add a chaos-style test matrix for external dependencies:
   - Hyperliquid candle snapshot returns empty/out-of-order.
   - WS lag > stale threshold.
   - Postgres down during DRY_RUN=false.
4. Add operator-visible metrics:
   - `safe_mode_cycles_total`, `flatten_attempts_total`, `recovery_hold_seconds`, and “last successful flatten” timestamp.

## Patch Set (Per Subsystem)

### Agent Runner
- Commit `89f5d21`
- Files:
  - `apps/agent-runner/src/config.ts`
  - `apps/agent-runner/src/index.ts`
  - `apps/agent-runner/src/exposure.ts`
  - `apps/agent-runner/src/exposure.test.ts`
  - `docs/AGENT_RUNNER.md`

### Runtime
- Commit `3008fcd`
- Files:
  - `apps/runtime/src/orchestrator/state.ts`
  - `apps/runtime/src/plugins/plugins.test.ts`

## Tests To Add (Mapped To Fixes)

1. Agent-runner: “dust positions do not block recovery” integration test
   - Feed a `POSITION_UPDATE` containing only sub-dust notionals.
   - Expect strategist cycle to treat as flat and not emit EXIT proposals indefinitely.
2. Runtime: SAFE_MODE recovery convergence test
   - Simulate SAFE_MODE + open exposure, then partial flatten to below dust threshold.
   - Expect transition to READY and no repeated flatten requests beyond cooldown.
3. Runtime: `/flatten` contract test for non-finite notional
   - Provide a snapshot position with `notionalUsd=NaN` and ensure no `adapter.place()` call is attempted.

## Deployment + Rollback Plan

Deployment (compose):
1. `npm run deploy:docker`
2. Verify:
   - `LOCAL=1 bash scripts/readiness/smoke.sh`
   - `curl -sf http://127.0.0.1:9400/healthz`

Rollback (compose + git):
1. `git revert 89f5d21 3008fcd` (or revert individually by subsystem)
2. `npm run deploy:docker`
3. Re-run `scripts/readiness/smoke.sh`

## Post-fix Validation Evidence Bundle

Automated:
- `cd apps/agent-runner && bun run test` (pass)
- `cd apps/runtime && bun run test` (pass)

Manual / operator checks:
1. Force SAFE_MODE and ensure the hold notice cadence is sane:
   - While SAFE_MODE holds with no exposure, confirm the 60s “no open exposure” message is emitted (and not suppressed forever).
2. Inject a POSITION_UPDATE with only sub-dust notionals:
   - Confirm agent-runner does not remain stuck in EXIT or keep issuing recovery proposals.

## Definition Of Done (Before Merge)

1. Unit tests pass in `apps/runtime` and `apps/agent-runner`.
2. Smoke passes (`scripts/readiness/smoke.sh`).
3. SAFE_MODE recovery does not loop indefinitely on dust exposure.
4. `/flatten` does not attempt invalid orders (guards in place).
5. Operator UI shows coherent mode/exposure/hold messaging during recovery.

