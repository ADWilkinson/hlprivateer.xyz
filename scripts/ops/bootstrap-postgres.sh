#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 64
fi

SECRETS_DIR="${SECRETS_DIR:-$ROOT_DIR/secrets}"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" || true

PASS_FILE="$SECRETS_DIR/hl_postgres_password"
ENV_FILE="$SECRETS_DIR/hl_postgres.env"
URL_FILE="$SECRETS_DIR/hl_postgres_database_url"

if [[ ! -f "$PASS_FILE" ]]; then
  # Generate a URL-safe password without depending on sops/age tooling.
  pass="$(openssl rand -hex 24)"
  printf '%s\n' "$pass" >"$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi

pass="$(cat "$PASS_FILE" | tr -d '\n')"
if [[ -z "$pass" ]]; then
  echo "empty postgres password in $PASS_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
POSTGRES_DB=privateer
POSTGRES_USER=privateer
POSTGRES_PASSWORD=$pass
EOF
  chmod 600 "$ENV_FILE"
fi

if [[ ! -f "$URL_FILE" ]]; then
  printf 'postgres://privateer:%s@127.0.0.1:5432/privateer\n' "$pass" >"$URL_FILE"
  chmod 600 "$URL_FILE"
fi

if ! docker inspect hlprivateer-postgres >/dev/null 2>&1; then
  docker run -d \
    --name hlprivateer-postgres \
    --restart unless-stopped \
    --env-file "$ENV_FILE" \
    -p 127.0.0.1:5432:5432 \
    -v hlprivateer-postgres:/var/lib/postgresql/data \
    postgres:16-alpine
else
  docker start hlprivateer-postgres >/dev/null
fi

echo "waiting for postgres..."
deadline="$((SECONDS + 30))"
until docker exec hlprivateer-postgres pg_isready -U privateer -d privateer >/dev/null 2>&1; do
  if [[ "$SECONDS" -ge "$deadline" ]]; then
    echo "postgres did not become ready in time" >&2
    docker logs --tail 50 hlprivateer-postgres >&2 || true
    exit 1
  fi
  sleep 1
done

echo "applying migrations..."
docker exec -i hlprivateer-postgres psql -U privateer -d privateer < apps/runtime/migrations/0001_init.sql >/dev/null

echo "ok"
echo "DATABASE_URL_FILE=$URL_FILE"

