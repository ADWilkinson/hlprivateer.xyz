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

Positions and equity are read from `HyperliquidAccountant` (Hyperliquid's
`clearinghouseState`, TTL-cached). No local-source-of-truth, no fallback.

Markets and the order router are operator-owned: copy
`apps/oracle/wiring.template.ts` to `apps/oracle/wiring.ts` (gitignored)
and implement `makeMarketProvider` + `makeOrderRouter` against HL HIP-4.
Oracle main refuses to start without that file.

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

`/healthz` and `/metrics` include equity and open-market count from the
accountant. `/v1/public/floor.pnlPct` is `(equity − baseline)/baseline`
when `ORACLE_PNL_BASELINE_USD` is set.

Operator routes return 401 when `ORACLE_OPERATOR_TOKEN` is unset.

## Run

```bash
ORACLE_HL_USER=0xYourWalletAddress     # required
ORACLE_OPERATOR_TOKEN=...              # required to enable /v1/operator/*
bun run dev                            # reads apps/oracle/wiring.ts

# Optional:
ORACLE_REDIS_URL=redis://...           # opt-in Redis (default: in-memory bus)
ORACLE_HTTP_PORT=4100
ORACLE_HL_TESTNET=1
ORACLE_HL_API_URL=...
ORACLE_HL_INFO_URL=...
ORACLE_HL_RPM=1000
ORACLE_HL_TTL_MS=4000
ORACLE_PNL_BASELINE_USD=10000
ORACLE_WIRING=path/to/wiring.ts        # override default wiring path
```

Risk knobs, estimation parameters, source trust, and the market filter are
all read from `config/strategy.json` (gitignored) — see the root README and
`config/strategy.template.json` for the shape. Override the path via
`STRATEGY_CONFIG_PATH`.
