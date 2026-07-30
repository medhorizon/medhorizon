# MedHorizon Windows one-click installer
# Run in PowerShell, or double-click install.bat

param(
  [string]$InstallDir = "$env:LOCALAPPDATA\MedHorizon",
  [string]$Repo = "medhorizon/medhorizon"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ==============================" -ForegroundColor Blue
Write-Host "  MedHorizon Installer" -ForegroundColor Blue
Write-Host "  ==============================" -ForegroundColor Blue
Write-Host ""

# 1. Install directory
Write-Step "Install dir: $InstallDir"
if (!(Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# 2. Latest release
Write-Step "Querying latest release..."
try {
  $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
  $version = $release.tag_name
  $asset   = $release.assets | Where-Object { $_.name -eq "medhorizon-windows-x64.zip" } | Select-Object -First 1
  if (!$asset) { Write-Err "Windows package not found. Check that the Release was published." }
  Write-OK "Found version: $version"
} catch {
  Write-Err "Cannot reach GitHub. Check your network.`n$_"
}

# 3. Download
$zipPath = "$env:TEMP\medhorizon-windows.zip"
Write-Step "Downloading $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
Write-OK "Download complete"

# 4. Extract
Write-Step "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
Remove-Item $zipPath -ErrorAction SilentlyContinue
$exeSrc = Get-ChildItem $InstallDir -Filter "*.exe" | Select-Object -First 1
if ($exeSrc -and $exeSrc.Name -ne "medhorizon.exe") {
  Rename-Item $exeSrc.FullName "medhorizon.exe"
}
Write-OK "Extracted: $InstallDir\medhorizon.exe"

# 5. Start script (ASCII + CRLF for cmd.exe)
$startBat = @"
@echo off
echo Starting MedHorizon...
start "" "http://localhost:4096"
ping -n 2 127.0.0.1 >nul
"$InstallDir\medhorizon.exe"
"@
$startPath = Join-Path $InstallDir "start.bat"
[System.IO.File]::WriteAllText($startPath, ($startBat -replace "`n","`r`n"), [System.Text.Encoding]::ASCII)
Write-OK "Created start script"

# 6. Desktop shortcut
$desktop = [Environment]::GetFolderPath("Desktop")
$shell   = New-Object -ComObject WScript.Shell
$sc      = $shell.CreateShortcut("$desktop\MedHorizon.lnk")
$sc.TargetPath       = "$InstallDir\start.bat"
$sc.WorkingDirectory = $InstallDir
$sc.Description      = "Launch MedHorizon AI workbench"
$sc.WindowStyle      = 7
$sc.Save()
Write-OK "Desktop shortcut: MedHorizon.lnk"

# 7. Version stamp
[System.IO.File]::WriteAllText((Join-Path $InstallDir "version.txt"), $version, [System.Text.Encoding]::ASCII)

Write-Host ""
Write-Host "  Install complete. Double-click the desktop MedHorizon shortcut to start." -ForegroundColor Green
Write-Host "  First launch opens the browser for API Key setup." -ForegroundColor Yellow
Write-Host ""
