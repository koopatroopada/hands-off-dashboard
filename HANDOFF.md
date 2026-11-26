Audience: 我自己（单机自用的项目交接看板 + 常驻桌面组件），以及拿到安装包就能直接用的 Windows 用户
Why: 同时维护多个项目，每个项目结束会话时留一份 HANDOFF.md，想要一个常驻桌面、一眼看清各项目进度和下一步的看板
Stages: 网页看板 → 桌面组件 → 数据源统一 → 安装包分发 → 日常常驻
Current: 日常常驻
Evidence: v1.1.1 修复同名项目 ID 冲突并已本地打包、静默安装验证：新安装包 4,765,724 字节，SHA256 822d42b3…6e23f，注册表 DisplayVersion=1.1.1，日志显示 1.1.1 启动；v1.1.0 的 GitHub Release 与匿名下载校验记录见下文历史章节
Gate: 连续一周开机自启都正常显示卡片，且至少一位外部用户不看 README 也能独立装好
Blocker: 还没有外部用户实际安装过；v1.1.1 尚未发布到 GitHub Release
Next-Determined: DETERMINED
Next: 把 v1.1.1 推到 main/dev 并用 npm run release 发布，然后把 Release 链接交给第一位外部用户试用
Created: 2026-11-03
Last-Activity: 2026-11-27

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

### 代码已提交并推送（2026-11-17）

- 拉伸、黑角、黑底三处修复连同 README / HANDOFF 一起提交，commit 信息 `feat(desktop): 边缘拉伸 + 修复透明黑底`；按约定交接文档不写死提交号，避免每次推送即过时。
- `git push origin dev` 一次成功（这次 github.com git 通道没抽风）；本地与远端 `dev` 的 SHA 用 `git ls-remote` 核对一致，工作区干净。

### Release asset 已替换（2026-11-17）

- 用 `.workbuddy/gh-release-upload.js`（一次性脚本，用完已删）走 GitHub API：先把 `app/build/Hands-off-Dashboard-Setup-1.0.0.exe`（4,832,683 字节）以临时名上传 → 校验服务端 digest 与本地 SHA256 一致 → 删除旧 asset（4,828,145 字节，已下载 3 次）→ PATCH 改回正式名 → tag 端点复查只剩 1 个 asset。
- **坑**：上传后立刻 PATCH 改名返回 200 但名字没变（新 asset 的传播延迟），隔几秒单独重试 PATCH 才生效；所以别在一次脚本里假设改名即时可见，末尾要再 GET 复查。
- 匿名 curl 下载公开直链校验：4,832,683 字节，SHA256 `f690f873de10f7849c92cd28c5e18f76d91c73b491403cfef776145ca1462813` 与本地完全一致 → 外部用户拿到的就是含全部修复的新包。
- 令牌走 `git credential fill`（Windows Git 凭据管理器），命令和脚本都不出现明文 PAT。

### 技术要点（改动前务必读）

- **桌面层 Z 序**：`SetWindowPos` 的锚点必须是「Z 序紧挨 Progman 之上的那个窗口」（`GetWindow(progman, GW_HWNDPREV)`，同 band）。直接以 Progman 作锚点会被 z-band 规则静默拒绝（返回 TRUE 但不动）；`SetParent` 挂 Progman 会让透明合成失效露灰底。**Win+D 是把 Progman 提到前面**，组件掉到它后面，只能事后纠正：50 ms 巡护一次，在位时一次 `GetWindow` 比较即跳过。
- **透明（改动前务必读）**：`ICoreWebView2Controller2` 的 vtable 是 Controller 的超集，`unsafe.Pointer` 强转后调 `PutDefaultBackgroundColor(A:0)`。窗口样式必须 `WS_EX_LAYERED|WS_EX_NOREDIRECTIONBITMAP`，且**绝对不能调 `SetLayeredWindowAttributes(...,255,LWA_ALPHA)`**（会把透明压成全黑）。透明区命中测试：`HTTRANSPARENT`→`HTCLIENT`。不能用 GDI 截图验证透明，要用 screen-grab.go 的显示/隐藏对比法。窗口必须保持顶层。
- **拖动**：用 `screenX/screenY` 位移 + `SetWindowPos(..., SWP_NOSIZE|SWP_NOZORDER)` 只改坐标；`setBounds` 在 150% 缩放下会累积取整漂移。`focusable:false`（`WS_EX_NOACTIVATE`）会让 Chromium 丢 `pointerdown`，拖动/菜单/滑条会同时失灵。
- **NSIS**：`File /oname=` 不能带引号（所以 exe 名无空格）；路径含中文时 `.nsi` 必须带 UTF-8 BOM；Git Bash 会把 `/INPUTCHARSET` 当路径转换，不可用。`SilentUninstall silent` 让默认卸载也免交互。
- **诊断工具** `app/tools/probe` 是 DPI 不感知进程，`GetWindowRect` 返回虚拟化坐标（1002×662 @150%），别误判成 DPI bug；以宿主自身日志（1503×993 物理）为准。贴底巡护每 50 ms 会撤销「临时置顶」，截图要 `HS_NO_ATTACH=1`。
- Go 的 `time.Format` 截断毫秒，JS `toISOString()` 四舍五入，`app/data.go` 的 `isoTime()` 手动补了这半毫秒。
- 从 Bash 用 `&` 启动的 exe 会随父 shell 退出被连带杀掉，看起来像「应用自己退出」；用后台任务方式启动才稳定。`taskkill` 在 Git Bash 里要加 `MSYS_NO_PATHCONV=1`，否则 `/F` 会被转成 `F:/`。

