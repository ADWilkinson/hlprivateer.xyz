#!/usr/bin/env bash
# Usage: ./scripts/inspect-site.sh https://tofi.at
# Reports: detected stack, every external domain, analytics/tracker hits.
# Requires: curl, grep, sed, sort. (No node/python needed.)

set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "usage: $0 <url>" >&2
  exit 2
fi

HOST="$(printf '%s' "$URL" | sed -E 's|^https?://||; s|/.*$||')"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

echo "== fetching $URL =="
curl -sSL -A "$UA" -D "$TMP/headers.txt" -o "$TMP/index.html" --max-time 30 "$URL"
echo "  saved -> $TMP/index.html ($(wc -c <"$TMP/index.html") bytes)"
echo

echo "== response headers =="
grep -iE '^(server|x-powered-by|x-vercel|x-nextjs|x-amz-cf|cf-ray|x-served-by|via|x-cache|content-security-policy|report-to|nel|set-cookie):' "$TMP/headers.txt" || true
echo

echo "== framework / stack hints =="
{
  grep -ciE 'name="generator"[^>]*content="[^"]+"' "$TMP/index.html" >/dev/null \
    && grep -oiE 'name="generator"[^>]*content="[^"]+"' "$TMP/index.html" | head -3
  for hint in \
    '/_next/' '__NEXT_DATA__' '/_nuxt/' '/_astro/' '/_app/immutable/' \
    'data-sveltekit' 'data-reactroot' 'react-dom' 'window.__remixContext' \
    '/wp-content/' '/wp-includes/' 'wp-json' 'shopify' 'cdn.shopify' \
    'gatsby' 'data-gatsby' 'webflow' 'squarespace' 'wix.com' 'framer.com' \
    'vue' 'nuxt' 'angular' 'ember' 'preact' 'solid-js' 'qwik' \
    'tailwind' 'bootstrap' 'bulma' 'mui' 'chakra-ui' \
    'vercel' 'netlify' 'cloudflare' 'fastly' 'github.io' 'pages.dev' \
    'cloudfront' 'amazonaws.com'; do
    if grep -qiF "$hint" "$TMP/index.html"; then
      printf '  hit: %s\n' "$hint"
    fi
  done
} | sort -u
echo

echo "== analytics / tracker scan =="
TRACKERS=(
  peerlytics posthog plausible umami mixpanel amplitude segment.com segment.io
  fathom cloudflareinsights hotjar fullstory clarity.ms heap.io heap-analytics
  matomo piwik google-analytics googletagmanager gtag.js gtm.js
  facebook.net fbevents.com pixel.wp.com sentry.io bugsnag datadog newrelic
  vercel-insights vercel-analytics statsig launchdarkly
)
for t in "${TRACKERS[@]}"; do
  if grep -qiF "$t" "$TMP/index.html"; then
    printf '  FOUND: %s\n' "$t"
    grep -oiE "[^\"' ]*${t}[^\"' ]*" "$TMP/index.html" | sort -u | sed 's/^/    /'
  fi
done
echo

echo "== external domains referenced =="
grep -oiE '(src|href|action|content|data-src)="[^"]+"' "$TMP/index.html" \
  | sed -E 's/^[^"]*"//; s/"$//' \
  | grep -oiE 'https?://[^/"<> ]+' \
  | sed -E 's|^https?://||' \
  | sort -u \
  | grep -v -E "^${HOST//./\\.}$" || echo "  (none beyond self)"
echo

echo "== inline fetch / XHR / WebSocket targets =="
grep -oiE '(fetch|XMLHttpRequest|new WebSocket|axios\.[a-z]+|\.get|\.post)\([^)]*\)' "$TMP/index.html" \
  | head -20 || true
grep -oiE 'https?://[^"'"'"'<> ]+\.(json|js|css|woff2?|ttf|svg|png|jpg|webp|wasm|map)' "$TMP/index.html" \
  | sort -u | head -40 || true
echo

echo "== summary =="
echo "  host:    $HOST"
echo "  saved:   $TMP/index.html"
echo "  headers: $TMP/headers.txt"
echo "  (open these to dig further; e.g. inspect bundled JS for runtime endpoints)"
