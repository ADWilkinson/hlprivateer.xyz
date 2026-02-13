# Go Live (Hyperliquid Mainnet + x402 + Postgres)

This page is the operational checklist to run HL Privateer in **LIVE** mode (real order placement on Hyperliquid).

If you are just developing locally, use `DRY_RUN=true` and follow `README.md` instead.

## 0) Preconditions
- Cloudflare is already serving:
  - UI via Pages: `https://hlprivateer.xyz`
  - API via Tunnel: `https://api.hlprivateer.xyz`
  - WS via Tunnel: `wss://ws.hlprivateer.xyz`
- Redis is running and reachable from the services (`REDIS_URL`).
- You understand the operator commands: `/halt`, `/resume`, `/flatten`.

## 1) Create A Trading Wallet (EVM key)
HL uses an EVM private key for signing. This project stores secrets via the `*_FILE` pattern (never commit keys).

Generate a new trading wallet + XOR shards:
```bash
cd /home/dappnode/projects/hlprivateer.xyz
bun scripts/ops/generate-trading-wallet.ts
```

This creates (mode `600`) files under `secrets/`:
- `secrets/hl_trading_private_key` (the `0x...` private key, newline terminated)
- `secrets/hl_trading_private_key.shard1.hex`
- `secrets/hl_trading_private_key.shard2.hex`
- `secrets/hl_trading_address.txt` (public address)

Notes:
- The shards are **2-of-2 XOR** (you need both to reconstruct the key).
- Store the shards separately/offline.

## 2) Start Postgres (required for LIVE)
In LIVE (`DRY_RUN=false`), Postgres is a hard dependency (audit + state must be durable).

Bootstrap the local Postgres container + apply migrations:
```bash
cd /home/dappnode/projects/hlprivateer.xyz
bash scripts/ops/bootstrap-postgres.sh
```

This will:
- Start `hlprivateer-postgres` (docker) bound to `127.0.0.1:5432`.
- Create `secrets/hl_postgres_database_url` (mode `600`).
- Apply `apps/runtime/migrations/0001_init.sql` (idempotent).

## 3) Configure LIVE + x402 (config/.env)
Edit `config/.env` to point at secret files and enable LIVE:
```bash
cd /home/dappnode/projects/hlprivateer.xyz

# Core secret file refs
rg -n \"^(HL_PRIVATE_KEY|DATABASE_URL)_FILE=\" -S config/.env || true

# Example values (adjust paths if your deploy dir differs):
# HL_PRIVATE_KEY_FILE=/home/dappnode/projects/hlprivateer.xyz/secrets/hl_trading_private_key
# DATABASE_URL_FILE=/home/dappnode/projects/hlprivateer.xyz/secrets/hl_postgres_database_url
#
# DRY_RUN=false
# ENABLE_LIVE_OMS=true
# LIVE_MODE_APPROVED=true
```

x402 facilitator mode (paid agent endpoints):
- Set:
  - `X402_ENABLED=true`
  - `X402_PROVIDER=facilitator`
  - `X402_FACILITATOR_URL=https://facilitator.payai.network` (or another supported facilitator)
  - `X402_NETWORK=eip155:8453` (Base mainnet)
  - `X402_PAYTO=<YOUR_RECEIVING_ADDRESS>` (can be the same as the trading wallet)

Tip: verify facilitator network support:
```bash
curl -fsS https://facilitator.payai.network/supported | head -c 400 && echo
```

## 4) Build + Restart Services
```bash
cd /home/dappnode/projects/hlprivateer.xyz
bun install
bun run build
sudo systemctl restart hlprivateer-api hlprivateer-ws hlprivateer-runtime hlprivateer-agent-runner
```

Run the local+public smoke:
```bash
cd /home/dappnode/projects/hlprivateer.xyz
LOCAL=1 bash scripts/readiness/smoke.sh
```

## 5) Fund The Trading Wallet On Hyperliquid
Deposit funds (margin) for the address in `secrets/hl_trading_address.txt`.

Until the wallet is funded, keep the runtime halted (`/halt`).

## 6) Resume Trading (Operator)
When funded and ready, issue `/resume` via:
- `POST /v1/operator/command` (see `API.md`), or
- WS gateway `cmd.exec` as an operator (see `API.md`)

If anything looks wrong:
- `/halt` immediately
- `/flatten` to go flat (closes positions)

## 7) Verify x402 End-to-End
Use the facilitator demo client (payer key is separate from the trading wallet):
```bash
cd /home/dappnode/projects/hlprivateer.xyz

# Requires an EVM private key funded for x402 payments on the selected network.
X402_PAYER_PRIVATE_KEY=0x... \\
API_BASE_URL=https://api.hlprivateer.xyz \\
X402_ROUTE=/v1/agent/analysis/latest \\
bun scripts/x402/facilitator-demo.ts
```

Expected:
- First request returns `402` + `PAYMENT-REQUIRED`.
- Second request returns `200` + `PAYMENT-RESPONSE`.

## 8) 24h Burn-In (public E2E)
The burn-in repeatedly runs `scripts/readiness/smoke.sh` for 24h to catch DNS/TLS/tunnel flaps.

Start it as a transient systemd unit:
```bash
cd /home/dappnode/projects/hlprivateer.xyz
TS=$(date -u +%Y%m%dT%H%M%SZ)
sudo systemd-run --unit=hlprivateer-burnin --collect \\
  --property=WorkingDirectory=/home/dappnode/projects/hlprivateer.xyz \\
  --property=User=dappnode --property=Group=dappnode \\
  --setenv=OUT=burnin-${TS}.log --setenv=LOCAL=1 \\
  /bin/bash scripts/readiness/burnin.sh
```

Monitor:
```bash
systemctl status hlprivateer-burnin.service
tail -f burnin-*.log
```