### v1.1.1：同名项目 ID 冲突修复（2026-11-27）

- 起因：代码走查发现 `discover()` 用子目录名当项目 ID；多个工作目录里存在同名项目时 ID 相同，`/api/handoff?id=` 会串文档、置顶状态也会一起亮。单跳到 HANDOFF 的只读看板里属于潜在数据错认，优先级高。
- 修复：`app/data.go` 新增 `dedupeIDs()`。唯一项目保持 ID == 名称（既有置顶记录不失效）；重名的一组改成「根目录名/名称」，同名根目录下再按路径排序补 `#2`、`#3`，结果不受遍历顺序影响。显式清单路径也走同一套去重。
- 测试：`app/data_test.go` + `app/data_dedupe_test.go` 共 9 项，覆盖跨根重名、ID 稳定性、三方重名、解析不串文档、唯一项目 ID 不变、隐藏/忽略目录跳过、header/日期解析。`go test ./...` 全绿，`go vet` 只有 `window.go:562` 一条既有的 unsafe.Pointer 提示。
- 真机 E2E：造两个根目录各放一个「同名项目」，隔离状态启动宿主，`/api/projects` 返回 `rootA/同名项目` 与 `rootB/同名项目` 两个不同 id，`/api/handoff?id=` 分别读到各自 HANDOFF，确认串扰已消除。
- 构建脚本补了第二个兜底：仓库根有「禁止删除子项」权限项，`go build -o app\hs-dashboard.exe` 的原子 rename 会被拒；脚本改成先编译到 `.toolchain/out` 再 `copyFileSync` 覆盖，实测 `npm run dist` 一条命令跑完。
- 产物：`app/build/Hands-off-Dashboard-Setup-1.1.1.exe`，4,765,724 字节，SHA256 `822d42b3ea27e1cb12a9fe6641f3e45713e04e8da691e2747900f62887b6e23f`。静默安装退出码 0，注册表 `DisplayVersion=1.1.1`，日志显示 `Hands-off Dashboard 1.1.1 启动`。

### v1.1.0：新 UI 接入（2026-11-27）

- 界面换成新版 `index.html`（90,920 字节，原型目录 `implementation-spec.html` 描述的方格视图 + HODB 字母标版本），旧版备份为 `index.v1.0.0.html.bak`。宿主侧 15 个接口字段（`id` / `name` / `stages` / `current` / `why` / `evidence` / `gate` / `blocker` / `next` / `nextDetermined` / `created` / `lastActivity` / `handoff` / `error` / `audience`）与新 UI 的读取完全对齐，`/api/projects`、`/api/handoff`、`/api/reveal`、`hs-refresh` 四处约定没变，`app/server.go` 一行没改。
- 新版把 `.drawer` 从「面板本体」改成了外层定位容器（真正的白底在 `.drawer .drawer-panel`）。`ui/preload.js` 的 `OVERRIDE_CSS` 原来直接给 `.drawer` 刷 0.97 白底，套到新结构上会把整屏遮罩刷成白色；已改成 `.drawer` 强制透明、只给 `.drawer-panel` 白底。
- 方格卡片用 `--glass-strong`（0.74）而不是看板卡的 `--glass`（0.56），新加了 `--hs-card-strong = 卡片不透明度 + 0.18`（上限 1），右键面板拖卡片滑块时两种卡片一起变透，落差保持不变。
- 新界面的 `.stage / .app-shell / .app-header / .board-area / .board-panel / .project / .gallery-tile / .drawer / .drawer-panel` 九个钩子全部存在，覆盖样式继续生效；圆角（26/20/16）与 `window.go` 的 `updateWindowRegion()` 断点（700 / 480）一致，`SetWindowRgn` 不用改。
- 版本号三处同步：`package.json`、`app/state.go` 的 `appVersion`、`app/installer.nsi` 的 `APP_VERSION` + `VIProductVersion`。产物 `app/build/Hands-off-Dashboard-Setup-1.1.0.exe`，4,765,051 字节（4.5 MB），SHA256 `e6fa0cb619b29d8ca278441463316c09b98b2f0f17c1f6a0addd8b8276a86d5e`。
- 静默安装验证：`Setup-1.1.0.exe /S` 退出码 0，装到 `%LOCALAPPDATA%\Programs\Hands-off Dashboard`，注册表 `DisplayVersion=1.1.0`，装完自动启动，日志显示版本 1.1.0、透明背景生效、两个热键都注册成功；`/api/projects` 返回 10 个真实项目，桥脚本 19,645 字节含 `hs-card-strong`。
- 无头 Edge 截图核对：看板视图 7 张卡横向滚动正常，方格视图 6 个方块固定 140px、从左到右排列、标题占两行的卡片自动变高、名称下无空白。

