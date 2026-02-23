# Risk Engine - Development Context

## Overview
Deterministic risk evaluation engine. Pure function library with zero runtime dependencies (only Zod). Evaluates strategy proposals against a configured risk policy and returns ALLOW, ALLOW_REDUCE_ONLY, or DENY with detailed reasons.

**Design principle**: Fail-closed. Any critical check failure → DENY.

## Key Files
```
src/
├── index.ts           # evaluateRisk(), all check functions
└── index.test.ts      # Vitest unit tests
```

## Risk Checks (Sequential, All Run Unconditionally)
1. **DEPENDENCY_FAILURE**: `!dependenciesHealthy && failClosedOnDependencyError`
2. **SYSTEM_GATED**: state === HALT
3. **ACTOR_NOT_ALLOWED**: external_agent blocked
4. **INVALID_PROPOSAL**: no actionable orders
5. **SLIPPAGE_BREACH**: max slippage > `maxSlippageBps`
6. **LEVERAGE**: gross/accountValue > `maxLeverage`
7. **DRAWDOWN**: projected drawdown% > `maxDrawdownPct`
8. **EXPOSURE**: gross > `maxExposureUsd`
9. **LIQUIDITY**: order notional * buffer > L2 book depth
10. **SAFE_MODE**: would increase gross notional
11. **STALE_DATA**: tick age > `staleDataMs`

## Decision Logic
```
has blockers → DENY
state === SAFE_MODE (no blockers) → ALLOW_REDUCE_ONLY
else → ALLOW
```

## Configuration
```typescript
interface RiskConfig {
  maxLeverage: number              // Default 2
  maxDrawdownPct: number           // Default 5
  maxExposureUsd: number           // Default 10000
  maxSlippageBps: number           // Default 20
  staleDataMs: number              // Default 3000
  liquidityBufferPct: number       // Default 1.1
  failClosedOnDependencyError: boolean
}
```

## Exposure Calculations
- **Gross**: sum of absolute notional (|long| + |short|)
- **Net**: signed sum (longs - shorts)
- **Projected drawdown**: |net| / gross * 100

## Invariants
- Pure functions, no side effects, no I/O
- Deterministic: same inputs → same output
- Zero runtime deps (Zod for dev-time types only)

## Integration
Consumed by `apps/runtime` (`orchestrator/state.ts`) in main runtime loop. No other consumers.

## Repository Documentation
- `AGENTS.md`: operational runbook and deployment flow.
- `README.md`: repo overview and setup commands.
- `API.md`: endpoint contracts and x402 pricing.
- `docs/SPEC.md`: architecture and behavioral invariants.
- `RUNBOOK.md`: operational recovery and day-to-day runbook.
- `SECURITY.md`: secret handling and threat model.
