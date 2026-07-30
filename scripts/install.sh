#!/usr/bin/env bash
# MedHorizon 一键安装脚本 — macOS / Linux
# 用法：curl -fsSL https://raw.githubusercontent.com/medhorizon/medhorizon/main/scripts/install.sh | bash

set -e

REPO="medhorizon/medhorizon"
INSTALL_DIR="$HOME/.local/medhorizon"
BIN_LINK="/usr/local/bin/medhorizon"

# ── 颜色 ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
step()  { echo -e "${CYAN}  → $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
err()   { echo -e "${RED}  ✗ $*${NC}"; exit 1; }

echo ""
echo -e "${CYAN}  ╔══════════════════════════════╗${NC}"
echo -e "${CYAN}  ║    MedHorizon 安装程序         ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════╝${NC}"
echo ""

# ── 1. 检测平台 ────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) err "不支持的架构: $ARCH" ;;
esac

case "$OS" in
  darwin) PLATFORM="macos" ;;
  linux)  PLATFORM="linux" ;;
  *)      err "不支持的系统: $OS" ;;
esac


# v0.2+ ships Apple Silicon only for macOS (no macos-x64 artifact).
if [ "$PLATFORM" = "macos" ] && [ "$ARCH" = "x64" ]; then
  err "当前 Release 不提供 Intel Mac (macos-x64) 包，请使用 Apple Silicon 或从源码构建。"
fi

ASSET_NAME="medhorizon-${PLATFORM}-${ARCH}.tar.gz"
step "平台: $PLATFORM-$ARCH"

# ── 2. 检查依赖 ────────────────────────────────────────────────
for cmd in curl tar; do
  command -v "$cmd" &>/dev/null || err "缺少依赖: $cmd，请先安装。"
done

# ── 3. 获取最新版本 ────────────────────────────────────────────
step "正在查询最新版本..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") \
  || err "无法连接 GitHub，请检查网络连接。"
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\(.*\)".*/\1/')
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url" | grep "$ASSET_NAME" | head -1 \
  | sed 's/.*"browser_download_url": *"\(.*\)".*/\1/')

[ -z "$DOWNLOAD_URL" ] && err "未找到 $ASSET_NAME，请确认 Release 已发布。"
ok "找到版本: $VERSION"

# ── 4. 下载并解压 ──────────────────────────────────────────────
step "正在下载..."
mkdir -p "$INSTALL_DIR"
TMP=$(mktemp -d)
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP/medhorizon.tar.gz"
tar -xzf "$TMP/medhorizon.tar.gz" -C "$TMP"
cp "$TMP/medhorizon" "$INSTALL_DIR/medhorizon"
chmod +x "$INSTALL_DIR/medhorizon"
rm -rf "$TMP"
echo "$VERSION" > "$INSTALL_DIR/version.txt"
ok "安装至: $INSTALL_DIR/medhorizon"

# ── 5. 创建启动脚本 ────────────────────────────────────────────
cat > "$INSTALL_DIR/start.sh" <<'STARTSCRIPT'
#!/usr/bin/env bash
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
# 等待服务启动后再打开浏览器
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

# ── 6. 软链接到 PATH ───────────────────────────────────────────
if [ -w "$(dirname "$BIN_LINK")" ]; then
  ln -sf "$INSTALL_DIR/start.sh" "$BIN_LINK"
  ok "可以直接运行: medhorizon"
else
  BIN_LINK="$HOME/.local/bin/medhorizon"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/start.sh" "$BIN_LINK"
  ok "可以直接运行: $BIN_LINK"
  # 提示用户把 ~/.local/bin 加入 PATH（如果未加）
  if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    echo -e "${YELLOW}  提示: 请将以下行加入 ~/.bashrc 或 ~/.zshrc：${NC}"
    echo '    export PATH="$HOME/.local/bin:$PATH"'
  fi
fi

# ── 7. macOS 可选：创建应用程序快捷方式 ──────────────────────────
if [ "$PLATFORM" = "macos" ]; then
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
  ok "创建 macOS 应用: ~/Applications/MedHorizon.app"
fi

echo ""
echo -e "${GREEN}  安装完成！${NC}"
echo -e "${YELLOW}  首次启动会自动打开浏览器，引导你填写 API Key。${NC}"
echo ""
echo "  启动命令: medhorizon"
echo "  或运行:   $INSTALL_DIR/start.sh"
echo ""
