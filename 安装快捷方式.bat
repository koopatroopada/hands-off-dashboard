@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在创建桌面快捷方式和开机自启……
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-shortcuts.ps1"

echo.
pause
