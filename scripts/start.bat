@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo Starting MedHorizon + Research Graph sidecar...

if exist "%~dp0research-graph.exe" (
  start "Research Graph" /MIN "%~dp0research-graph.exe"
  ping -n 3 127.0.0.1 >nul
)

start "" "http://localhost:4096"
ping -n 2 127.0.0.1 >nul
"%~dp0medhorizon.exe"
