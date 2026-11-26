#!/usr/bin/env bash
# backup.sh — logical backup of the Control Center database (P1-11). Run BY AN OPERATOR (or a cron job the
# operator sets up); this repository does not schedule anything on real servers.
#
# Connection: standard libpq environment variables — PGHOST, PGPORT, PGUSER, PGDATABASE.
# Password: ONLY via a password file (PGPASSFILE or ~/.pgpass, mode 600). The password is never passed on the
# command line (visible in `ps`) and PGPASSWORD is refused.
#
# Output: $BACKUP_DIR/aidevteam-<UTC timestamp>.dump (pg_dump custom format, mode 600) + .sha256 file.
# The archive is verified readable (pg_restore --list) before it is published. Keeps the newest $BACKUP_KEEP.
#
# Env: BACKUP_DIR (default /var/backups/aidevteam), BACKUP_KEEP (default 14), PG_DUMP / PG_RESTORE (binaries).
# Flags verified against `pg_dump --help` / `pg_restore --help` of PostgreSQL 16.15 (26/11/2026).

set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/aidevteam}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"
NAME_RE='^aidevteam-[0-9]{8}T[0-9]{6}Z\.dump$'

die() { echo "ERROR: $*" >&2; exit 2; }
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

[ $# -eq 0 ] || die "backup.sh takes no arguments (configure via environment)"
[ -z "${PGPASSWORD:-}" ] || die "PGPASSWORD is not allowed; use a password file (PGPASSFILE or ~/.pgpass, mode 600)"
[ -n "${PGDATABASE:-}" ] || die "PGDATABASE is required"
[ -n "${PGHOST:-}" ] || die "PGHOST is required"
[[ "$BACKUP_KEEP" =~ ^[1-9][0-9]{0,3}$ ]] || die "BACKUP_KEEP must be a positive integer"
command -v "$PG_DUMP" >/dev/null || die "pg_dump not found"
command -v "$PG_RESTORE" >/dev/null || die "pg_restore not found"
command -v "$PSQL" >/dev/null || die "psql not found"

# Client tools must be the SAME major version as the server: a newer pg_dump writes settings the older server
# rejects on restore (seen in CI: pg_dump 17+ emits "SET transaction_timeout", unknown to PostgreSQL 16).
major_of() { "$1" --version | head -1 | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p'; }
server_major="$("$PSQL" -w -X -q -A -t -c "SELECT current_setting('server_version_num')::int / 10000")" || die "cannot connect to the database"
for tool in "$PG_DUMP" "$PG_RESTORE"; do
  client_major="$(major_of "$tool")"
  [ "$client_major" = "$server_major" ] || die "$(basename "$tool") major version $client_major != server major $server_major; use the matching client (e.g. /usr/lib/postgresql/$server_major/bin)"
done

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="aidevteam-${stamp}.dump"
final="$BACKUP_DIR/$name"
tmp="$final.partial"
[ ! -e "$final" ] || die "backup $name already exists"
trap 'rm -f "$tmp"' EXIT

# -w: never prompt (fail instead of hanging); -Fc: custom format (compressed, selective restore possible).
"$PG_DUMP" -w -Fc -f "$tmp"
# The archive must be readable before we call it a backup.
"$PG_RESTORE" --list "$tmp" >/dev/null
sum="$(sha256sum "$tmp" | awk '{print $1}')"
chmod 600 "$tmp"
mv "$tmp" "$final"
printf '%s  %s\n' "$sum" "$name" > "$final.sha256"
chmod 600 "$final.sha256"
trap - EXIT
log "backup ok file=$name bytes=$(stat -c %s "$final") sha256=$sum"

# Retention: only files that match our exact naming pattern are ever deleted.
mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' | grep -E "$NAME_RE" | sort -r)
if [ "${#backups[@]}" -gt "$BACKUP_KEEP" ]; then
  for old in "${backups[@]:$BACKUP_KEEP}"; do
    rm -f -- "$BACKUP_DIR/$old" "$BACKUP_DIR/$old.sha256"
    log "retention removed file=$old"
  done
fi
