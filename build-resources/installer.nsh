; 开机自启：往当前用户的「启动」文件夹放一份快捷方式。
; 安装是 oneClick + perMachine:false，因此 $SMSTARTUP 指向当前用户，无需管理员权限。
; 文件名用 ASCII，避免 NSIS 编译器对 .nsh 的编码敏感。

!macro customInstall
  CreateShortCut "$SMSTARTUP\Hands-off Dashboard.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\Hands-off Dashboard.lnk"
!macroend
