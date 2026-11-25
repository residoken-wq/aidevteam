#!/usr/bin/env bash
# deploy.sh — run BY A HUMAN OPERATOR on the VPS. Pulls images by digest and restarts the stack.
#
# Rules enforced here (CLAUDE.md §2, §5.5, §9):
#   - Images only by immutable digest (ghcr.io/<owner>/aidevteam-<service>@sha256:<64 hex>). Tags are refused.
#   - An approval reference (URL of the Owner's /approve-* comment on the release manifest PR) is mandatory
#     and logged. This script does NOT verify the approval itself — the operator must check that the
#     approved digest equals the digest passed here (see docs/operations/CICD.md).
#   - Never reads the app env/secret file; compose reads it directly.
#   - Health check after deploy; on failure, automatic rollback to the previous release.
#
# Usage:
#   deploy.sh --image api=ghcr.io/o/aidevteam-api@sha256:... --image web=ghcr.io/o/aidevteam-web@sha256:... \
#             --approval-ref https://github.com/o/r/pull/12#issuecomment-123 \
#             --health-url http://127.0.0.1:3001/health/ready [--health-url ...] [--dry-run]
#   deploy.sh --rollback --health-url ... [--dry-run]
#
# Env:
#   DEPLOY_DIR   state dir (default /opt/aidevteam). Holds compose.yaml, release.env, release.prev.env, deploy.log
#   COMPOSE_FILE default "$DEPLOY_DIR/compose.yaml"
#   HEALTH_RETRIES (default 20), HEALTH_INTERVAL seconds (default 3)

set -euo pipefail
umask 077

DEPLOY_DIR="${DEPLOY_DIR:-/opt/aidevteam}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
RELEASE_ENV="$DEPLOY_DIR/release.env"
PREV_ENV="$DEPLOY_DIR/release.prev.env"
LOG_FILE="$DEPLOY_DIR/deploy.log"
LOCK_FILE="$DEPLOY_DIR/.deploy.lock"

IMAGE_RE='^ghcr\.io/[a-z0-9][a-z0-9-]*/aidevteam-([a-z][a-z0-9-]*)@sha256:[0-9a-f]{64}$'
SERVICE_RE='^[a-z][a-z0-9-]*$'
APPROVAL_RE='^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+#issuecomment-[0-9]+$'
HEALTH_RE='^https?://[A-Za-z0-9.:-]+(/[A-Za-z0-9._~/-]*)?$'

DRY_RUN=0
ROLLBACK=0
APPROVAL_REF=""
declare -a IMAGES=()
declare -a HEALTH_URLS=()

die() { echo "ERROR: $*" >&2; exit 2; }
log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) operator=${SUDO_USER:-${USER:-unknown}} $*"
  echo "$line"
  if [ "$DRY_RUN" -eq 0 ]; then echo "$line" >> "$LOG_FILE"; fi
}
run() {
  if [ "$DRY_RUN" -eq 1 ]; then printf 'DRY-RUN:'; printf ' %q' "$@"; echo; else "$@"; fi
}

usage() { sed -n '2,25p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --image)        [ $# -ge 2 ] || die "--image needs a value"; IMAGES+=("$2"); shift 2 ;;
    --approval-ref) [ $# -ge 2 ] || die "--approval-ref needs a value"; APPROVAL_REF="$2"; shift 2 ;;
    --health-url)   [ $# -ge 2 ] || die "--health-url needs a value"; HEALTH_URLS+=("$2"); shift 2 ;;
    --rollback)     ROLLBACK=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "unknown argument: $1" ;;
  esac
done

# ---------- validation ----------
[ "${#HEALTH_URLS[@]}" -ge 1 ] || die "at least one --health-url is required"
for u in "${HEALTH_URLS[@]}"; do
  [[ "$u" =~ $HEALTH_RE ]] || die "invalid --health-url: $u"
done
[[ "$HEALTH_RETRIES" =~ ^[0-9]+$ && "$HEALTH_INTERVAL" =~ ^[0-9]+$ ]] || die "HEALTH_RETRIES/HEALTH_INTERVAL must be integers"

declare -A NEW=()
if [ "$ROLLBACK" -eq 1 ]; then
  [ "${#IMAGES[@]}" -eq 0 ] || die "--rollback does not take --image"
  [ -f "$PREV_ENV" ] || die "no previous release recorded ($PREV_ENV)"
