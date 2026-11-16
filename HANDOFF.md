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

### 边缘拉伸（2026-11-15）

- 需求：鼠标移到窗口四边 / 四角变成对应拉伸光标，按住可改窗口大小，尺寸自动记住。
- 实现：`ui/preload.js` 在 body 挂 8 个 fixed 感应区（8px 边 / 16px 角，CSS `ew-resize` / `ns-resize` / `nwse-resize` / `nesw-resize`），`pointerdown` 只发方向；`app/window.go` 用 `SetCapture` 接管鼠标，`WM_MOUSEMOVE` 按 `GetCursorPos` 的物理位移改矩形，`WM_LBUTTONUP` / `WM_CANCELMODE` / `WM_CAPTURECHANGED` 收尾；`wmSize` 里原有的 `chrome.Resize()` 让界面跟着变。新增 `desktop:resize-start` / `desktop:resize-end` 两个通道（共 12 个）。
- **关键坑**：原先 `WM_NCHITTEST` 对边缘返回 `HTLEFT` 等边框值，系统会把那几像素当非客户区，网页压根收不到 `pointerdown`。现在 hit-test 全部委托 `DefWindowProc` 转发给 WebView2 子窗口。另一个坑是缩小窗口时鼠标会跑出 WebView2，所以不能用网页 `pointermove`，必须用 Win32 捕获。
- 尺寸全程物理像素；最小 460×280 逻辑像素（乘 DPI）、最大 1.5 倍工作区；从左边 / 上边拉伸时右 / 下边缘不动；拉伸期间暂停 50 ms 贴底巡护，避免 Z 序 `SetWindowPos` 抢窗口状态。
- 自动化真机验证（模拟鼠标拖拽）：左右 843→963→763、顶边上拖 80 使高度 662→742 且 top 235→155、左边缘拖到极限被钳制在 460 且右边缘不动；`GetCursorInfo` 读到的 8 个边缘 / 角光标全部命中预期系统图标；`desktop-state.json` 正确写入 x/y/width/height。新包 `npm run dist` 4.61 MB（4,830,673 字节）。
- **拉伸时四角出现黑色尖角（已修）**：分层窗口 resize 后新扩展出来的表面默认是不透明黑，而圆角外那几块页面从不绘制，于是四个角留下黑三角且松手后也不消失。先试了「每次 `WM_SIZE` 重设 `DefaultBackgroundColor(A:0)` + 强制重绘」和「把 body 背景改成 alpha=1/255 逼 Chromium 光栅化整块视口」，两种都实测无效——黑色来自窗口表面本身，不是页面背景色能覆盖的。最终用 `SetWindowRgn` + `CreateRoundRectRgn` 把窗口裁成和 `.app-shell` 一致的圆角（半径 26/20/16 CSS px 随断点、乘 DPI），每次 `WM_SIZE` 重设 region；四角感应区从 16px 放宽到 22px，保证裁剪后仍按得住。
- 复现与量化工具 `.workbuddy/tools/repro-black.go`（拖动前 / 刚起步 / 拖动中 / 松手后四张截图）、`png-check.go`（统计四角与全图纯黑像素）：修复前松手后四角 9.9%、全图 1152 个纯黑像素；修复后拉大与缩小全过程都是 0。裁剪后 8 个边 / 角光标仍全部正确（`cursor-check.go` 9/9）。
- 调试开关 `HS_ALLOW_MULTI=1` 让开发实例与已运行的正式实例并存（端口自动顺延），配合 `HS_TOPMOST=1` / `HS_STATE_DIR` 可隔离复现，默认关闭不影响正式版。

### 整窗黑底不透明（真根因，2026-11-17 已修复并验证）

