# RUNBOOK.md

Operator/ops runbook for hlprivateer.xyz.

Quick links:
- Go live checklist: `docs/GO_LIVE.md`
- API surface: `API.md`
- Smoke: `scripts/readiness/smoke.sh`
- Burn-in: `scripts/readiness/burnin.sh`
- Cloudflare DNS sync: `scripts/cloudflare/sync-dns.sh`

## 1. Services + Ports
Reference systemd units:
- `hlprivateer-api.service` (REST on `:4000`)
- `hlprivateer-ws.service` (WS on `:4100`)
- `hlprivateer-runtime.service` (metrics on `:9400`)
- `hlprivateer-agent-runner.service` (internal proposals + analysis)

Dependencies:
- Redis: required (event bus).
- Postgres: optional when `DRY_RUN=true`; required when `DRY_RUN=false` (LIVE readiness).
- Cloudflare Tunnel: required for public `api.*` and `ws.*` hostnames.

## 2. Deploy (Home Server / Reference)
1. Provision a Linux host with:
   - Bun 1.2+
   - systemd
   - Docker (used for Redis/Postgres in the reference setup)
   - cloudflared (tunnel)
2. Clone repo.
3. Create env file:
   - `cp config/.env.example config/.env`
4. Start Redis (or point `REDIS_URL` at an existing instance):
   - `docker run -d --name hlprivateer-redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7-alpine`
5. Bootstrap Postgres + migrations (required for LIVE):
   - `bash scripts/ops/bootstrap-postgres.sh`
   - set `DATABASE_URL_FILE=.../secrets/hl_postgres_database_url` in `config/.env`
6. Generate a trading wallet (used by the live OMS, optionally also by x402 `payTo`):
   - `bun scripts/ops/generate-trading-wallet.ts`
   - set `HL_PRIVATE_KEY_FILE=.../secrets/hl_trading_private_key` in `config/.env`
7. Build:
   - `bun install && bun run build`
8. Install/enable systemd units:
   - Copy your preferred unit set into `/etc/systemd/system/` and `sudo systemctl daemon-reload`.
   - This repo includes hardened reference units under `infra/systemd/` (separate user + systemd credentials),
     but a simpler local unit set is also acceptable for a home server.
9. Configure Cloudflare Tunnel (cloudflared):
   - Ensure tunnel ingress routes:
     - `api.hlprivateer.xyz -> http://127.0.0.1:4000`
     - `ws.hlprivateer.xyz -> http://127.0.0.1:4100`
10. Sync Cloudflare DNS:
   - `CF_API_TOKEN=<token with Zone:DNS:Edit> bash scripts/cloudflare/sync-dns.sh hlprivateer.xyz`
11. Deploy web UI to Cloudflare Pages:
   - `bun run deploy:web:cloudflare`
12. Start services:
   - `sudo systemctl enable --now hlprivateer-api hlprivateer-runtime hlprivateer-ws hlprivateer-agent-runner`

## 3. Startup Checks
- Services:
  - `systemctl status hlprivateer-api hlprivateer-runtime hlprivateer-ws hlprivateer-agent-runner`
  - `journalctl -u hlprivateer-runtime -n 50 --no-pager`
- Local probes:
  - `curl -sf http://127.0.0.1:4000/healthz`
  - `curl -sf http://127.0.0.1:4000/v1/public/pnl` (expects `pnlPct`)
  - `curl -sf http://127.0.0.1:4100/metrics`
  - `curl -sf http://127.0.0.1:9400/healthz`
- Public probes:
  - `curl -sf https://hlprivateer.xyz/ >/dev/null`
  - `curl -sf https://api.hlprivateer.xyz/v1/public/pnl`
  - `curl -sf https://ws.hlprivateer.xyz/metrics >/dev/null`
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
