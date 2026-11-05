# 创建「项目交接看板」桌面快捷方式 + 开机自启（启动文件夹）。
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1                # 安装
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1 -RemoveStartup # 只取消开机自启
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1 -Remove        # 全部删除param([switch]$Remove, [switch]$RemoveStartup)

$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$main     = Join-Path $root 'desktop\main.js'
$icon     = Join-Path $root 'assets\icon.ico'
$name     = '项目交接看板'
$desktop  = [Environment]::GetFolderPath('Desktop')
$startup  = [Environment]::GetFolderPath('Startup')
$desktopLnk = Join-Path $desktop "$name.lnk"
$startupLnk = Join-Path $startup "$name.lnk"

$shell = New-Object -ComObject WScript.Shell

if ($RemoveStartup) {
  if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force; Write-Host "已删除 $startupLnk" }
  else { Write-Host "启动项不存在，无需处理" }
  exit 0
}

if ($Remove) {
  foreach ($t in @($desktopLnk, $startupLnk)) {
    if (Test-Path $t) { Remove-Item $t -Force; Write-Host "已删除 $t" }
    else { Write-Host "不存在 $t" }
  }
  exit 0
}

if (-not (Test-Path $electron)) {
  Write-Host "未找到 $electron，请先在项目目录执行 npm install"
  exit 1
}

foreach ($t in @($desktopLnk, $startupLnk)) {
  $lnk = $shell.CreateShortcut($t)
  $lnk.TargetPath       = $electron
  $lnk.Arguments        = '"' + $main + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation     = "$icon,0"
  $lnk.Description       = 'Hands-off Dashboard 桌面组件（不占任务栏，右键可退出）'
  $lnk.Save()
  Write-Host "已创建 $t"
}

Write-Host ''
Write-Host '完成：桌面双击即可启动；开机后会自动出现在桌面上。'
Write-Host '组件本身不占任务栏，退出用右键菜单里的「退出」，或 Ctrl+Alt+Q。'
