# MedHorizon Windows 一键安装脚本
# 用法：在 PowerShell 中运行，或通过 install.bat 双击执行

param(
  [string]$InstallDir = "$env:LOCALAPPDATA\MedHorizon",
  [string]$Repo = "medhorizon/medhorizon"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "  → $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ╔══════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║    MedHorizon 安装程序         ║" -ForegroundColor Blue
Write-Host "  ╚══════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# ── 1. 确认安装目录 ─────────────────────────────────────────────
Write-Step "安装位置: $InstallDir"
if (!(Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# ── 2. 获取最新 Release ─────────────────────────────────────────
Write-Step "正在查询最新版本..."
try {
  $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
  $version = $release.tag_name
  $asset   = $release.assets | Where-Object { $_.name -like "medhorizon-windows-x64*" } | Select-Object -First 1
  if (!$asset) { Write-Err "未找到 Windows 版本文件，请检查 Release 是否已发布。" }
  Write-OK "找到版本: $version"
} catch {
  Write-Err "无法连接 GitHub，请检查网络连接。`n$_"
}

# ── 3. 下载 ────────────────────────────────────────────────────
$zipPath = "$env:TEMP\medhorizon-windows.zip"
Write-Step "正在下载 $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
Write-OK "下载完成"

# ── 4. 解压 ────────────────────────────────────────────────────
Write-Step "正在解压..."
Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
Remove-Item $zipPath -ErrorAction SilentlyContinue
# 确保可执行文件名为 medhorizon.exe
$exeSrc = Get-ChildItem $InstallDir -Filter "*.exe" | Select-Object -First 1
if ($exeSrc -and $exeSrc.Name -ne "medhorizon.exe") {
  Rename-Item $exeSrc.FullName "medhorizon.exe"
}
Write-OK "解压完成: $InstallDir\medhorizon.exe"

# ── 5. 创建启动脚本 ─────────────────────────────────────────────
$startBat = @"
@echo off
echo 正在启动 MedHorizon...
start "" "http://localhost:4096"
ping -n 2 127.0.0.1 >nul
"$InstallDir\medhorizon.exe"
"@
Set-Content "$InstallDir\start.bat" $startBat -Encoding UTF8
Write-OK "创建启动脚本"

# ── 6. 桌面快捷方式 ─────────────────────────────────────────────
$desktop = [Environment]::GetFolderPath("Desktop")
$shell   = New-Object -ComObject WScript.Shell
$sc      = $shell.CreateShortcut("$desktop\MedHorizon.lnk")
$sc.TargetPath       = "$InstallDir\start.bat"
$sc.WorkingDirectory = $InstallDir
$sc.Description      = "启动 MedHorizon AI 工作台"
$sc.WindowStyle      = 7   # 最小化窗口（后台运行）
$sc.Save()
Write-OK "创建桌面快捷方式: MedHorizon.lnk"

# ── 7. 版本记录 ─────────────────────────────────────────────────
Set-Content "$InstallDir\version.txt" $version

Write-Host ""
Write-Host "  安装完成！双击桌面的 [MedHorizon] 图标启动。" -ForegroundColor Green
Write-Host "  首次启动会自动打开浏览器，引导你填写 API Key。" -ForegroundColor Yellow
Write-Host ""
