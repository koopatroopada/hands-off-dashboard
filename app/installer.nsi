; Hands-off Dashboard · 一键安装包
; 免 UAC、装到当前用户目录、装完立刻启动，附桌面/开始菜单快捷方式、
; 开机自启与卸载入口；缺 WebView2 运行时时静默补齐。

Unicode true
SetCompressor /SOLID lzma

!define APP_NAME       "Hands-off Dashboard"
!define APP_EXE        "Hands-off-Dashboard.exe"
!define APP_VERSION    "1.1.0"
!define APP_PUBLISHER  "Hands-off Dashboard"
!define UNINST_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\HandsOffDashboard"
!define WV2_CLIENT_ID  "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

Name "${APP_NAME}"
OutFile "build\Hands-off-Dashboard-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Hands-off Dashboard"
InstallDirRegKey HKCU "Software\Hands-off Dashboard" "InstallDir"
RequestExecutionLevel user
BrandingText "${APP_NAME} ${APP_VERSION}"
Icon "..\assets\icon.ico"
UninstallIcon "..\assets\icon.ico"
AutoCloseWindow true
SilentUninstall silent
ShowInstDetails hide
ShowUninstDetails hide

VIProductVersion "1.1.0.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright"  "${APP_PUBLISHER}"

; ── 安装（无向导页，双击即装）──────────────────────────────
Section "Install"
  SetShellVarContext current
  ; 升级安装时先结束正在运行的实例，避免覆盖 exe 失败
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  File /oname=${APP_EXE} "hs-dashboard.exe"
  File "..\index.html"
  File "..\config.json"
  File /oname=icon.ico "..\assets\icon.ico"
  File "build\MicrosoftEdgeWebview2Setup.exe"
  SetOutPath "$INSTDIR\ui"
  File "..\ui\preload.js"
  SetOutPath "$INSTDIR\examples"
  File /r "..\examples\*.*"
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 快捷方式
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMSTARTUP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0

  ; 卸载入口
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\Hands-off Dashboard" "InstallDir" "$INSTDIR"

  ; WebView2 运行时：缺失时用随包附带的官方引导程序静默补齐
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WV2_CLIENT_ID}" "pv"
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WV2_CLIENT_ID}" "pv"
  ReadRegStr $2 HKCU "Software\Microsoft\EdgeUpdate\Clients\${WV2_CLIENT_ID}" "pv"
  StrCmp $0 "" 0 wv2_ready
  StrCmp $1 "" 0 wv2_ready
  StrCmp $2 "" 0 wv2_ready
    DetailPrint "未检测到 WebView2 运行时，正在安装（约 100 MB，需要联网）..."
    ExecWait '"$INSTDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
  wv2_ready:
  Delete "$INSTDIR\MicrosoftEdgeWebview2Setup.exe"

  ; 装完立刻启动，组件直接出现在桌面
  Exec '"$INSTDIR\${APP_EXE}"'
SectionEnd

; ── 卸载 ───────────────────────────────────────────────────
Section "Uninstall"
  SetShellVarContext current
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0

  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMSTARTUP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Hands-off Dashboard"

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\index.html"
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\ui\preload.js"
  RMDir "$INSTDIR\ui"
  RMDir /r "$INSTDIR\examples"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
