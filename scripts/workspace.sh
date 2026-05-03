#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <dev|build|typecheck|test|lint> [args...]" >&2
  exit 64
fi

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
  status=0
  for workspace in "${WORKSPACES[@]}"; do
    echo "==> $workspace: bun run $TASK $*"
    (cd "$workspace" && bun run "$TASK" "$@") || status=$?
  done
  exit "$status"
fi
