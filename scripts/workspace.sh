#!/usr/bin/env bash
set -euo pipefail

TASK="$1"
shift || true

# v2: sentiment-driven outcome market agents.
# Legacy v1 workspaces under legacy/ are intentionally excluded.
WORKSPACES=(
  packages/contracts
  packages/event-bus
  packages/hl-client
  packages/outcome-engine
  packages/outcome-risk
  apps/sentinel
  apps/oracle
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
