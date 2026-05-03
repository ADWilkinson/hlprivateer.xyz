#!/usr/bin/env bash
set -euo pipefail

TASK="$1"
shift || true

# v3: single-process sentiment-driven outcome agent. Two workspaces only.
# Legacy v1 workspaces under legacy/ are intentionally excluded.
WORKSPACES=(
  apps/agent
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
