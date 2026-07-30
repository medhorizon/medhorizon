#!/usr/bin/env bash
# MedHorizon offline installer — requires ./medhorizon next to this script.
# Copies Research Graph sidecar when ./research-graph is present.

set -e

INSTALL_DIR="${MEDHORIZON_INSTALL_DIR:-$HOME/.local/medhorizon}"
BIN_LINK="/usr/local/bin/medhorizon"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BIN="$HERE/medhorizon"
RG_BIN="$HERE/research-graph"
VERSION_FILE="$HERE/VERSION"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
step()  { echo -e "${CYAN}  -> $*${NC}"; }
ok()    { echo -e "${GREEN}  OK $*${NC}"; }
err()   { echo -e "${RED}  ERR $*${NC}"; exit 1; }

echo ""
echo -e "${CYAN}  ==============================${NC}"
echo -e "${CYAN}  MedHorizon Installer (offline)${NC}"
echo -e "${CYAN}  ==============================${NC}"
echo ""

[ -f "$LOCAL_BIN" ] || err "medhorizon binary not found next to install.sh. Use the Release installer archive."
chmod +x "$LOCAL_BIN"

VERSION="unknown"
[ -f "$VERSION_FILE" ] && VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')

step "Install dir: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp "$LOCAL_BIN" "$INSTALL_DIR/medhorizon"
chmod +x "$INSTALL_DIR/medhorizon"
echo "$VERSION" > "$INSTALL_DIR/version.txt"
ok "Installed: $INSTALL_DIR/medhorizon ($VERSION)"

if [ -f "$RG_BIN" ]; then
  cp "$RG_BIN" "$INSTALL_DIR/research-graph"
  chmod +x "$INSTALL_DIR/research-graph"
  ok "Installed Research Graph sidecar: $INSTALL_DIR/research-graph"
fi

cat > "$INSTALL_DIR/start.sh" <<'STARTSCRIPT'
#!/usr/bin/env bash
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
RG_PID=""
cleanup() {
  if [ -n "$RG_PID" ] && kill -0 "$RG_PID" 2>/dev/null; then
    kill "$RG_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ -x "$INSTALL_DIR/research-graph" ]; then
  "$INSTALL_DIR/research-graph" >/dev/null 2>&1 &
  RG_PID=$!
  sleep 1
fi

"$INSTALL_DIR/medhorizon" &
SERVER_PID=$!
sleep 1
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:4096"
elif command -v open &>/dev/null; then
  open "http://localhost:4096"
fi
wait $SERVER_PID
STARTSCRIPT
chmod +x "$INSTALL_DIR/start.sh"
ok "Created start script (auto-starts Research Graph sidecar when present)"

if [ -w "$(dirname "$BIN_LINK")" ]; then
  ln -sf "$INSTALL_DIR/start.sh" "$BIN_LINK"
  ok "Command available: medhorizon"
else
  BIN_LINK="$HOME/.local/bin/medhorizon"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/start.sh" "$BIN_LINK"
  ok "Command available: $BIN_LINK"
  if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    echo -e "${YELLOW}  Tip: add to shell rc: export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
  fi
fi

if [ "$OS" = "darwin" ]; then
  APP_DIR="$HOME/Applications/MedHorizon.app"
  MACOS_BIN="$APP_DIR/Contents/MacOS"
  mkdir -p "$MACOS_BIN"
  cat > "$MACOS_BIN/MedHorizon" <<APPSCRIPT
#!/usr/bin/env bash
"$INSTALL_DIR/start.sh"
APPSCRIPT
  chmod +x "$MACOS_BIN/MedHorizon"
  cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MedHorizon</string>
  <key>CFBundleExecutable</key><string>MedHorizon</string>
  <key>CFBundleIdentifier</key><string>ai.medhorizon.app</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
PLIST
  ok "Created macOS app: ~/Applications/MedHorizon.app"
fi

echo ""
echo -e "${GREEN}  Install complete ($VERSION).${NC}"
echo -e "${YELLOW}  Research Graph sidecar starts automatically with MedHorizon.${NC}"
echo "  Run: medhorizon   or   $INSTALL_DIR/start.sh"
echo ""
