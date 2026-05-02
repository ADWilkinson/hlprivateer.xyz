#!/usr/bin/env bash
set -euo pipefail

# Idempotently configures Cloudflare DNS for this repo's default deployment model:
# - Web UI on Cloudflare Pages
# - API + WebSocket gateway behind Cloudflare Tunnel
#
# Requirements:
# - `jq`, `curl`
# - `CF_API_TOKEN` set to a Cloudflare API token with Zone:DNS:Edit for the zone.
#
# Usage:
#   CF_API_TOKEN=... bash scripts/cloudflare/sync-dns.sh hlprivateer.xyz
#
# Optional env:
#   PAGES_PROJECT=hlprivateer-xyz
#   TUNNEL_UUID=5ba42edf-f4d3-47c8-a1b3-68d46ac4f0ec

DOMAIN="${1:-hlprivateer.xyz}"

CF_API_TOKEN="${CF_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
if [[ -z "$CF_API_TOKEN" ]]; then
  echo "CF_API_TOKEN is required (Cloudflare API token with Zone:DNS:Edit for ${DOMAIN})." >&2
  exit 64
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found" >&2
  exit 64
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found" >&2
  exit 64
fi

PAGES_PROJECT="${PAGES_PROJECT:-hlprivateer-xyz}"
PAGES_TARGET="${PAGES_TARGET:-${PAGES_PROJECT}.pages.dev}"

TUNNEL_UUID="${TUNNEL_UUID:-5ba42edf-f4d3-47c8-a1b3-68d46ac4f0ec}"
TUNNEL_TARGET="${TUNNEL_TARGET:-${TUNNEL_UUID}.cfargotunnel.com}"

cf_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  if [[ -n "$data" ]]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data" \
      "https://api.cloudflare.com/client/v4/${path}"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      "https://api.cloudflare.com/client/v4/${path}"
  fi
}

fail_if_not_success() {
  local label="$1"
  local json="$2"
  local ok
  ok="$(echo "$json" | jq -r '.success // false')"
  if [[ "$ok" != "true" ]]; then
    echo "Cloudflare API request failed: ${label}" >&2
    echo "$json" | jq -c '.errors // empty' >&2 || true
    exit 1
  fi
}

zone_json="$(cf_api GET "zones?name=${DOMAIN}")"
fail_if_not_success "zones?name=${DOMAIN}" "$zone_json"
zone_id="$(echo "$zone_json" | jq -r '.result[0].id // empty')"
if [[ -z "$zone_id" ]]; then
  echo "Zone not found for ${DOMAIN}" >&2
  exit 1
fi

delete_record() {
  local record_id="$1"
  local del_json
  del_json="$(cf_api DELETE "zones/${zone_id}/dns_records/${record_id}")"
  fail_if_not_success "DELETE dns_records/${record_id}" "$del_json"
}

upsert_cname() {
  local name="$1"
  local content="$2"

  local list_json
  list_json="$(cf_api GET "zones/${zone_id}/dns_records?name=${name}&per_page=100")"
  fail_if_not_success "GET dns_records?name=${name}" "$list_json"

  # Remove any non-CNAME records for this name.
  mapfile -t non_cname_ids < <(echo "$list_json" | jq -r '.result[] | select(.type != "CNAME") | .id')
  for id in "${non_cname_ids[@]}"; do
    if [[ -n "$id" && "$id" != "null" ]]; then
      delete_record "$id"
    fi
  done

  # Re-list after deletions.
  list_json="$(cf_api GET "zones/${zone_id}/dns_records?name=${name}&per_page=100")"
  fail_if_not_success "GET dns_records?name=${name} (post-delete)" "$list_json"

  mapfile -t cname_ids < <(echo "$list_json" | jq -r '.result[] | select(.type == "CNAME") | .id')
  local primary_id="${cname_ids[0]:-}"

  # Keep exactly 1 CNAME.
  if [[ ${#cname_ids[@]} -gt 1 ]]; then
    for id in "${cname_ids[@]:1}"; do
      delete_record "$id"
    done
  fi

  if [[ -z "$primary_id" || "$primary_id" == "null" ]]; then
    local create_json
    create_json="$(cf_api POST "zones/${zone_id}/dns_records" \
      "{\"type\":\"CNAME\",\"name\":\"${name}\",\"content\":\"${content}\",\"ttl\":1,\"proxied\":true}")"
    fail_if_not_success "POST dns_records ${name}" "$create_json"
    return
  fi

  local update_json
  update_json="$(cf_api PUT "zones/${zone_id}/dns_records/${primary_id}" \
    "{\"type\":\"CNAME\",\"name\":\"${name}\",\"content\":\"${content}\",\"ttl\":1,\"proxied\":true}")"
  fail_if_not_success "PUT dns_records/${primary_id} ${name}" "$update_json"
}

echo "Zone: ${DOMAIN} (${zone_id})"
echo "Pages target: ${PAGES_TARGET}"
echo "Tunnel target: ${TUNNEL_TARGET}"

upsert_cname "${DOMAIN}" "${PAGES_TARGET}"
upsert_cname "www.${DOMAIN}" "${PAGES_TARGET}"
upsert_cname "api.${DOMAIN}" "${TUNNEL_TARGET}"
upsert_cname "ws.${DOMAIN}" "${TUNNEL_TARGET}"

echo "DNS synced."
