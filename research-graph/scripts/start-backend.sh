#!/usr/bin/env bash
# Start Research Graph backend on loopback only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"
HOST="${BACKEND_HOST:-127.0.0.1}"
PORT="${BACKEND_PORT:-8000}"
if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
  echo "refusing non-loopback bind: $HOST (set explicitly only behind an auth proxy)" >&2
  exit 1
fi
exec backend/.venv/bin/uvicorn backend.main:app --host "$HOST" --port "$PORT"