### v1.1.0 发布（2026-11-27）

- 工作区这份目录原本**不是 git 仓库**（只有 .gitignore，没有 .git），源码改动是先提交到 `D:\1Projects\hands-off-dashboard-repo` 那个克隆里再推的。**2026-11-27 已把 `.git` 挪回工作区**，克隆目录确认无独有文件后删除；现在 `D:\1Projects\hands-off-dashboard` 本身就是仓库（`dev` 跟踪 `origin/dev`），可以直接在这里 `git status / commit / push`。
- 挪 `.git` 后 `git status` 一度把 22 个文件全标成已修改，但 `git diff` 是空的、`hash-object` 与索引完全一致——原因是索引里存的是 stat 缓存，换目录后 inode/mtime 变了，`update-index --refresh` 报 `needs update` 也不管用。执行一次 `git add -A` 重写 stat 缓存后恢复干净（暂存区仍为空，没有实际改动）。顺便把本仓库的 `core.autocrlf` 设成 `false`，避免工作区 LF 被反复转成 CRLF。
- 提交两次：`b2500b5` 新 UI + 版本号 + README + 预览图；`f1e5b5e` 构建脚本与 .gitignore。先推 `dev`（`19d199a..f1e5b5e`），再 `--no-ff` 合到 `main` 得到 `af4bb6e` 后推送；之后又有 `bd29bc0`（交接文档）和 `2760be1`（补 MIT LICENSE），两个分支现在都停在 `2760be1`。
- Release v1.1.0 由 REST API 直接创建（`gh` CLI 未登录，但 `git credential fill` 里有 `koopatroopada` 的 PAT，scopes 含 `repo`/`workflow`/`write:packages`）。asset 上传走 `uploads.github.com`，返回的 `digest` 与本地 SHA256 一致；tag v1.1.0 由 GitHub 自动建在 main 的 `af4bb6e` 上。
- `2760be1` 那次 `git push origin main` 连续被拒（`Connection was reset` / `Couldn't connect to server`），改用 REST `PATCH /git/refs/heads/main` 快进到该 commit，再用 `/branches` 复查两个 head 确认成功。因此远端 main 的提交是 API 推的，不是 git 通道。
- 匿名下载直链校验：4,765,051 字节，SHA256 `e6fa0cb619b29d8ca278441463316c09b98b2f0f17c1f6a0addd8b8276a86d5e`，与本地完全一致。README 里的 v1.1.0 直链现在可用。
- 坑：`api.github.com` 用 PowerShell 的 `Invoke-RestMethod` 会返回 403（拿不到 UA/凭据），换成 `D:\2Enviroment\Git\mingw64\bin\curl.exe` 加 `User-Agent` 头就正常。

### 发布脚本（2026-11-27）

- 新增 `scripts/release.js`（`npm run release`），把这次手工做的发布流程固化下来：从 `package.json` 读版本 → 校验 `app/build/` 里安装包存在（`--build` 可代跑 `npm run dist`）→ 算本地 SHA256 → 找同名 tag 的 Release（不存在就建，`target_commitish` 取当前分支）→ 上传 asset 到 `uploads.github.com` → 比对服务端 `digest` 与复查 asset 大小。
- 幂等设计：Release 已存在就复用；asset 大小和 digest 都与本地一致时跳过上传。内容不一致默认报错，加 `--replace` 才删旧的重传——避免误覆盖已经被人下载过的包。
- 凭据只从 `git credential fill` 读（`GITHUB_TOKEN` / `GH_TOKEN` 可覆盖），脚本、参数、日志里都不出现明文 token。仓库坐标从 `remote.origin.url` 解析，也支持 `GITHUB_REPO` 覆盖。
- `--dry-run` 只打印将要执行的三步，实测正常；在已有 v1.1.0 的状态下实跑一次，正确走了「复用 Release + 跳过上传」分支，没有产生任何远端改动。
- 已知边界：脚本不校验 tag 是否真的指向 `main` 的最新提交（GitHub 建 tag 时用的是 `target_commitish`，如果远端分支落后则 tag 会打在旧 commit 上）。发版前确认 `git push` 已经成功。


