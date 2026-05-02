# outcome-risk

Pure fail-closed gates. Caller assembles a `RiskContext` snapshot;
`evaluate(ctx)` returns a `RiskDecision`. Single-failure short-circuit;
gates ordered cheapest-first; any failure → `DENY`.

```
OPERATOR_HALT
INVALID_PROPOSAL
PROPOSAL_EXPIRED
STALE_SENTIMENT
MARKET_NOT_TRADING
RESOLUTION_TOO_SOON
RESOLUTION_TOO_FAR
CHALLENGE_WINDOW_OPEN
EDGE_TOO_THIN
STAKE_PER_MARKET
CONCURRENT_MARKETS
CORRELATED_EXPOSURE
BANKROLL_DEPLETED
LOW_LIQUIDITY
```

`RiskContext` carries the proposal, estimate, market, config, recent
signals, and current exposure metrics from the `Accountant`. Reasons on
each `RiskGateFailure` include `observed` and `threshold` so audit trails
are debuggable.

19 vitest cases cover each gate plus the short-circuit semantics.
