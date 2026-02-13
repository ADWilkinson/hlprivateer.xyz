# RUNBOOK.md

## 1. Deploy (home server)
1. Provision Linux host with Docker optional, systemd required, Node.js 22, Postgres, Redis, cloudflared.
2. Clone repo to `/opt/hlprivateer.xyz`.
3. Create env file:
   - `cp config/.env.example config/.env`
   - fill non-secret placeholders (hostname, ports, risk caps)
4. Manage secrets with SOPS + age:
   - `cp config/secrets.prod.example.yaml config/secrets.prod.plain.yaml`
   - populate secret values
   - `SOPS_AGE_RECIPIENT=<age recipient> bun run secrets:rotate`
   - `bun run secrets:decrypt`
   - verify `/etc/hlprivateer/credentials/hlprivateer.env` mode is `600`
5. Install deps and build:
   - `bun install && bun run build`
6. Install systemd units from `infra/systemd/`:
   - `cp infra/systemd/hlprivateer-*.service /etc/systemd/system/`
   - `sudo systemctl daemon-reload`
7. Configure cloudflared:
   - copy `infra/cloudflared/config.yml.example` to `/etc/cloudflared/config.yml`
   - place tunnel credential at `/etc/cloudflared/hlprivateer.json` with `chmod 600`
   - confirm `config.yml` points `credentials-file` to `/run/credentials/hlprivateer-cloudflared.service/cloudflared-tunnel`
8. Start services:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now hlprivateer-api hlprivateer-runtime hlprivateer-ws hlprivateer-cloudflared`
   - optional Firebase-hosted web: skip `hlprivateer-web` and deploy with
     `bun run deploy:web:firebase`

## 2. Startup checks
- `systemctl status` all services green.
- `GET /v1/public/pnl` returns valid payload.
- Operator login works.
- Runtime state transitions `INIT -> WARMUP -> READY`.
- Risk engine heartbeat present.
- `/v1/operator/replay?from=<ISO>&to=<ISO>` returns audit timeline payload.
- `systemctl status hlprivateer-api hlprivateer-runtime hlprivateer-ws hlprivateer-web hlprivateer-cloudflared` are active.
- `sudo journalctl -u hlprivateer-api -n 50 --no-pager` shows service logs and no startup secret errors.
- `curl -sf http://127.0.0.1:4000/v1/public/pnl` returns JSON with `pnlPercent`.
- `curl -sf http://127.0.0.1:3000` serves the ASCII floor page (self-hosted mode).
- if using Firebase hosting, verify `https://<firebase-site>.web.app` serves `/` and API calls target `API_BASE_URL`.
- `curl -sf http://127.0.0.1:4100/metrics` returns websocket gateway metrics.
- `curl -sf http://127.0.0.1:9400/metrics` exposes runtime scrape metrics.
- Verify tunnel route checks:
  - `sudo systemctl status hlprivateer-cloudflared`
  - `curl -sf https://api.hlprivateer.xyz/v1/public/pnl`
  - `curl -sf https://ws.hlprivateer.xyz/metrics`

## 3. Key rotation
1. Generate new key pair (JWT/x402/hyperliquid as needed).
2. Update encrypted config refs.
3. Update encrypted reference files:
   - `cp config/secrets.prod.example.yaml config/secrets.prod.plain.yaml`
   - rotate and decrypt:
   - `SOPS_AGE_RECIPIENT=<age recipient> bun run secrets:rotate`
   - `bun run secrets:decrypt`
4. Copy any cloudflared credential updates to `/etc/cloudflared/hlprivateer.json`.
5. Restart impacted services with rolling order: `api -> ws -> runtime`.
6. Verify signatures and auth flows.
7. Record rotation event in audit log.

## 4. Incident response

### 4.1 Suspected strategy malfunction
1. Issue `/halt` command.
2. Confirm no new orders accepted.
3. If required, run `/flatten`.
4. Start replay session for incident window.
5. Capture root cause and corrective actions.
6. Export replay bundle via `/v1/operator/replay/export`.

### 4.2 Exchange data stale
1. Verify market feed lag metrics.
2. Confirm system enters `SAFE_MODE`.
3. Check fallback poll path.
4. Resume only after feed freshness stable for 5+ minutes.

### 4.3 Security breach suspicion
1. Halt trading.
2. Revoke operator sessions and external API keys.
3. Rotate signing and trading keys.
4. Export replay bundle from `/v1/operator/replay/export`.
5. Re-enable only after containment validation.

## 5. Backup and restore
- Nightly encrypted Postgres backup.
- Weekly restore drill into staging host.
- Keep 30 daily + 12 monthly snapshots.

## 6. Live mode enable checklist
- 24h sim run with zero SEV-1/SEV-2 alerts.
- Kill-switch drill passed.
- Risk limits reviewed and signed by operator.
- Latest deployment hash recorded.
- `ENABLE_LIVE_OMS=true` is set only together with explicit `LIVE_MODE_APPROVED=true`.
