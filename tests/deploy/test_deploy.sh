#!/usr/bin/env bash
# Tests for deploy/deploy.sh argument validation and dry-run plan. No docker daemon needed.
# Test data is fake: owner "example-org", digests are synthetic.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/deploy/deploy.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export DEPLOY_DIR="$TMP" COMPOSE_FILE="$ROOT/deploy/compose.yaml"

D1="sha256:$(printf 'a%.0s' {1..64})"
D2="sha256:$(printf 'b%.0s' {1..64})"
API="ghcr.io/example-org/aidevteam-api@$D1"
WEB="ghcr.io/example-org/aidevteam-web@$D2"
APPROVAL="https://github.com/example-org/aidevteam/pull/12#issuecomment-1001"
HEALTH="http://127.0.0.1:3001/health/ready"

pass=0; fail=0
expect() { # name, expected_exit, expected_substring, args...
  local name="$1" want="$2" needle="$3"; shift 3
  local out code
  out="$(bash "$SCRIPT" "$@" 2>&1)"; code=$?
  if [ "$code" -eq "$want" ] && grep -qF -- "$needle" <<<"$out"; then
    echo "PASS  $name"; pass=$((pass + 1))
  else
    echo "FAIL  $name (exit=$code want=$want, missing: $needle)"; echo "$out" | sed 's/^/      /'; fail=$((fail + 1))
  fi
}

expect "valid dry-run deploy"            0 "DRY-RUN: docker compose" --image "api=$API" --image "web=$WEB" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "dry-run writes digest env"       0 "IMAGE_API=$API"          --image "api=$API" --image "web=$WEB" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "rejects tag instead of digest"   2 "tags refused"            --image "api=ghcr.io/example-org/aidevteam-api:latest" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "rejects short digest"            2 "tags refused"            --image "api=ghcr.io/example-org/aidevteam-api@sha256:abc" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "rejects other registry"          2 "tags refused"            --image "api=docker.io/example-org/aidevteam-api@$D1" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "rejects service/image mismatch"  2 "does not match service"  --image "web=$API" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "rejects duplicate service"       2 "duplicate service"       --image "api=$API" --image "api=$API" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "requires approval ref"           2 "--approval-ref must be"  --image "api=$API" --health-url "$HEALTH" --dry-run
expect "rejects non-comment approval"    2 "--approval-ref must be"  --image "api=$API" --approval-ref "https://github.com/example-org/aidevteam/pull/12" --health-url "$HEALTH" --dry-run
expect "rejects injection in service"    2 "invalid service name"    --image 'a;rm -rf /='"$API" --approval-ref "$APPROVAL" --health-url "$HEALTH" --dry-run
expect "requires health url"             2 "--health-url is required" --image "api=$API" --approval-ref "$APPROVAL" --dry-run
expect "rejects bad health url"          2 "invalid --health-url"    --image "api=$API" --approval-ref "$APPROVAL" --health-url 'http://x/$(id)' --dry-run
expect "rejects unknown arg"             2 "unknown argument"        --force
expect "rollback needs previous release" 2 "no previous release"     --rollback --health-url "$HEALTH" --dry-run

# rollback dry-run with a recorded previous release
printf 'IMAGE_API=%s\n' "$API" > "$TMP/release.prev.env"
expect "rollback dry-run plan"           0 "DRY-RUN: docker compose" --rollback --health-url "$HEALTH" --dry-run

# dry-run must not create state files
if [ ! -e "$TMP/release.env" ] && [ ! -e "$TMP/deploy.log" ] && [ ! -e "$TMP/release.next.env" ]; then
  echo "PASS  dry-run leaves no state files"; pass=$((pass + 1))
else
  echo "FAIL  dry-run created state files"; ls -la "$TMP"; fail=$((fail + 1))
fi

echo "---"; echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
