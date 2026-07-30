#!/usr/bin/env bash
# Build Research Graph sidecar binary for the current platform.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building frontend"
(cd frontend && npm ci --ignore-scripts && npm run build)
rm -rf ui
mkdir -p ui
cp -R frontend/dist/. ui/

echo "==> Installing Python build deps"
python3 -m pip install -q -r backend/requirements.txt pyinstaller

echo "==> PyInstaller"
rm -rf sidecar/dist sidecar/build
(cd sidecar && PYTHONPATH="$ROOT" pyinstaller --noconfirm research-graph.spec)

OUT="$ROOT/sidecar/dist/research-graph"
if [[ "$(uname -s)" == MINGL* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* || -f "${OUT}.exe" ]]; then
  OUT="${OUT}.exe"
fi
test -f "$OUT" || test -f "$ROOT/sidecar/dist/research-graph.exe"
ls -lh "$ROOT/sidecar/dist/"
echo "Sidecar binary ready under sidecar/dist/"