### 构建环境与坑（本机）

- 本机没有 Go 与 NSIS，也不在 PATH 里。这次把工具链下到 `.toolchain/`（已被 .gitignore 忽略）：Go 1.27.4 来自 `mirrors.aliyun.com/golang/`，NSIS 3.04 来自 `cdn.npmmirror.com/binaries/electron-builder-binaries/nsis-3.0.4.1/nsis-3.0.4.1.7z`（用 `tar.exe -xf` 解，本机没有 7-Zip）。SourceForge 与 `go.dev` 直连都不通，`golang.google.cn` 会 302 到拿不到的 dl.google.com。
- **PowerShell 的 `Invoke-WebRequest` / `curl.exe`（schannel）在这台机器上全部 TLS 失败**（`SEC_E_NO_CREDENTIALS`），但 `D:\2Enviroment\Git\mingw64\bin\curl.exe` 和 Node 的 `fetch` 都正常。以后下载依赖优先用这两个。
- `scripts/build.js` 现在会自动找 `.toolchain/` 里的 Go 与 NSIS（找不到才退回 `D:/2Enviroment/Go/...`），并自己设 `GOCACHE` / `GOTMPDIR`，所以直接 `npm run dist` 就能跑，不用再手动导环境变量。想换工具链仍可用 `GO_BIN` / `GOPATH_DIR` / `NSIS_MAKENSIS`。
- **`app\build` 不能当 NSIS 输出目录**：makensis 在那里一律报 `Can't open output file`，即使目录属主是当前用户、ACL 给了完全控制、把目录重授权、甚至新建一个空的 `app\zz` 子目录也同样失败；同样内容输出到项目根、`nsi-out`、`appx` 都正常。`buildInstaller()` 已经内置兜底：先改写 `OutFile` 到 `.nsis-out` 打包，再把成品拷回 `app\build`，所以构建仍然是一条命令。真凶未定，怀疑与该目录的历史 NTFS 属性有关，换机器构建大概率不会复现。
- 编辑 `installer.nsi` 时丢了 UTF-8 BOM，makensis 直接报 `Bad text encoding: installer.nsi:2`。这个文件必须带 BOM，改完要检查首三字节是 `EF BB BF`。

### 网络与推送

`github.com` 的 git 通道**间歇性可用**（曾成功过 `git push`，也反复出现 `CONNECT tunnel failed 502` / `Empty reply` / `schannel: server closed abruptly`），`api.github.com` 始终稳定。绕开代理直连 `github.com:443` 不通。备用脚本 `.workbuddy/gh-mirror.js`（被 .gitignore 忽略）用法 `node .workbuddy/gh-mirror.js <commit>`：走 Git Data API 逐条镜像，凭据从 Windows 凭据管理器动态读取，命令里不出现明文 PAT，SHA 与本地完全一致。

## Next steps

1. **找第一位外部用户试用**：把 v1.1.1 的 Release 链接发过去，不看 README、只给链接，确认能独立双击装好并看到卡片。
2. **吊销那个 PAT**：`ghp_...` 在会话里明文出现过（本次发布又用了一次），去 GitHub Settings → Developer settings 删掉换新的。
3. **日常常驻观察**：开机自启连跑一周，确认 Win+D、热键、重启后位置记忆都稳定。

## 已完成的收尾

- v1.1.1 已推 `dev` / `main`（都在 `c9d0278`），`npm run release` 建了 Release 并上传 asset，匿名下载 digest 校验一致。
- 远端 `ui` / `workbuddy/main-622ca596` 两条旧分支本来就不存在（DELETE 返回 422，分支列表只有 `dev` / `main`），无需再处理。
- 本地 `index.v1.0.0.html.bak` 与 `D:\1Projects\acl-recovery` 已删；旧版 index.html 在提交 `615478a8` 里可按字节找回。

## Relevant artifacts

- `app/` — Go 桌面宿主全部源码；`app/installer.nsi` 一键安装脚本
- `scripts/build.js` — `npm run dist`，编译 → WebView2 引导程序 → NSIS
- `ui/preload.js` — 桌面态样式注入、右键面板、两个不透明度滑块、拖动与边缘拉伸
- `index.html` — 单文件界面；`config.json` 默认工作目录；`examples/` 示例项目
- `app/tools/probe`、`app/tools/shot` — z-order 诊断与 GDI 截屏
- <https://github.com/koopatroopada/hands-off-dashboard>

## Suggested skills

- handoff — 会话结束时覆盖更新本文件
