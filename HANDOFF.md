Audience: 我自己（单机自用的项目交接看板 + 常驻桌面组件），以及拿到安装包就能直接用的 Windows 用户
Why: 同时维护多个项目，每个项目结束会话时留一份 HANDOFF.md，想要一个常驻桌面、一眼看清各项目进度和下一步的看板
Stages: 网页看板 → 桌面组件 → 数据源统一 → 安装包分发 → 日常常驻
Current: 日常常驻
Evidence: GitHub Release v1.0.0 的 Hands-off-Dashboard-Setup-1.0.0.exe（4.60 MB），下载双击即装，无需管理员权限
Gate: 连续一周开机自启都正常显示卡片，且至少一位外部用户不看 README 也能独立装好
Blocker: 还没有外部用户实际安装过；仓库也没有 LICENSE
Next-Determined: DETERMINED
Next: 补一份 MIT LICENSE，并把安装包链接交给第一位外部用户试用
Created: 2026-11-03
Last-Activity: 2026-11-15

# Handoff: 仓库收敛为单一桌面版本，安装包发布为 Release

生成时间：2026-11-15 16:50

## Current state

### 仓库现在只有一套实现

用户明确要「只保留一个版本、主推用户友好」，所以把早期的 Electron 宿主和 Node 网页看板整套移出仓库，只留 Go + 系统 WebView2 的桌面组件。目录与产物同时去掉了所有 `lite` / `Lite` 字样：

| 原来 | 现在 |
| --- | --- |
| `lite/*.go`、`lite/go.mod`、`lite/installer.nsi` | `app/` |
| `desktop/preload.js` | `ui/preload.js` |
| `scripts/build-lite.js`、`npm run dist:lite` | `scripts/build.js`、`npm run dist` |
| `hs-lite.exe` | `hs-dashboard.exe` |
| `Hands-off-Dashboard-Lite-Setup-1.0.0.exe` | `Hands-off-Dashboard-Setup-1.0.0.exe` |
| 卸载注册表 `HandsOffDashboardLite` | `HandsOffDashboard` |

删掉的文件：`desktop/main.js`、`electron-builder.yml`、`build-resources/installer.nsh`、`scripts/build-installer.js`、`scripts/install-shortcuts.ps1`、`scripts/make-icon.js`、`server.js`、`lib/handoff.js`、`test/handoff.test.js`、`build-demo.js`、`design-spec.html`、`package-lock.json`、三个 `.bat` 快捷方式脚本。`package.json` 现在**零依赖**，只留 `dist` 一个脚本。

保留的运行时文件只有 5 类：`index.html`（单文件界面）、`config.json`、`ui/preload.js`、`assets/icon.ico`、`examples/` 三份虚构数据 —— 安装器把它们和 exe 一起打包。

本机 `lite/` 里 1100 个旧测试临时文件（73 MB）没有删除，整体归档在 `.workbuddy/archived-tests/lite-scratch/`（已被 .gitignore 忽略，不进仓库）。想释放空间可以直接删这个目录。

### 代码跟着改的地方（容易漏）

- `ui/preload.js` 删掉 `require('electron')`，改为注释说明 `ipcRenderer` 由宿主注入；`app/server.go` 同步删掉那个正则替换，路径从 `desktop/preload.js` 改成 `ui/preload.js`，`body := string(src)` 直接拼接。
- `app/go.mod` 的 module 名、窗口类名 `hs-dashboard-window`、单实例 mutex `Local\HandsOffDashboard`、日志 `dashboard.log`、探针工具里的类名，全部同步改了名。
- `app/installer.nsi` 的安装段改为 `SetOutPath "$INSTDIR\ui"` + `File "..\ui\preload.js"`，**卸载段**也要同步改成 `$INSTDIR\ui`，否则卸载会残留目录。
- 各 `.go` 文件头部的「与某实现等价 / 复刻某文件」注释改成描述自身行为；`app/state.go` 里从 `%APPDATA%/Electron/` 迁移旧状态的兼容逻辑保留（路径字符串不能改，否则迁移失效）。

### 构建与验证

- `npm run dist` → `app/build/Hands-off-Dashboard-Setup-1.0.0.exe`，**4.60 MB**（4,828,145 字节），NSIS 全程无报错。Go 宿主 exe 9.1 MB。
- 构建脚本 `scripts/build.js` 会用 `os.homedir()` 拼几个 NSIS 常见路径，最后 fallback 到 PATH 里的 `makensis`；`GO_BIN` / `GOPATH_DIR` / `NSIS_MAKENSIS` 可覆盖。
- **改路径后最容易踩的回归**：如果 `ui/preload.js` 没被读到，看板会因为缺 `OVERRIDE_CSS`（`shellOpacity: 1` 的不透明白外壳）整体变深色。已用开发模式冒烟实测排除：`/__hs/bridge.js` 返回 15,751 字节、含 `hs-desktop-style` 标记、零残留 `require('electron')`，页面正确注入 `<script src="/__hs/bridge.js">`，`/api/projects` 返回 3 张卡，日志显示透明背景与两个热键都注册成功。测试进程已结束。

