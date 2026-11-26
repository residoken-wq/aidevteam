#!/usr/bin/env bash
# restore.sh — restore a backup made by backup.sh into an EMPTY database (P1-11). Run BY AN OPERATOR.
#
#   restore.sh --file /var/backups/aidevteam/aidevteam-20261126T010000Z.dump --target-db aidevteam_restore --yes
#
# Safety:
#   - the .sha256 next to the archive must exist and match (tampered/partial files are refused);
#   - the target database must already exist and contain no tables in schema public (never overwrites data);
#   - single transaction + exit on first error: a failed restore leaves the target empty;
#   - --yes is mandatory.
# Connection: libpq env (PGHOST, PGPORT, PGUSER); password only via password file; PGPASSWORD refused.
# Flags verified against `pg_restore --help` / `psql --help` of PostgreSQL 16.15 (26/11/2026).

set -euo pipefail
umask 077

PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"
FILE=""
TARGET=""
YES=0

die() { echo "ERROR: $*" >&2; exit 2; }
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --file)      [ $# -ge 2 ] || die "--file needs a value"; FILE="$2"; shift 2 ;;
    --target-db) [ $# -ge 2 ] || die "--target-db needs a value"; TARGET="$2"; shift 2 ;;
    --yes)       YES=1; shift ;;
    *)           die "unknown argument: $1" ;;
  esac
done

[ -z "${PGPASSWORD:-}" ] || die "PGPASSWORD is not allowed; use a password file (PGPASSFILE or ~/.pgpass, mode 600)"
[ -n "${PGHOST:-}" ] || die "PGHOST is required"
[ "$YES" -eq 1 ] || die "restore needs --yes"
[[ "$TARGET" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || die "--target-db must match ^[a-z][a-z0-9_]{0,62}$"
[ -n "$FILE" ] && [ -f "$FILE" ] || die "--file must be an existing backup file"
[[ "$(basename "$FILE")" =~ ^aidevteam-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || die "file name does not look like a backup.sh archive"
[ -f "$FILE.sha256" ] || die "checksum file $FILE.sha256 is missing"

expected="$(awk 'NR==1 {print $1}' "$FILE.sha256")"
actual="$(sha256sum "$FILE" | awk '{print $1}')"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "checksum file is malformed"
[ "$expected" = "$actual" ] || die "checksum mismatch — archive is corrupted or was modified"

tables="$("$PSQL" -w -X -q -A -t -d "$TARGET" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" \
  || die "cannot connect to target database '$TARGET' (create it first)"
[ "$tables" = "0" ] || die "target database '$TARGET' is not empty ($tables tables in public); refusing to overwrite"

log "restore start file=$(basename "$FILE") target=$TARGET sha256=$actual"
"$PG_RESTORE" -w --no-owner --no-privileges --exit-on-error --single-transaction -d "$TARGET" "$FILE"
version="$("$PSQL" -w -X -q -A -t -d "$TARGET" -c "SELECT max(version) FROM schema_migrations")"
log "restore ok target=$TARGET schema_version=$version"
