@echo off
chcp 65001 >nul
setlocal
echo.
echo   正在启动 MedHorizon 安装程序...
echo.

set "PS1=%~dp0install.ps1"
if not exist "%PS1%" (
  echo   未找到 install.ps1，正在从 GitHub Release 下载...
  set "PS1=%TEMP%\medhorizon-install.ps1"
  curl -fsSL -o "%PS1%" "https://github.com/medhorizon/medhorizon/releases/latest/download/install.ps1"
  if errorlevel 1 (
    echo   下载失败。请同时下载 install.bat 与 install.ps1 后重试。
    echo   https://github.com/medhorizon/medhorizon/releases/latest
    pause
    exit /b 1
  )
)

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
