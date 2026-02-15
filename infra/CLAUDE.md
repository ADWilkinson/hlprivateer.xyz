# Infrastructure - Development Context

## Overview
Production deployment artifacts for Docker, systemd, Cloudflare Tunnel, and observability.

## Directory Structure
```
infra/
├── systemd/          # 6 systemd service units for bare-metal deployment
├── cloudflared/      # Cloudflare Tunnel ingress config
├── docker/           # Multi-stage Dockerfile for container builds
└── observability/    # OTel + Prometheus + Loki + Grafana stack
```

## systemd Units
6 services under user `hlprivateer`, working dir `/opt/hlprivateer.xyz`:
- **hlprivateer-runtime** - Trading runtime (after postgres, redis)
- **hlprivateer-api** - REST API (after postgres, redis)
- **hlprivateer-ws** - WebSocket gateway (after redis)
- **hlprivateer-agent-runner** - LLM agent (after redis)
- **hlprivateer-web** - Next.js frontend (requires api, runtime, ws)
- **hlprivateer-cloudflared** - Tunnel ingress (after web, api, ws)

**Common hardening**: `NoNewPrivileges`, `PrivateUsers`, `PrivateDevices`, `ProtectSystem=strict`, `SystemCallFilter=@system-service`. Restart on failure with exponential backoff. Secrets via `LoadCredential=` from `/etc/hlprivateer/credentials/`.

## Cloudflare Tunnel (`cloudflared/config.yml.example`)
```yaml
ingress:
  - hostname: api.hlprivateer.xyz  → http://127.0.0.1:4000
  - hostname: ws.hlprivateer.xyz   → http://127.0.0.1:4100
  - service: http_status:404
```
Web UI on Cloudflare Pages (apex + www).

## Docker (`docker/Dockerfile`)
Multi-stage build on `oven/bun:1.2.19`. Builder stage: install + build all workspaces. Runtime stage: dynamic CMD routes to app via `$APP` env var (`api`, `runtime`, `ws-gateway`, `agent-runner`, `web`). Runs as `bun` user (non-root).

## Docker Compose (`docker-compose.yml`)
7 services: redis (7-alpine), postgres (16-alpine), api (:4000), ws (:4100), runtime (:9400), agent-runner, web (:3000). Postgres init with `0001_init.sql`. Agent-runner mounts `~/.claude` for CLI auth. YAML anchors for shared build/env/health config.

## Observability (`observability/`)
Separate compose stack (all `network_mode: host`):
- **otel-collector** (:4317 OTLP → :8889 Prometheus exporter)
- **prometheus** (:9090) - Scrapes api:4000, runtime:9400, ws:4100, otel:8889
- **loki** (:3100) - Log aggregation
- **promtail** - Scrapes `/var/log/hlprivateer/*.log`
- **grafana** (:3000, admin/admin) - Dashboards for runtime cycles, risk decisions, WS connections

**Alert rules**: `hlp_stale_market_data` (>5s for 2m, critical), `hlp_risk_denied_excess` (>5%/5m rate, warning).
