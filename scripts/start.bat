@echo off
chcp 65001 >nul
echo 正在启动 Medho...
start "" "http://localhost:4096"
ping -n 2 127.0.0.1 >nul
"%~dp0medho.exe"
