#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE_APP_DIR="$ROOT_DIR/.next/standalone/apps/web"

if [[ ! -d "$STANDALONE_APP_DIR" ]]; then
  echo "standalone app dir not found: $STANDALONE_APP_DIR" >&2
  echo "run \`bunx next build\` without HLP_STATIC_EXPORT first" >&2
  exit 1
fi

mkdir -p "$STANDALONE_APP_DIR/.next"
rm -rf "$STANDALONE_APP_DIR/.next/static" "$STANDALONE_APP_DIR/public"
cp -R "$ROOT_DIR/.next/static" "$STANDALONE_APP_DIR/.next/static"
cp -R "$ROOT_DIR/public" "$STANDALONE_APP_DIR/public"

echo "Prepared standalone static assets:"
echo " - $STANDALONE_APP_DIR/.next/static"
echo " - $STANDALONE_APP_DIR/public"
