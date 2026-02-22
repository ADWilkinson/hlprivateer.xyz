# Contracts - Development Context

## Overview
Shared Zod schemas and TypeScript types for type-safe communication across all apps. Single source of truth for event envelopes, proposals, risk decisions, commands, WebSocket messages, payment/entitlement, and audit events.

## Schema Catalog

### Core Types
- **TradeState**: `INIT | WARMUP | READY | IN_TRADE | REBALANCE | HALT | SAFE_MODE`
- **ActorType**: `human | internal_agent | external_agent | system`
- **Channel**: `public | operator | agent | replay | audit`
- **StreamName**: `hlp.market.raw`, `hlp.market.normalized`, `hlp.market.watchlist`, `hlp.strategy.proposals`, `hlp.plugin.signals`, `hlp.risk.decisions`, `hlp.execution.commands`, `hlp.execution.fills`, `hlp.audit.events`, `hlp.ui.events`, `hlp.payments.events`, `hlp.commands`

### Strategy
- **StrategyProposal**: `proposalId`, `cycleId`, `summary`, `confidence` (0-1), `actions[]`, `createdBy`, `requestedMode` (SIM/LIVE)
- **StrategyAction**: `type` (ENTER/EXIT/REBALANCE/HOLD), `rationale`, `notionalUsd`, `legs[]`, slippage
- **StrategyLeg**: `symbol`, `side` (BUY/SELL), `notionalUsd`, `targetRatio?`

### Risk
- **RiskDecision**: `ALLOW | ALLOW_REDUCE_ONLY | DENY`
- **RiskDecisionResult**: decision, reasons[], correlationId, computed (gross/net exposure, drawdown%, imbalance%)

### Commands
- **OperatorCommand**: `/status`, `/positions`, `/halt`, `/resume`, `/flatten`, `/risk-policy`, `/explain`
- **CommandPolicy**: per-command `allowedActorTypes`, `requiredRoles`, `requiredCapabilities`

### WebSocket Messages
- Client → Server: `sub.add`, `sub.remove`, `cmd.exec`, `ping`
- Server → Client: `sub.ack`, `event`, `cmd.result`, `error`, `pong`

### Payment/Entitlement (x402)
- **EntitlementTier**: `tier0 | tier1 | tier2 | tier3`
- **PaymentChallenge**: challengeId, resource, tier, nonce, timestamps
- **PaymentProof**: challengeId, agentId, tier, signature, nonce, amount
- **Entitlement**: agentId, tier, capabilities[], expiresAt, quota, rateLimit
- **Tier capabilities**: tier0 (public read) → tier3 (full access + audit)

### Public API
- **PublicSnapshot**: mode, pnlPct, healthCode, driftState, positions, tape
- **FloorTapeLine**: ts, role?, level (INFO/WARN/ERROR), line

### Audit
- **AuditEvent**: id, ts, actorType, actorId, action, resource, correlationId, details, hash?

## Validation Functions
- `parseStrategyProposal(candidate)` → `{ ok, proposal }` or `{ ok: false, errors }`
- `parseCommand(candidate)` → validates operator command structure

## Schema Strictness
All schemas use `.strict()` (no extra properties). Discriminated unions for type-safe routing. Required fields explicit. Datetimes validated with `z.string().datetime()`.

## Usage
```typescript
import { parseStrategyProposal, type StrategyProposal } from '@hl/privateer-contracts'
import { PublicSnapshotSchema } from '@hl/privateer-contracts'
```

## Repository Documentation
- `AGENTS.md`: operational runbook and deployment flow.
- `README.md`: repo overview and setup commands.
- `API.md`: endpoint contracts and x402 pricing.
- `docs/SPEC.md`: architecture and behavioral invariants.
- `RUNBOOK.md`: operational recovery and day-to-day runbook.
- `SECURITY.md`: secret handling and threat model.
