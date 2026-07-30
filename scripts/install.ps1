# MedHorizon Windows binary installer (offline).
# Requires medhorizon.exe next to this script. Copies Research Graph sidecar when present.

param(
  [string]$InstallDir = "$env:LOCALAPPDATA\MedHorizon"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$localExe = Join-Path $here "medhorizon.exe"
$rgExe = Join-Path $here "research-graph.exe"
$versionFile = Join-Path $here "VERSION"

Write-Host ""
Write-Host "  ==============================" -ForegroundColor Blue
Write-Host "  MedHorizon Installer" -ForegroundColor Blue
Write-Host "  ==============================" -ForegroundColor Blue
Write-Host ""

if (!(Test-Path $localExe)) {
  Write-Err "medhorizon.exe not found in $here. Use the binary installer zip from the Release."
}

$version = "unknown"
if (Test-Path $versionFile) {
  $version = (Get-Content -Raw $versionFile).Trim()
}

Write-Step "Install dir: $InstallDir"
if (!(Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Write-Step "Copying medhorizon.exe (offline, no download)..."
Copy-Item -Force $localExe (Join-Path $InstallDir "medhorizon.exe")
Write-OK "Installed: $InstallDir\medhorizon.exe"

if (Test-Path $rgExe) {
  Copy-Item -Force $rgExe (Join-Path $InstallDir "research-graph.exe")
  Write-OK "Installed Research Graph sidecar: $InstallDir\research-graph.exe"
}

$startBat = @"
@echo off
chcp 65001 >nul
cd /d "$InstallDir"
echo Starting MedHorizon + Research Graph sidecar...
if exist "$InstallDir\research-graph.exe" (
  start "Research Graph" /MIN "$InstallDir\research-graph.exe"
  ping -n 3 127.0.0.1 >nul
)
start "" "http://localhost:4096"
ping -n 2 127.0.0.1 >nul
"$InstallDir\medhorizon.exe"
"@
$startPath = Join-Path $InstallDir "start.bat"
[System.IO.File]::WriteAllText($startPath, ($startBat -replace "`n","`r`n"), [System.Text.Encoding]::ASCII)
Write-OK "Created start script"

$desktop = [Environment]::GetFolderPath("Desktop")
$shell   = New-Object -ComObject WScript.Shell
$sc      = $shell.CreateShortcut("$desktop\MedHorizon.lnk")
$sc.TargetPath       = "$InstallDir\start.bat"
$sc.WorkingDirectory = $InstallDir
$sc.Description      = "Launch MedHorizon AI workbench"
$sc.WindowStyle      = 7
$sc.Save()
Write-OK "Desktop shortcut: MedHorizon.lnk"

[System.IO.File]::WriteAllText((Join-Path $InstallDir "version.txt"), $version, [System.Text.Encoding]::ASCII)

Write-Host ""
Write-Host "  Install complete ($version). Double-click the desktop MedHorizon shortcut." -ForegroundColor Green
Write-Host "  Research Graph sidecar starts automatically with MedHorizon." -ForegroundColor Yellow
Write-Host ""
