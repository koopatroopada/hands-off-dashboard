@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在取消开机自启（桌面快捷方式保留）……
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-shortcuts.ps1" -Remove

echo.
pause
