@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js not found. Install Node.js 18 or newer, then run this again.
  echo Download: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node server.js
echo.
echo Server stopped.
pause
