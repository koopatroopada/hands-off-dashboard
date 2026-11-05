@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未找到 Node.js。请先安装 Node.js 18 或更高版本。
  echo 下载地址：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo 首次运行需要安装 Electron，约 350 MB，请稍候……
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo 安装失败。请检查网络后手动执行 npm install 再重试。
    echo.
    pause
    exit /b 1
  )
)

rem 某些 IDE / 终端会设置这两个变量，导致 Electron 退化成纯 Node 运行，
rem 此时 require('electron') 拿不到 app 和 BrowserWindow，窗口根本不会出现。
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=

start "" "node_modules\electron\dist\electron.exe" "desktop\main.js"

exit /b 0
