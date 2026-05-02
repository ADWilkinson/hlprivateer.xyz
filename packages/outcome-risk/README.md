# outcome-risk

Pure fail-closed gates. Caller assembles a `RiskContext`; `evaluate()` returns
a `RiskDecision`. Single-failure short-circuit, gates ordered cheapest-first:

`OPERATOR_HALT` → `INVALID_PROPOSAL` → `PROPOSAL_EXPIRED` → `STALE_SENTIMENT` →
`MARKET_NOT_TRADING` → `RESOLUTION_TOO_SOON` → `RESOLUTION_TOO_FAR` →
`CHALLENGE_WINDOW_OPEN` → `EDGE_TOO_THIN` → `STAKE_PER_MARKET` →
`CONCURRENT_MARKETS` → `CORRELATED_EXPOSURE` → `BANKROLL_DEPLETED` →
`LOW_LIQUIDITY`.
