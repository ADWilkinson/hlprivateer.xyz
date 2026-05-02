# oracle

The v2 orchestrator. Bundles three things that v1 split across four services:

1. **The 3-role agent crew** — Sentinel (SNT), Risk (RSK), Execution (EXE).
2. **The HTTP API** — public + agent (x402) routes.
3. **A WebSocket fanout** — for the floor UI.

The split was right for v1's perp lifecycle (concurrent OMS, agent crew, ws
fanout, auth router). Outcome trading is **event-driven and stateless per
proposal** — one signal in, one decision out, done. A single process is
simpler and cheaper to reason about.

## Roles

```
hlpv2.sentiment ──► SNT ──► hlpv2.estimates ──► EXE ──► hlpv2.proposals
                                                          │
                                                          ▼
                                                       outcome-risk.evaluate()
                                                          │
                                                  hlpv2.decisions
                                                          │ ALLOW
                                                          ▼
                                                hl-client (place order)
                                                          │
                                                  hlpv2.fills
                                                          │
                                                          ▼
                                                  hlpv2.audit (hash-chained)
```

| Role | Code | Job |
|------|------|-----|
| Sentinel  | `SNT` | Aggregate sentiment signals → `ProbabilityEstimate` per market. |
| Risk      | `RSK` | Evaluate proposals via `outcome-risk` gates. Hard-gate. |
| Execution | `EXE` | Build proposals from estimates; place ALLOW'd orders on HL. |

## Endpoints

### Free

- `GET /healthz`
- `GET /v1/public/markets` — current markets with pHat + edge (no sizes)
- `GET /v1/public/floor` — recent role tape (last N lines)

### Agent (x402, future)

- `GET /v1/agent/markets` — full market state including book depth
- `GET /v1/agent/edges` — proposals + risk decisions + audit ids

### WebSocket

- `wss://.../ws` — broadcasts `hlpv2.ui` envelopes

## Run

```bash
bun run dev               # in-memory bus + fixture market provider, DRY_RUN
ORACLE_REDIS_URL=...      # opt-in Redis bus
ORACLE_HTTP_PORT=4100
ORACLE_DRY_RUN=true       # default; set false to actually place orders
ORACLE_FIXTURE_MARKETS=path/to/markets.json
```

## Audit

Every proposal/decision/fill is appended to `hlpv2.audit` as a hash-chained
envelope. Each entry's `payload.prevHash` is the SHA-256 of the previous
entry's serialized envelope, so any in-flight tamper is detectable on replay.
