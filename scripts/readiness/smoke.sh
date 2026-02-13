#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://hlprivateer.xyz}"
API_URL="${API_URL:-https://api.hlprivateer.xyz}"
WS_URL="${WS_URL:-wss://ws.hlprivateer.xyz}"
WS_METRICS_URL="${WS_METRICS_URL:-https://ws.hlprivateer.xyz/metrics}"
ORIGIN="${ORIGIN:-https://hlprivateer.xyz}"
LOCAL="${LOCAL:-0}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "smoke: public_url=$PUBLIC_URL api_url=$API_URL ws_url=$WS_URL origin=$ORIGIN local=$LOCAL"

curl -fsS "$PUBLIC_URL/" >/dev/null

api_json="$(curl -fsS "$API_URL/v1/public/pnl")"
echo "$api_json" | grep -q '"pnlPct"' || fail "API /v1/public/pnl missing pnlPct"

cors_headers="$(curl -sS -D - -o /dev/null -X OPTIONS "$API_URL/v1/public/pnl" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET")"
echo "$cors_headers" | grep -qi '^access-control-allow-origin:' || fail "API CORS missing Access-Control-Allow-Origin"

curl -fsS "$WS_METRICS_URL" >/dev/null

runtime_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../apps/runtime" >/dev/null 2>&1 && pwd)"
pushd "$runtime_dir" >/dev/null
WS_URL="$WS_URL" ORIGIN="$ORIGIN" node -e "
const WebSocket = require('ws');
const url = process.env.WS_URL;
const origin = process.env.ORIGIN;
const ws = new WebSocket(url, { headers: { Origin: origin } });
const timer = setTimeout(() => {
  console.error('timeout');
  process.exit(2);
}, 8000);
ws.on('open', () => {
  console.log('ws open');
  ws.close(1000, 'smoke');
});
ws.on('error', (err) => {
  console.error('ws error', err?.message || String(err));
  clearTimeout(timer);
  process.exit(1);
});
ws.on('close', (code, reason) => {
  clearTimeout(timer);
  console.log('ws close', code, String(reason || ''));
  process.exit(code === 1000 ? 0 : 1);
});
"
popd >/dev/null

if [[ "$LOCAL" == "1" ]]; then
  curl -fsS http://127.0.0.1:4000/healthz >/dev/null
  curl -fsS http://127.0.0.1:4100/metrics >/dev/null
  curl -fsS http://127.0.0.1:9400/healthz >/dev/null
fi

echo "OK"

