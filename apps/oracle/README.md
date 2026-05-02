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

Positions and equity are read from the **`Accountant`** abstraction, not
maintained locally. `HyperliquidAccountant` is the default when
`ORACLE_HL_USER` is set; `LocalAccountant` (in-process, fill-driven) is
the dev fallback.

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
bun run dev
ORACLE_REDIS_URL=redis://...     # opt-in Redis (default: in-memory bus)
ORACLE_HTTP_PORT=4100
ORACLE_FIXTURE_MARKETS=path/to/markets.json
ORACLE_OPERATOR_TOKEN=...        # enables /v1/operator/*

# Hyperliquid-backed accountant (positions + equity from clearinghouseState):
ORACLE_HL_USER=0xYourWalletAddress
ORACLE_HL_TESTNET=1              # optional
ORACLE_HL_API_URL=...            # optional
ORACLE_HL_INFO_URL=...           # optional
ORACLE_HL_RPM=1000               # optional rate limit
ORACLE_HL_TTL_MS=4000            # optional cache TTL
ORACLE_PNL_BASELINE_USD=10000    # baseline for pnlPct
```

Risk knobs, estimation parameters, source trust, and the market filter are
all read from `config/strategy.json` (gitignored) — see the root README and
`config/strategy.template.json` for the shape. Override the path via
`STRATEGY_CONFIG_PATH`.
