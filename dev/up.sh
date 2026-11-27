#!/usr/bin/env bash
# AI Dev Team Control Center — Development environment bootstrap
# Boots PostgreSQL container, runs migrations and seeds database.
# Usage: bash dev/up.sh [--app]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WITH_APP=false

for arg in "$@"; do
  case "$arg" in
    --app)
      WITH_APP=true
      ;;
    -h|--help)
      echo "Usage: $0 [--app]"
      echo "  Starts dev environment (PostgreSQL by default, optionally api/web with --app)."
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--app]" >&2
      exit 1
      ;;
  esac
done

DEV_PG_PORT="${DEV_PG_PORT:-55433}"
DEV_DATABASE_URL="postgres://postgres@127.0.0.1:${DEV_PG_PORT}/aidevteam_dev"
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:${DEV_PG_PORT}/aidevteam_test"

echo "==> Starting dev PostgreSQL container on loopback port ${DEV_PG_PORT}..."
docker compose -f dev/compose.yaml up -d --wait postgres

echo "==> Building workspace packages (migrate/seed run from dist)..."
pnpm build:packages

echo "==> Running migrations on aidevteam_dev..."
DATABASE_URL="$DEV_DATABASE_URL" pnpm --filter @aidevteam/db migrate up

echo "==> Seeding fake initial data into aidevteam_dev..."
DATABASE_URL="$DEV_DATABASE_URL" pnpm --filter @aidevteam/db seed

if [ "$WITH_APP" = true ]; then
  echo "==> Starting api and web containers (--app profile)..."
  docker compose -f dev/compose.yaml --profile app up -d --wait
fi

echo ""
echo "================================================================================"
echo " Dev environment is ready!"
echo "================================================================================"
echo " PostgreSQL (dev):  $DEV_DATABASE_URL"
echo " PostgreSQL (test): $TEST_DATABASE_URL"
echo ""
echo " To run integration tests against dev container:"
echo "   TEST_DATABASE_URL=$TEST_DATABASE_URL pnpm test:integration"
echo ""
if [ "$WITH_APP" = true ]; then
  echo " Containers running (profile: app):"
  echo "   API: http://127.0.0.1:${DEV_API_PORT:-3001}"
  echo "   Web: http://127.0.0.1:${DEV_WEB_PORT:-3000}"
else
  echo " To run API and Web locally:"
  echo "   API:  pnpm build && PORT=3001 DATABASE_URL=$DEV_DATABASE_URL node apps/api/dist/main.js"
  echo "   Web:  API_INTERNAL_URL=http://127.0.0.1:3001 pnpm --filter @aidevteam/web dev"
fi
echo "================================================================================"
