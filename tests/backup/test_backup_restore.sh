#!/usr/bin/env bash
# P1-11 test: seed (fake) → backup.sh → restore.sh into an empty DB → compare. Needs a reachable PostgreSQL
# (PGHOST/PGPORT/PGUSER, trust or password-file auth) and the built db CLI (pnpm build:packages).
# Creates and drops ONLY databases whose names end in _test.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_CLI="$ROOT/packages/db/dist"
TMP="$(mktemp -d)"
SRC=backup_src_test
DST=backup_dst_test
DST2=backup_dst2_test
export BACKUP_DIR="$TMP/backups" BACKUP_KEEP=3
unset PGPASSWORD PGDATABASE
: "${PGHOST:?PGHOST is required}"

pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ko() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/      /'; fail=$((fail + 1)); }
q() { psql -w -X -q -A -t -d "$1" -c "$2"; }
cleanup() {
  for db in $SRC $DST $DST2; do psql -w -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1; done
  rm -rf "$TMP"
}
trap cleanup EXIT

[ -f "$DB_CLI/cli.js" ] || { echo "db CLI not built (run pnpm build:packages)"; exit 2; }
for db in $SRC $DST $DST2; do psql -w -X -q -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null || exit 2; done

# --- seed fake data in the source -----------------------------------------------------------------------
export DATABASE_URL="postgres://${PGUSER:-postgres}@${PGHOST}:${PGPORT:-5432}/$SRC"
node "$DB_CLI/cli.js" up >/dev/null 2>&1 && node "$DB_CLI/seed-cli.js" >/dev/null 2>&1 \
  && node "$DB_CLI/admin-cli.js" role grant 900000001 org-test-a org_admin >/dev/null 2>&1 || { echo "seed failed"; exit 2; }
q $SRC "INSERT INTO audit_events (action, metadata) SELECT 'test.backup_event', '{}' FROM generate_series(1, 25)" >/dev/null
unset DATABASE_URL

TABLES="orgs users user_allowlist roles role_bindings sessions audit_events release_approvals oauth_login_states rate_limit_hits schema_migrations"
counts() { for t in $TABLES; do printf '%s=%s ' "$t" "$(q "$1" "SELECT count(*) FROM $t")"; done; }

# --- backup ---------------------------------------------------------------------------------------------
out="$(PGDATABASE=$SRC bash "$ROOT/deploy/backup.sh" 2>&1)"
file="$(ls "$BACKUP_DIR"/aidevteam-*.dump 2>/dev/null | head -1)"
if [ -n "$file" ] && [ -f "$file.sha256" ] && grep -q "backup ok" <<<"$out"; then ok "backup creates archive + checksum"; else ko "backup creates archive + checksum" "$out"; fi
[ "$(stat -c %a "$file")" = "600" ] && [ "$(stat -c %a "$BACKUP_DIR")" = "700" ] && ok "archive 600, directory 700" || ko "permissions" "$(ls -la "$BACKUP_DIR")"
[ ! -e "$file.partial" ] && ok "no partial file left behind" || ko "partial file left"
(cd "$BACKUP_DIR" && sha256sum -c "$(basename "$file").sha256" >/dev/null) && ok "checksum file verifies" || ko "checksum verify"

# --- restore into an empty DB and compare ---------------------------------------------------------------
out="$(bash "$ROOT/deploy/restore.sh" --file "$file" --target-db $DST --yes 2>&1)"
grep -q "restore ok" <<<"$out" && ok "restore into empty DB" || ko "restore into empty DB" "$out"
src_counts="$(counts $SRC)"; dst_counts="$(counts $DST)"
[ "$src_counts" = "$dst_counts" ] && ok "row counts match for all tables" || ko "row counts" "src: $src_counts"$'\n'"dst: $dst_counts"
[ "$(q $DST "SELECT max(version) FROM schema_migrations")" = "$(q $SRC "SELECT max(version) FROM schema_migrations")" ] \
  && ok "schema version matches" || ko "schema version"
if q $DST "UPDATE audit_events SET action = 'tampered.event'" >/dev/null 2>&1; then ko "audit append-only trigger restored"; else ok "audit append-only trigger restored (UPDATE refused)"; fi
q $DST "SELECT 1 FROM role_bindings rb JOIN users u ON u.id = rb.user_id WHERE u.github_user_id = 900000001" | grep -q 1 \
  && ok "role binding restored" || ko "role binding restored"

# --- refusals -------------------------------------------------------------------------------------------
out="$(bash "$ROOT/deploy/restore.sh" --file "$file" --target-db $DST --yes 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q "not empty" <<<"$out" && ok "refuses a non-empty target" || ko "refuses a non-empty target" "$out"
out="$(bash "$ROOT/deploy/restore.sh" --file "$file" --target-db $DST2 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q -- "--yes" <<<"$out" && ok "requires --yes" || ko "requires --yes" "$out"
out="$(bash "$ROOT/deploy/restore.sh" --file "$file" --target-db "x; DROP DATABASE postgres" --yes 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q "must match" <<<"$out" && ok "rejects injected target name" || ko "rejects injected target name" "$out"
cp "$file" "$TMP/aidevteam-20000101T000000Z.dump"; cp "$file.sha256" "$TMP/aidevteam-20000101T000000Z.dump.sha256"
printf 'x' >> "$TMP/aidevteam-20000101T000000Z.dump"
out="$(bash "$ROOT/deploy/restore.sh" --file "$TMP/aidevteam-20000101T000000Z.dump" --target-db $DST2 --yes 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q "checksum mismatch" <<<"$out" && ok "refuses a modified archive" || ko "refuses a modified archive" "$out"
[ "$(q $DST2 "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" = "0" ] && ok "refused restore left target untouched" || ko "target untouched"
out="$(PGPASSWORD=should-not-be-used PGDATABASE=$SRC bash "$ROOT/deploy/backup.sh" 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q "PGPASSWORD is not allowed" <<<"$out" && ! grep -q "should-not-be-used" <<<"$out" && ok "refuses PGPASSWORD without echoing it" || ko "refuses PGPASSWORD" "$out"

# --- retention: keep newest BACKUP_KEEP, never touch other files ------------------------------------------
for s in 20260101T000000Z 20260102T000000Z 20260103T000000Z; do : > "$BACKUP_DIR/aidevteam-$s.dump"; : > "$BACKUP_DIR/aidevteam-$s.dump.sha256"; done
: > "$BACKUP_DIR/keep-me.txt"
sleep 1
PGDATABASE=$SRC bash "$ROOT/deploy/backup.sh" >/dev/null 2>&1
n="$(find "$BACKUP_DIR" -maxdepth 1 -name 'aidevteam-*.dump' | wc -l)"
[ "$n" = "3" ] && [ ! -e "$BACKUP_DIR/aidevteam-20260101T000000Z.dump" ] && [ ! -e "$BACKUP_DIR/aidevteam-20260101T000000Z.dump.sha256" ] && [ -e "$BACKUP_DIR/keep-me.txt" ] \
  && ok "retention keeps newest 3, removes old pairs, leaves other files" || ko "retention" "$(ls "$BACKUP_DIR")"

# --- no credentials in the scripts' argv ----------------------------------------------------------------
if grep -nE -- '--password|PGPASSWORD=|://[^ ]*:[^ ]*@' "$ROOT/deploy/backup.sh" "$ROOT/deploy/restore.sh" | grep -v 'die\|#' ; then ko "no credentials passed on the command line"; else ok "no credentials passed on the command line"; fi

echo "---"; echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
