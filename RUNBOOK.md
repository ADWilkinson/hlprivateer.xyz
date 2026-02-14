# RUNBOOK.md

Operator/ops runbook for hlprivateer.xyz.

Quick links:
- Go live checklist: `docs/GO_LIVE.md`
- API surface: `API.md`
- Smoke: `scripts/readiness/smoke.sh`
- Burn-in: `scripts/readiness/burnin.sh`
- Cloudflare DNS sync: `scripts/cloudflare/sync-dns.sh`

## 1. Services + Ports
Compose stack services:
- `hlprivateer-web` (UI on `:3000`)
- `hlprivateer-api` (REST on `:4000`, `GET /healthz`)
- `hlprivateer-ws` (WebSocket + metrics on `:4100`, `/metrics`)
- `hlprivateer-runtime` (runtime + metrics on `:9400`, `/healthz`)
- `hlprivateer-agent-runner` (internal proposals + analysis)
- `redis` (event bus)
- `postgres` (runtime persistence)

Dependencies:
- Redis: required by all application services.
- Postgres: required for LIVE mode (`DRY_RUN=false`) and required by most durable workflows.
- Cloudflare Tunnel: optional when using legacy edge ingress for `api.*` and `ws.*`.

## 2. Deploy (Home Server / Docker)
1. Provision a Linux host with:
   - Docker + Docker Compose
   - Bun 1.2+ (optional for script utilities and local wallet ops)
2. Clone repo.
3. Create env file:
   - `cp config/.env.example config/.env`
4. Start stack:
   - `npm run deploy:docker`
   - optional: set `HOST_PROJECT_PATH` to your repo root if host paths differ
5. Confirm service state:
   - `npm run compose:ps`
6. Generate a trading wallet (used by the live OMS, optionally also by x402 `payTo`):
   - `bun scripts/ops/generate-trading-wallet.ts`
   - set `HL_PRIVATE_KEY` or `HL_PRIVATE_KEY_FILE` in `config/.env`
7. Run local smoke checks:
   - `LOCAL=1 bash scripts/readiness/smoke.sh`

8. Legacy cleanup (deprecated):
   - `npm run deploy:legacy-clean` if old systemd units are still present
   - `NUKE_LEGACY=1 npm run deploy:docker:full` to force full compose takeover

## 3. Startup Checks
- Services:
  - `npm run compose:ps`
  - `npm run compose:logs`
- Local probes:
  - `curl -sf http://127.0.0.1:4000/healthz`
  - `curl -sf http://127.0.0.1:4000/v1/public/pnl` (expects `pnlPct`)
  - `curl -sf http://127.0.0.1:4100/metrics`
  - `curl -sf http://127.0.0.1:9400/healthz`
- End-to-end smoke:
  - `LOCAL=1 bash scripts/readiness/smoke.sh`

## 4. Go Live
Follow `docs/GO_LIVE.md` (Postgres, trading wallet, live gates, x402 facilitator verification, and burn-in).

## 5. Incident Response

### 5.1 Suspected strategy malfunction
1. Issue `/halt` command.
2. Confirm no new orders accepted.
3. If required, run `/flatten`.
4. Start replay session for incident window.
5. Capture root cause and corrective actions.
6. Export replay bundle via `/v1/operator/replay/export`.

### 5.2 Exchange data stale
1. Verify market feed lag metrics.
2. Confirm system enters `SAFE_MODE`.
3. Resume only after feed freshness stable for 5+ minutes.

### 5.3 Security breach suspicion
1. Halt trading.
2. Revoke operator sessions and rotate operator secrets.
3. Rotate the trading wallet (Hyperliquid key) if suspected compromised.
4. Export replay bundle from `/v1/operator/replay/export`.
5. Re-enable only after containment validation.

## 6. Key Rotation
- Operator JWT secret:
  - Rotate `JWT_SECRET` / `JWT_SECRET_FILE` (API + WS gateway must agree).
  - Restart `hlprivateer-api` and `hlprivateer-ws`.
- x402:
  - `X402_PROVIDER=mock`: rotate `X402_VERIFIER_SECRET` / `X402_VERIFIER_SECRET_FILE`.
  - `X402_PROVIDER=facilitator`: update `X402_PAYTO` (receiving address) as needed.
- Hyperliquid trading wallet:
  - Generate a new key (and shards) and update `HL_PRIVATE_KEY_FILE`.
  - Fund the new wallet on Hyperliquid before resuming.

## 7. Backup and Restore
- Postgres:
  - Nightly encrypted backup.
  - Weekly restore drill into a staging host.
  - Keep 30 daily + 12 monthly snapshots.

## 8. Live Mode Enable Checklist
- 24h sim run with zero SEV-1/SEV-2 alerts.
- Kill-switch drill passed (`/halt` and `/flatten`).
- Risk limits reviewed and recorded.
- Latest deployment hash recorded.
- LIVE requires **all**:
  - `DRY_RUN=false`
  - `ENABLE_LIVE_OMS=true`
  - `LIVE_MODE_APPROVED=true`
