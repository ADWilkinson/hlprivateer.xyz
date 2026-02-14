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
VERIFY_SERVICE_ENV_FILES="${VERIFY_SERVICE_ENV_FILES:-1}"

require_cmd bun
require_cmd git
require_cmd sudo
require_cmd systemctl

validate_unit_env_files() {
  local services=("$@")
  local missing_files=()

  if [[ "$VERIFY_SERVICE_ENV_FILES" != "1" ]]; then
    return 0
  fi

  for service in "${services[@]}"; do
    local unit_file="$SYSTEMD_SOURCE_DIR/${service}.service"
    if [[ ! -f "$unit_file" ]]; then
      continue
    fi

    while IFS= read -r line; do
      if [[ "$line" != EnvironmentFile=* ]]; then
        continue
      fi

      local raw_path="${line#EnvironmentFile=}"
      local optional=0
      if [[ "$raw_path" == -* ]]; then
        optional=1
        raw_path="${raw_path#-}"
      fi
      raw_path="$(echo "$raw_path" | xargs)"

      [[ -z "$raw_path" ]] && continue
      [[ "$raw_path" == *%* ]] && continue
      [[ "$raw_path" == /run/credentials/* ]] && continue

      if [[ "${raw_path:0:1}" == "/" ]]; then
        if [[ ! -f "$raw_path" ]]; then
          if ((optional == 1)); then
            log "warning: optional environment file missing for ${service}: $raw_path"
          else
            missing_files+=("${service}:$raw_path")
          fi
        fi
      else
        if [[ ! -f "$ROOT_DIR/$raw_path" ]]; then
          if ((optional == 1)); then
            log "warning: optional environment file missing for ${service}: $ROOT_DIR/$raw_path"
          else
            missing_files+=("${service}:$ROOT_DIR/$raw_path")
          fi
        fi
      fi
    done < <(grep '^EnvironmentFile=' "$unit_file")
  done

  if (( ${#missing_files[@]} > 0 )); then
    echo
    echo "deploy blocked: required environment files are missing for systemd units"
    for missing in "${missing_files[@]}"; do
      echo "  - ${missing}"
    done
    echo "Set these files before restarting services or set VERIFY_SERVICE_ENV_FILES=0 to override."
    echo
    return 1
  fi
}

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

log "validating systemd unit environment files"
validate_unit_env_files "${SERVICES[@]}"

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
