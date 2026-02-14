#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

ROOT_DIR="${DEPLOY_ROOT:-/opt/hlprivateer.xyz}"
REPO_BRANCH="${DEPLOY_BRANCH:-main}"
SYSTEMD_SOURCE_DIR="${SYSTEMD_SOURCE_DIR:-infra/systemd}"
RUN_LOCAL_SMOKE="${RUN_LOCAL_SMOKE:-1}"
RESTART_WEB_SERVICE="${RESTART_WEB_SERVICE:-1}"
RESTART_CLOUDFLARED="${RESTART_CLOUDFLARED:-1}"
SKIP_GIT_FETCH="${SKIP_GIT_FETCH:-0}"
SKIP_GIT_RESET="${SKIP_GIT_RESET:-0}"

require_cmd bun
require_cmd git
require_cmd sudo
require_cmd systemctl

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "deploy root not found: $ROOT_DIR" >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/$SYSTEMD_SOURCE_DIR" ]]; then
  echo "systemd source dir not found: $ROOT_DIR/$SYSTEMD_SOURCE_DIR" >&2
  exit 1
fi

log "deploy root: $ROOT_DIR"
log "branch: $REPO_BRANCH"

cd "$ROOT_DIR"

log "fetching git updates"
if [[ "$SKIP_GIT_FETCH" == "1" ]]; then
  log "SKIP_GIT_FETCH=1, skipping git fetch"
else
  git fetch origin
  log "fetch complete"
fi

if [[ "$SKIP_GIT_RESET" == "1" ]]; then
  log "SKIP_GIT_RESET=1, skipping branch checkout/reset"
else
  git checkout "$REPO_BRANCH"
  git reset --hard "origin/$REPO_BRANCH"
  log "checked out/reset $REPO_BRANCH from origin"
fi

log "installing dependencies"
bun install

log "building all workspace packages"
bun run build

log "installing systemd units"
sudo cp "$SYSTEMD_SOURCE_DIR"/hlprivateer-*.service /etc/systemd/system/
sudo systemctl daemon-reload

SERVICES=(
  hlprivateer-runtime
  hlprivateer-api
  hlprivateer-ws
  hlprivateer-agent-runner
)

if [[ "$RESTART_WEB_SERVICE" == "1" ]]; then
  SERVICES+=(hlprivateer-web)
fi

if [[ "$RESTART_CLOUDFLARED" == "1" ]]; then
  SERVICES+=(hlprivateer-cloudflared)
fi

log "restarting services: ${SERVICES[*]}"
for service in "${SERVICES[@]}"; do
  if systemctl list-unit-files "${service}.service" --no-legend >/dev/null 2>&1; then
    sudo systemctl restart "${service}.service"
  else
    log "warning: ${service}.service not found, skipping"
  fi
done

if (( ${#SERVICES[@]} > 0 )); then
  log "waiting for restart settle"
  sleep 2
fi

log "service status"
for service in "${SERVICES[@]}"; do
  sudo systemctl status "${service}.service" --no-pager --lines=2 || true
done

if [[ "$RUN_LOCAL_SMOKE" == "1" ]]; then
  log "running local smoke checks"
  export LOCAL=1
  export PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:3000}"
  export API_URL="${API_URL:-http://127.0.0.1:4000}"
  export WS_URL="${WS_URL:-ws://127.0.0.1:4100}"
  export WS_METRICS_URL="${WS_METRICS_URL:-http://127.0.0.1:4100/metrics}"
  export ORIGIN="${ORIGIN:-http://127.0.0.1:3000}"
  bash scripts/readiness/smoke.sh
fi

log "deploy complete"
