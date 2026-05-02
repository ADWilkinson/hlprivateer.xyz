# outcome-risk

Pure, deterministic, **fail-closed** risk gates for v2 outcome-market trading.
No I/O. Caller assembles a `RiskContext` snapshot; the engine returns a
`RiskDecision` with structured failures.

Any failed gate = `DENY`. Single-failure short-circuit is intentional — gates
are ordered cheapest-first.

## Gate order

1. `OPERATOR_HALT`
2. `INVALID_PROPOSAL`
3. `STALE_SENTIMENT`
4. `MARKET_NOT_TRADING`
5. `RESOLUTION_TOO_SOON`
6. `RESOLUTION_TOO_FAR`
7. `CHALLENGE_WINDOW_OPEN`
8. `EDGE_TOO_THIN`
9. `STAKE_PER_MARKET`
10. `CONCURRENT_MARKETS`
11. `CORRELATED_EXPOSURE`
12. `BANKROLL_DEPLETED`
13. `LOW_LIQUIDITY`
