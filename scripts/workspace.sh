#!/usr/bin/env bash
set -euo pipefail

TASK="$1"
shift || true

WORKSPACES=(
  packages/contracts
  packages/event-bus
  packages/plugin-sdk
  packages/agent-sdk
  packages/risk-engine
  apps/api
  apps/runtime
  apps/ws-gateway
  apps/web
)

if [[ "$TASK" == "dev" ]]; then
  pids=()
  for workspace in "${WORKSPACES[@]}"; do
    (cd "$workspace" && bun run "$TASK" "$@" ) &
    pids+=("$!")
  done

  trap 'kill "${pids[@]}" 2>/dev/null || true' INT TERM
  wait
else
  for workspace in "${WORKSPACES[@]}"; do
    (cd "$workspace" && bun run "$TASK" "$@")
  done
fi
