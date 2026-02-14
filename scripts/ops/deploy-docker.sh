#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"
}

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-config/.env}"
COMMAND="${1:-up}"
LEGACY_SERVICES=(
  hlprivateer-runtime
  hlprivateer-api
  hlprivateer-ws
  hlprivateer-agent-runner
  hlprivateer-web
  hlprivateer-cloudflared
)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1" >&2
    exit 1
  fi
}

nuke_legacy_systemd() {
  if [[ "${NUKE_LEGACY:-0}" != "1" ]]; then
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "NUKE_LEGACY=1 requires sudo, but sudo not found" >&2
    return 1
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    echo "NUKE_LEGACY=1 requires systemctl, but systemctl not found" >&2
    return 1
  fi

  log "NUKE_LEGACY=1: disabling/removing legacy systemd units"
  for service in "${LEGACY_SERVICES[@]}"; do
    if systemctl list-unit-files "${service}.service" --no-legend --no-pager | grep -q "^${service}\.service"; then
      sudo systemctl stop "${service}.service" || true
      sudo systemctl disable "${service}.service" || true
    fi
    sudo rm -f "/etc/systemd/system/${service}.service"
  done
  sudo systemctl daemon-reload
}

require_cmd docker

if [[ ! -f "$ROOT_DIR/$COMPOSE_FILE" ]]; then
  echo "compose file not found: $ROOT_DIR/$COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/$ENV_FILE" ]]; then
  echo "env file not found: $ROOT_DIR/$ENV_FILE" >&2
  echo "copy config/.env.example to config/.env and update values" >&2
  exit 1
fi

COMPOSE=(docker compose -f "$ROOT_DIR/$COMPOSE_FILE" --env-file "$ROOT_DIR/$ENV_FILE")

cd "$ROOT_DIR"

case "$COMMAND" in
  up|deploy)
    log "starting compose stack: $ROOT_DIR/$COMPOSE_FILE"

    nuke_legacy_systemd || true

    if [[ "${NUKE_ON_START:-0}" == "1" ]]; then
      log "NUKE_ON_START=1, tearing down existing stack before restart"
      "${COMPOSE[@]}" down --remove-orphans
    fi

    "${COMPOSE[@]}" up -d --build --remove-orphans
    "${COMPOSE[@]}" ps

    if [[ "${RUN_SMOKE:-1}" == "1" ]]; then
      log "running local smoke checks"
      export LOCAL=1
      export PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:3000}"
      export API_URL="${API_URL:-http://127.0.0.1:4000}"
      export WS_URL="${WS_URL:-ws://127.0.0.1:4100}"
      export WS_METRICS_URL="${WS_METRICS_URL:-http://127.0.0.1:4100/metrics}"
      export ORIGIN="${ORIGIN:-http://127.0.0.1:3000}"
      bash scripts/readiness/smoke.sh
    fi
    ;;
  legacy-clean)
    log "removing legacy systemd units without starting compose"
    NUKE_LEGACY=1
    nuke_legacy_systemd
    ;;
  down)
    log "stopping compose stack: $ROOT_DIR/$COMPOSE_FILE"
    "${COMPOSE[@]}" down --remove-orphans "${DOWN_VOLUMES:+--volumes}"
    ;;
  logs)
    shift || true
    log "tailing logs: $*"
    "${COMPOSE[@]}" logs -f "$@"
    ;;
  ps)
    "${COMPOSE[@]}" ps
    ;;
  restart)
    shift || true
    log "restarting services: $*"
    "${COMPOSE[@]}" restart "$@"
    ;;
  *)
    cat <<EOF
Usage:
  bash scripts/ops/deploy-docker.sh up|deploy   # build + start all services (default)
  bash scripts/ops/deploy-docker.sh down       # stop and remove containers
  bash scripts/ops/deploy-docker.sh legacy-clean # remove legacy systemd units
  bash scripts/ops/deploy-docker.sh restart [svc...]
  bash scripts/ops/deploy-docker.sh logs [svc...]
  bash scripts/ops/deploy-docker.sh ps

Env:
  COMPOSE_FILE  path to compose file (default: infra/docker-compose.yml)
  ENV_FILE      env file passed as compose substitutions (default: config/.env)
  NUKE_ON_START set to 1 to down before up
  NUKE_LEGACY set to 1 to disable/remove legacy systemd units
  RUN_SMOKE     run local smoke checks after up (default: 1)
EOF
    exit 1
    ;;
esac
