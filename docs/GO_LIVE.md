# Go Live (Hyperliquid Mainnet + x402 + Postgres)

This page is the operational checklist to run HL Privateer in **LIVE** mode (real order placement on Hyperliquid).

If you are just developing locally, use `DRY_RUN=true` and follow `README.md` instead.

## 0) Preconditions
- If you use Cloudflare ingress, confirm DNS/TLS and tunnel endpoints are already updated.
- Docker Compose stack is reachable for trading endpoints:
  - UI: `http://<host>:3000`
  - API: `http://<host>:4000`
  - WS: `ws://<host>:4100`
- Redis and Postgres are managed by Compose services.
- You understand the operator commands: `/halt`, `/resume`, `/flatten`.

## 1) Create A Trading Wallet (EVM key)
HL uses an EVM private key for signing. This project stores secrets via the `*_FILE` pattern (never commit keys).

Generate a new trading wallet + XOR shards:
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
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

Bootstrap the local Postgres container + apply migrations (if Postgres is not yet provisioned):
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
docker compose -f infra/docker-compose.yml --env-file config/.env up -d postgres
```

This will:
- Start `postgres` service and run migration `apps/runtime/migrations/0001_init.sql` from the compose-mounted file on first init.
- Create `secrets/hl_postgres_database_url` (mode `600`).
- Use `DATABASE_URL_FILE` or `DATABASE_URL` to point runtime at the database.

## 3) Configure LIVE + x402 (config/.env)
Edit `config/.env` to point at secret files and enable LIVE:
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Core secret file refs
rg -n \"^(HL_PRIVATE_KEY|DATABASE_URL)_FILE=\" -S config/.env || true

# Example values (adjust paths if your deploy dir differs):
# HL_PRIVATE_KEY_FILE=/opt/hlprivateer.xyz/secrets/hl_trading_private_key
# DATABASE_URL_FILE=/opt/hlprivateer.xyz/secrets/hl_postgres_database_url
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
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
npm run deploy:docker
```

Run the local+public smoke:
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
LOCAL=1 bash scripts/readiness/smoke.sh
```

## 5) Fund The Trading Wallet On Hyperliquid
Fund the trading wallet for the address in `secrets/hl_trading_address.txt`.

Until the wallet is funded, keep the runtime halted (`/halt`).

Hyperliquid supports different account abstraction modes (default is **unified account**). In unified mode, perps collateral lives in the **spot clearinghouse** and class transfers are disabled.

Check the current abstraction mode:
```bash
curl -sS -X POST https://api.hyperliquid.xyz/info \\
  -H 'content-type: application/json' \\
  -d '{\"type\":\"userAbstraction\",\"user\":\"<WALLET_ADDRESS>\"}'
```

If this returns `"unifiedAccount"` (most common):
- Fund the wallet with USDC (Spot). The runtime uses Spot USDC as `accountValueUsd` for funding gates.
- `usdClassTransfer` is disabled by Hyperliquid in this mode.

If this returns `"disabled"` (non-unified / legacy mode):
- Fund Spot USDC, then transfer Spot -> Perp using `usdClassTransfer`:
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
set -a; source config/.env; set +a

# Example: move $1000 from Spot -> Perp (only works when abstraction mode is disabled)
bun x tsx scripts/ops/usd-class-transfer.ts --amount 1000 --toPerp true
```

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
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

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

Run it as a background process and capture logs:
```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
TS=$(date -u +%Y%m%dT%H%M%SZ)
nohup bash scripts/readiness/burnin.sh LOCAL=1 > "burnin-${TS}.log" 2>&1 &
```

Monitor:
```bash
tail -f burnin-*.log
```
