@echo off
echo Starting MedHorizon...
cd /d "%~dp0"
start "" "http://localhost:4096"
ping -n 2 127.0.0.1 >nul
"%~dp0medhorizon.exe"
