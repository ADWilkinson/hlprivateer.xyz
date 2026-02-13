# RUNBOOK.md

## 1. Deploy (home server)
1. Provision Linux host with Docker optional, systemd required, Node.js 22, Postgres, Redis, cloudflared.
2. Clone repo to `/opt/hlprivateer.xyz`.
3. Create env file:
   - `cp config/.env.example config/.env`
4. Install deps and build:
   - `pnpm install && pnpm build`
5. Place decrypted runtime secrets in `/etc/hlprivateer/keys` with `chmod 600`.
6. Install systemd units from `infra/systemd/`.
7. Configure cloudflared from `infra/cloudflared/config.yml.example`.
8. Start services:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now hlprivateer-api hlprivateer-runtime hlprivateer-ws hlprivateer-web hlprivateer-cloudflared`

## 2. Startup checks
- `systemctl status` all services green.
- `/v1/public/pnl` returns valid payload.
- Operator login works.
- Runtime state transitions `INIT -> WARMUP -> READY`.
- Risk engine heartbeat present.

## 3. Key rotation
1. Generate new key pair (JWT/x402/hyperliquid as needed).
2. Update encrypted config refs.
3. Restart impacted services with rolling order: `api -> ws -> runtime`.
4. Verify signatures and auth flows.
5. Record rotation event in audit log.

## 4. Incident response

### 4.1 Suspected strategy malfunction
1. Issue `/halt` command.
2. Confirm no new orders accepted.
3. If required, run `/flatten`.
4. Start replay session for incident window.
5. Capture root cause and corrective actions.

### 4.2 Exchange data stale
1. Verify market feed lag metrics.
2. Confirm system enters `SAFE_MODE`.
3. Check fallback poll path.
4. Resume only after feed freshness stable for 5+ minutes.

### 4.3 Security breach suspicion
1. Halt trading.
2. Revoke operator sessions and external API keys.
3. Rotate signing and trading keys.
4. Export audit timeline.
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
