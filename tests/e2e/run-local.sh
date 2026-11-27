#!/usr/bin/env bash
# Local browser E2E (P2-10 AC-8): builds, starts api + web against a *_test PostgreSQL database with fake data,
# runs tests/e2e/*.e2e.cjs, then stops everything. Needs PGHOST/PGPORT/PGUSER (trust auth) and `playwright`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=e2e_ui_test
API_PORT=3911; WEB_PORT=3910
export BASE_URL="http://localhost:$WEB_PORT"
pids=()
free_ports() { # next-server renames its process, so stop whatever listens on our ports
  for port in $API_PORT $WEB_PORT; do pid="$(lsof -ti tcp:$port 2>/dev/null || true)"; [ -n "$pid" ] && kill $pid 2>/dev/null || true; done
}
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; free_ports; }
trap cleanup EXIT
free_ports; sleep 1
for port in $API_PORT $WEB_PORT; do ! lsof -ti tcp:$port >/dev/null 2>&1 || { echo "port $port still in use"; exit 2; }; done

psql -w -X -q -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
export DATABASE_URL="postgres://${PGUSER:-postgres}@${PGHOST}:${PGPORT:-5432}/$DB"
(cd "$ROOT" && pnpm build:packages >/dev/null && pnpm --filter @aidevteam/api build >/dev/null && API_INTERNAL_URL="http://127.0.0.1:$API_PORT" pnpm --filter @aidevteam/web build >/dev/null)
# Same as the web Dockerfile: the standalone server does not include static assets by itself.
rm -rf "$ROOT/apps/web/.next/standalone/apps/web/.next/static" "$ROOT/apps/web/.next/standalone/apps/web/public"
cp -r "$ROOT/apps/web/.next/static" "$ROOT/apps/web/.next/standalone/apps/web/.next/static"
cp -r "$ROOT/apps/web/public" "$ROOT/apps/web/.next/standalone/apps/web/public"
node "$ROOT/packages/db/dist/cli.js" up >/dev/null 2>&1
node "$ROOT/packages/db/dist/seed-cli.js" >/dev/null 2>&1
node "$ROOT/packages/db/dist/allowlist-cli.js" add 900000003 e2e >/dev/null 2>&1
node "$ROOT/packages/db/dist/admin-cli.js" role grant 900000003 org-test-a maintainer >/dev/null 2>&1
node "$ROOT/packages/db/dist/admin-cli.js" role grant 900000002 org-test-a viewer >/dev/null 2>&1
node "$ROOT/packages/db/dist/allowlist-cli.js" add 900000005 e2e-platform >/dev/null 2>&1
node "$ROOT/packages/db/dist/admin-cli.js" platform grant 900000005 e2e >/dev/null 2>&1

session() { # create a fake session row for a seeded fake user, print the raw token
  local t h n
  t="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  # Pass the token through the environment, not argv: a base64url token can start with "-", which node would
  # parse as an option ("bad option"), leaving an empty hash and a session that never works (~1 in 64 per token).
  h="$(T="$t" node -e "console.log(require('crypto').createHash('sha256').update(process.env.T).digest('hex'))")"
  [[ "$h" =~ ^[0-9a-f]{64}$ ]] || { echo "session: could not hash token for $1" >&2; return 1; }
  n="$(psql -w -X -q -t -A -d "$DB" -c "WITH s AS (INSERT INTO sessions (user_id, token_hash, expires_at) SELECT id, decode('$h','hex'), now() + interval '1 hour' FROM users WHERE github_user_id = $1 RETURNING 1) SELECT count(*) FROM s")"
  [ "$n" = "1" ] || { echo "session: no session created for $1" >&2; return 1; }
  echo "$t"
}
# Assign separately: `export X="$(…)"` would hide a failing session() from set -e.
MAINT_TOKEN="$(session 900000003)"; VIEWER_TOKEN="$(session 900000002)"; PLATFORM_TOKEN="$(session 900000005)"
export MAINT_TOKEN VIEWER_TOKEN PLATFORM_TOKEN

(cd "$ROOT/apps/api" && PORT=$API_PORT PUBLIC_BASE_URL="$BASE_URL" GITHUB_OAUTH_CLIENT_ID=Iv1.e2efakeclient GITHUB_OAUTH_CLIENT_SECRET=fake-secret-e2e-only-0000000 TRUSTED_PROXY_IPS=127.0.0.1 node dist/main.js >/tmp/e2e-api.log 2>&1) & pids+=($!)
(cd "$ROOT/apps/web/.next/standalone" && PORT=$WEB_PORT HOSTNAME=127.0.0.1 API_INTERNAL_URL="http://127.0.0.1:$API_PORT" node apps/web/server.js >/tmp/e2e-web.log 2>&1) & pids+=($!)
for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:$API_PORT/health/ready" >/dev/null && curl -fs "http://127.0.0.1:$WEB_PORT/health" >/dev/null && break; sleep 1; done

status=0
# E2E_ONLY="a b" runs only tests/e2e/<a>.e2e.cjs, <b>.e2e.cjs (in that order) — for debugging.
if [ -n "${E2E_ONLY:-}" ]; then files=(); for n in $E2E_ONLY; do files+=("$ROOT/tests/e2e/$n.e2e.cjs"); done; else files=("$ROOT"/tests/e2e/*.e2e.cjs); fi
for t in "${files[@]}"; do echo "== $(basename "$t")"; node "$t" || status=1; done
exit $status
