#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAND_DIR="$ROOT_DIR/public/brand"
ICONS_DIR="$ROOT_DIR/public/icons"
APP_DIR="$ROOT_DIR/app"

MARK_SVG="$BRAND_DIR/hl-privateer-mark.svg"
SOCIAL_SVG="$BRAND_DIR/hl-privateer-social.svg"

mkdir -p "$ICONS_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

sips -s format png "$MARK_SVG" --out "$TMP_DIR/mark.png" >/dev/null
sips -s format png "$SOCIAL_SVG" --out "$TMP_DIR/social.png" >/dev/null

sips -z 512 512 "$TMP_DIR/mark.png" --out "$ICONS_DIR/icon-512.png" >/dev/null
sips -z 192 192 "$TMP_DIR/mark.png" --out "$ICONS_DIR/icon-192.png" >/dev/null
sips -z 180 180 "$TMP_DIR/mark.png" --out "$APP_DIR/apple-icon.png" >/dev/null
sips -z 512 512 "$TMP_DIR/mark.png" --out "$APP_DIR/icon.png" >/dev/null
sips -z 630 1200 "$TMP_DIR/social.png" --out "$ROOT_DIR/public/og-image.png" >/dev/null

if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -loglevel error -i "$ICONS_DIR/icon-512.png" -vf scale=64:64 "$APP_DIR/favicon.ico"
else
  bunx png-to-ico "$ICONS_DIR/icon-512.png" > "$APP_DIR/favicon.ico"
fi

cp "$ROOT_DIR/public/og-image.png" "$ROOT_DIR/public/twitter-image.png"

echo "Generated icon and social assets:"
echo " - $ICONS_DIR/icon-192.png"
echo " - $ICONS_DIR/icon-512.png"
echo " - $APP_DIR/apple-icon.png"
echo " - $APP_DIR/favicon.ico"
echo " - $APP_DIR/icon.png"
echo " - $ROOT_DIR/public/og-image.png"
echo " - $ROOT_DIR/public/twitter-image.png"
