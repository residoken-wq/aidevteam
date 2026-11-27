#!/usr/bin/env bash
# AI Dev Team Control Center — Development environment shutdown
# Stops containers without deleting volumes, unless --volumes and --yes are provided.
# Usage: bash dev/down.sh [--volumes] [--yes]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VOLUMES=false
CONFIRMED=false

for arg in "$@"; do
  case "$arg" in
    --volumes|-v)
      VOLUMES=true
      ;;
    --yes|-y)
      CONFIRMED=true
      ;;
    -h|--help)
      echo "Usage: $0 [--volumes] [--yes]"
      echo "  Stops dev environment containers."
      echo "  Pass --volumes --yes to also remove persistent volumes (aidevteam-dev-pg)."
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--volumes] [--yes]" >&2
      exit 1
      ;;
  esac
done

if [ "$VOLUMES" = true ]; then
  if [ "$CONFIRMED" != true ]; then
    echo "ERROR: Refusing to delete volume 'aidevteam-dev-pg' without explicit confirmation." >&2
    echo "Pass both --volumes and --yes to confirm data deletion." >&2
    exit 1
  fi
  echo "==> Stopping dev environment and removing persistent volume (aidevteam-dev-pg)..."
  docker compose -f dev/compose.yaml --profile app down --volumes
else
  echo "==> Stopping dev environment (preserving persistent volumes)..."
  docker compose -f dev/compose.yaml --profile app down
fi
