#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://hlprivateer.xyz}"
API_URL="${API_URL:-https://api.hlprivateer.xyz}"
WS_URL="${WS_URL:-wss://ws.hlprivateer.xyz}"
WS_METRICS_URL="${WS_METRICS_URL:-https://ws.hlprivateer.xyz/metrics}"
ORIGIN="${ORIGIN:-https://hlprivateer.xyz}"
LOCAL="${LOCAL:-1}"

INTERVAL_SEC="${INTERVAL_SEC:-60}"
DURATION_SEC="${DURATION_SEC:-86400}"
OUT="${OUT:-burnin-$(date -u +%Y%m%dT%H%M%SZ).log}"

start_ts="$(date +%s)"
end_ts="$((start_ts + DURATION_SEC))"

{
  echo "burnin start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "burnin duration_sec=$DURATION_SEC interval_sec=$INTERVAL_SEC out=$OUT"
  echo "targets: public_url=$PUBLIC_URL api_url=$API_URL ws_url=$WS_URL origin=$ORIGIN local=$LOCAL"
} | tee -a "$OUT"

while [[ "$(date +%s)" -lt "$end_ts" ]]; do
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if PUBLIC_URL="$PUBLIC_URL" API_URL="$API_URL" WS_URL="$WS_URL" WS_METRICS_URL="$WS_METRICS_URL" ORIGIN="$ORIGIN" LOCAL="$LOCAL" bash scripts/readiness/smoke.sh >>"$OUT" 2>&1; then
    echo "$now OK" | tee -a "$OUT"
  else
    echo "$now FAIL (see log output above)" | tee -a "$OUT"
    exit 1
  fi

  sleep "$INTERVAL_SEC"
done

echo "burnin complete: $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT"

