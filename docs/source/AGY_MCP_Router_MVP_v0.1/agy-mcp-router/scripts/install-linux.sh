#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
[ -f config/workers.json ] || cp config/workers.example.json config/workers.json
echo 'Edit config/workers.json for Linux paths, create profiles/worktrees, log in to AGY, then configure Claude Desktop.'