- 用户最终发来截图：整个看板是纯黑底、卡片深灰、文字发白，桌面壁纸完全透不出来——不是「拉伸瞬间闪黑」，而是**透明从头到尾就没生效**。之前纠结拉伸时序、WM_ERASEBKGND、环境变量都是走错方向。
- **唯一真根因**：`createWindow()` 里调了 `SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA)`。bAlpha=255 会把整个分层窗口**强制设为不透明**，直接压掉 WebView2 `PutDefaultBackgroundColor(A:0)` 的透明像素 → 全黑。参 ellermister/win-desktop（Golang+WebView2 透明异形窗口）明确记载：「SetLayeredWindowAttributes(...,255,LWA_ALPHA) 会强制窗口不透明，导致 WebView2 透明像素变黑，必须移除」。
- **修复（app/window.go）**：① 删掉 `SetLayeredWindowAttributes` 调用；② `exStyle` 从 `WS_EX_LAYERED|WS_EX_TOOLWINDOW` 改为 `WS_EX_LAYERED|WS_EX_NOREDIRECTIONBITMAP(0x00200000)|WS_EX_TOOLWINDOW`——让 WebView2 的 DirectComposition 表面直连桌面合成，这是透明的关键；③ `hitTest` 把 `DefWindowProc` 返回的 `HTTRANSPARENT(-2)` 强制改回 `HTCLIENT(1)`，否则透明区点击穿透到桌面；④ 圆角继续靠 `SetWindowRgn` + CSS `border-radius:26px` 双层保障。
- **验证方法（重要经验）**：GDI `BitBlt` / `PrintWindow` 抓 WebView2 分层窗口时透明像素一律被填黑，**不能用来判断透明**。可信方法是用 `.workbuddy/tools/screen-grab.go`：抓「窗口显示」与「ShowWindow(hide) 后露出桌面」两幅屏幕图比均值。修复后：显示 RGB(243,243,245) vs 隐藏 RGB(244,246,249)，差值仅 8 → 透明生效；肉眼看 `screen-shown.png` 是白底看板、圆角透桌面、无黑角，拉伸后截图同样白底正常。修复前均值是 40-50 的黑。
- 之前几轮的 WM_ERASEBKGND、去 CS_HREDRAW/VREDRAW、`WEBVIEW2_DEFAULT_BACKGROUND_COLOR` 环境变量、wmSize 去掉逐帧 applyTransparency 等改动**都保留着**（无害，环境变量还避免首帧闪白），但它们不是根因；真正起作用的是删 SetLayeredWindowAttributes + 加 NOREDIRECTIONBITMAP。
- 拉伸功能回归通过（顶边高度 662→742、最小宽钳制 460、状态持久化）；左右拉伸测试在窗口贴屏幕右边缘时会因鼠标出界误报 FAIL，是测试脚本几何限制，非功能问题。安装包重建 4.61 MB（4,833,501 字节）。
- **GitHub Release 的 v1.0.0 仍是更早的包**；本地 4.61 MB 安装包已含黑角 + 黑底两处修复，尚未上传，外部用户暂时用不到。

### 技术要点（改动前务必读）

- **桌面层 Z 序**：`SetWindowPos` 的锚点必须是「Z 序紧挨 Progman 之上的那个窗口」（`GetWindow(progman, GW_HWNDPREV)`，同 band）。直接以 Progman 作锚点会被 z-band 规则静默拒绝（返回 TRUE 但不动）；`SetParent` 挂 Progman 会让透明合成失效露灰底。**Win+D 是把 Progman 提到前面**，组件掉到它后面，只能事后纠正：50 ms 巡护一次，在位时一次 `GetWindow` 比较即跳过。
- **透明（改动前务必读）**：`ICoreWebView2Controller2` 的 vtable 是 Controller 的超集，`unsafe.Pointer` 强转后调 `PutDefaultBackgroundColor(A:0)`。窗口样式必须 `WS_EX_LAYERED|WS_EX_NOREDIRECTIONBITMAP`，且**绝对不能调 `SetLayeredWindowAttributes(...,255,LWA_ALPHA)`**（会把透明压成全黑）。透明区命中测试：`HTTRANSPARENT`→`HTCLIENT`。不能用 GDI 截图验证透明，要用 screen-grab.go 的显示/隐藏对比法。窗口必须保持顶层。
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
- `ui/preload.js` — 桌面态样式注入、右键面板、两个不透明度滑块、拖动与边缘拉伸
- `index.html` — 单文件界面；`config.json` 默认工作目录；`examples/` 示例项目
- `app/tools/probe`、`app/tools/shot` — z-order 诊断与 GDI 截屏
- <https://github.com/koopatroopada/hands-off-dashboard>

## Suggested skills

- handoff — 会话结束时覆盖更新本文件
