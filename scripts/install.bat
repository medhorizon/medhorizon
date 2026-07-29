@echo off
chcp 65001 >nul
echo.
echo   正在启动 MedHorizon 安装程序...
echo.
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
