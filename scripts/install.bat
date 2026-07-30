@echo off
chcp 65001 >nul
setlocal
echo.
echo   Starting MedHorizon installer...
echo.

set "PS1=%~dp0install.ps1"
if not exist "%PS1%" (
  echo   ERROR: install.ps1 missing. Use medhorizon-windows-installer.zip
  echo   https://github.com/medhorizon/medhorizon/releases/latest
  pause
  exit /b 1
)

if not exist "%~dp0medhorizon.exe" (
  echo   ERROR: medhorizon.exe missing next to install.bat.
  echo   This installer is a binary package. Do not download scripts alone.
  pause
  exit /b 1
)

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