### Release

- tag `v1.0.0`，asset `Hands-off-Dashboard-Setup-1.0.0.exe`，直链写在 README 的「下载安装」里：`https://github.com/koopatroopada/hands-off-dashboard/releases/download/v1.0.0/Hands-off-Dashboard-Setup-1.0.0.exe`。
- README 已重写成面向使用者的单一叙事：为什么 → 下载双击 → 它做什么 → 日常操作 → 写 HANDOFF.md → 自己构建 → 目录 → 常见问题。全文不出现「轻量版 / Electron / 双方案对比」。

### 技术要点（改动前务必读）

- **桌面层 Z 序**：`SetWindowPos` 的锚点必须是「Z 序紧挨 Progman 之上的那个窗口」（`GetWindow(progman, GW_HWNDPREV)`，同 band）。直接以 Progman 作锚点会被 z-band 规则静默拒绝（返回 TRUE 但不动）；`SetParent` 挂 Progman 会让透明合成失效露灰底。**Win+D 是把 Progman 提到前面**，组件掉到它后面，只能事后纠正：50 ms 巡护一次，在位时一次 `GetWindow` 比较即跳过。
- **透明**：`ICoreWebView2Controller2` 的 vtable 是 `ICoreWebView2Controller` 的超集，用 `unsafe.Pointer` 强转后调 `PutDefaultBackgroundColor(A:0)`，配合 `WS_EX_LAYERED`。窗口必须保持顶层。
- **拖动**：用 `screenX/screenY` 位移 + `SetWindowPos(..., SWP_NOSIZE|SWP_NOZORDER)` 只改坐标；`setBounds` 在 150% 缩放下会累积取整漂移。`focusable:false`（`WS_EX_NOACTIVATE`）会让 Chromium 丢 `pointerdown`，拖动/菜单/滑条会同时失灵。
- **NSIS**：`File /oname=` 不能带引号（所以 exe 名无空格）；路径含中文时 `.nsi` 必须带 UTF-8 BOM；Git Bash 会把 `/INPUTCHARSET` 当路径转换，不可用。`SilentUninstall silent` 让默认卸载也免交互。
- **诊断工具** `app/tools/probe` 是 DPI 不感知进程，`GetWindowRect` 返回虚拟化坐标（1002×662 @150%），别误判成 DPI bug；以宿主自身日志（1503×993 物理）为准。贴底巡护每 50 ms 会撤销「临时置顶」，截图要 `HS_NO_ATTACH=1`。
- Go 的 `time.Format` 截断毫秒，JS `toISOString()` 四舍五入，`app/data.go` 的 `isoTime()` 手动补了这半毫秒。
- 从 Bash 用 `&` 启动的 exe 会随父 shell 退出被连带杀掉，看起来像「应用自己退出」；用后台任务方式启动才稳定。`taskkill` 在 Git Bash 里要加 `MSYS_NO_PATHCONV=1`，否则 `/F` 会被转成 `F:/`。

### 网络与推送

`github.com` 的 git 通道**间歇性可用**（曾成功过 `git push`，也反复出现 `CONNECT tunnel failed 502` / `Empty reply` / `schannel: server closed abruptly`），`api.github.com` 始终稳定。绕开代理直连 `github.com:443` 不通。备用脚本 `.workbuddy/gh-mirror.js`（被 .gitignore 忽略）用法 `node .workbuddy/gh-mirror.js <commit>`：走 Git Data API 逐条镜像，凭据从 Windows 凭据管理器动态读取，命令里不出现明文 PAT，SHA 与本地完全一致。

## Next steps

1. **补 LICENSE**：现在没有许可证等于默认保留所有权利，和对外推广的口径不一致。MIT 最省事。
2. **吊销那个 PAT**：`ghp_...` 在会话里明文出现过，去 GitHub Settings → Developer settings 删掉换新的。
3. **找第一位外部用户试用**：不看 README、只给安装包链接，确认能独立双击装好并看到卡片。
4. **日常常驻观察**：开机自启连跑一周，确认 Win+D、热键、重启后位置记忆都稳定。
5. 收尾小事：`ui` / `workbuddy/main-622ca596` 两条旧分支可以删；本地 `dist/`、`demo/` 是历史残留，被 .gitignore 挡着。

## Relevant artifacts

- `app/` — Go 桌面宿主全部源码；`app/installer.nsi` 一键安装脚本
- `scripts/build.js` — `npm run dist`，编译 → WebView2 引导程序 → NSIS
- `ui/preload.js` — 桌面态样式注入、右键面板、两个不透明度滑块、拖动
- `index.html` — 单文件界面；`config.json` 默认工作目录；`examples/` 示例项目
- `app/tools/probe`、`app/tools/shot` — z-order 诊断与 GDI 截屏
- <https://github.com/koopatroopada/hands-off-dashboard>

## Suggested skills

- handoff — 会话结束时覆盖更新本文件
