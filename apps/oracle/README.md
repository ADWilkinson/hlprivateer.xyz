# oracle

3-role orchestrator (SNT / RSK / EXE) plus the HTTP API in one process.

```
hlpv2.sentiment → SNT → hlpv2.estimates → EXE → hlpv2.proposals
                                                  │
                                          outcome-risk.evaluate()
                                                  │
                                          hlpv2.decisions (ALLOW)
                                                  │
                                          OrderRouter.place()
                                                  │
                                          hlpv2.{fills,audit}
```

## Endpoints

| Method | Path                         | Auth   |
|--------|------------------------------|--------|
| GET    | `/healthz`                   | —      |
| GET    | `/metrics`                   | —      |
| GET    | `/v1/public/markets`         | —      |
| GET    | `/v1/public/floor`           | —      |
| GET    | `/v1/public/floor-tape`      | —      |
| POST   | `/v1/operator/halt`          | Bearer |
| POST   | `/v1/operator/resume`        | Bearer |

Operator routes return 401 when `ORACLE_OPERATOR_TOKEN` is unset.

## Run

```bash
bun run dev
ORACLE_REDIS_URL=redis://...   # opt-in Redis (default: in-memory bus)
ORACLE_HTTP_PORT=4100
ORACLE_FIXTURE_MARKETS=path/to/markets.json
ORACLE_OPERATOR_TOKEN=...      # enables /v1/operator/*
```

Risk knobs: `ORACLE_BANKROLL_USD`, `ORACLE_MAX_STAKE_PER_MARKET_USD`,
`ORACLE_MAX_GROSS_USD`, `ORACLE_MAX_CLUSTER_USD`, `ORACLE_MIN_EDGE_BPS`,
`ORACLE_MIN_BOOK_DEPTH_USD`, `ORACLE_KELLY_CAP`, `ORACLE_MAX_CONCURRENT_MARKETS`.