else
  [ "${#IMAGES[@]}" -ge 1 ] || die "at least one --image service=ref is required"
  [[ "$APPROVAL_REF" =~ $APPROVAL_RE ]] || die "--approval-ref must be a GitHub PR comment URL (…/pull/N#issuecomment-N)"
  for spec in "${IMAGES[@]}"; do
    svc="${spec%%=*}"; ref="${spec#*=}"
    [ "$svc" != "$spec" ] || die "--image must be service=ref: $spec"
    [[ "$svc" =~ $SERVICE_RE ]] || die "invalid service name: $svc"
    [[ "$ref" =~ $IMAGE_RE ]] || die "image must be ghcr.io/<owner>/aidevteam-<service>@sha256:<64 hex> (tags refused): $ref"
    [ "${BASH_REMATCH[1]}" = "$svc" ] || die "image repo aidevteam-${BASH_REMATCH[1]} does not match service '$svc'"
    [ -z "${NEW[$svc]+x}" ] || die "duplicate service: $svc"
    NEW[$svc]="$ref"
  done
fi

if [ "$DRY_RUN" -eq 0 ]; then
  command -v docker >/dev/null || die "docker not found"
  command -v curl >/dev/null || die "curl not found"
  [ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"
  mkdir -p "$DEPLOY_DIR"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "another deploy is running"
fi

compose() { run docker compose --project-name aidevteam --env-file "$1" -f "$COMPOSE_FILE" "${@:2}"; }

health_ok() {
  [ "$DRY_RUN" -eq 1 ] && { echo "DRY-RUN: health check ${HEALTH_URLS[*]}"; return 0; }
  local i u ok
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    ok=1
    for u in "${HEALTH_URLS[@]}"; do
      curl -fsS --max-time 5 -o /dev/null "$u" || { ok=0; break; }
    done
    [ "$ok" -eq 1 ] && return 0
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

write_env() { # file, then KEY=VALUE lines on stdin
  local f="$1" tmp
  if [ "$DRY_RUN" -eq 1 ]; then echo "DRY-RUN: write $f:"; sed 's/^/  /'; return; fi
  tmp="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"; cat > "$tmp"; mv -f "$tmp" "$f"
}

# ---------- rollback ----------
if [ "$ROLLBACK" -eq 1 ]; then
  log "action=rollback from=$(grep -h '^IMAGE_' "$RELEASE_ENV" 2>/dev/null | tr '\n' ' ') to=$(grep -h '^IMAGE_' "$PREV_ENV" | tr '\n' ' ')"
  compose "$PREV_ENV" pull
  compose "$PREV_ENV" up -d --remove-orphans
  if health_ok; then
    [ "$DRY_RUN" -eq 1 ] || cp -f "$PREV_ENV" "$RELEASE_ENV"
    log "action=rollback result=OK"; exit 0
  fi
  log "action=rollback result=HEALTH_FAILED"; exit 1
fi

# ---------- deploy ----------
NEW_ENV_CONTENT="# generated by deploy.sh — approval: $APPROVAL_REF"$'\n'
for svc in $(printf '%s\n' "${!NEW[@]}" | sort); do
  key="IMAGE_$(echo "$svc" | tr '[:lower:]-' '[:upper:]_')"
  NEW_ENV_CONTENT+="$key=${NEW[$svc]}"$'\n'
done

STAGED="$DEPLOY_DIR/release.next.env"
printf '%s' "$NEW_ENV_CONTENT" | write_env "$STAGED"
log "action=deploy approval=$APPROVAL_REF images=$(printf '%s ' "${NEW[@]}")"

compose "$STAGED" pull
if [ -f "$RELEASE_ENV" ] && [ "$DRY_RUN" -eq 0 ]; then cp -f "$RELEASE_ENV" "$PREV_ENV"; fi
compose "$STAGED" up -d --remove-orphans

if health_ok; then
  [ "$DRY_RUN" -eq 1 ] || mv -f "$STAGED" "$RELEASE_ENV"
  log "action=deploy result=OK"
  exit 0
fi

log "action=deploy result=HEALTH_FAILED — rolling back"
if [ -f "$PREV_ENV" ]; then
  compose "$PREV_ENV" up -d --remove-orphans
  if health_ok; then log "action=auto_rollback result=OK"; else log "action=auto_rollback result=HEALTH_FAILED"; fi
else
  log "action=auto_rollback result=SKIPPED (no previous release)"
fi
exit 1
