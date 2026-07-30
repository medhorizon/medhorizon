@echo off
chcp 65001 >nul
setlocal
echo.
echo   Starting MedHorizon installer...
echo.

set "PS1=%~dp0install.ps1"
if not exist "%PS1%" (
  echo   install.ps1 not found. Downloading from GitHub Release...
  set "PS1=%TEMP%\medhorizon-install.ps1"
  curl -fsSL -o "%PS1%" "https://github.com/medhorizon/medhorizon/releases/latest/download/install.ps1"
  if errorlevel 1 (
    echo   Download failed. Get both install.bat and install.ps1 from:
    echo   https://github.com/medhorizon/medhorizon/releases/latest
    pause
    exit /b 1
  )
)

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
