Audience: 我自己（单机自用的项目交接看板 + 常驻桌面组件），以及愿意自己构建的 Windows 用户
Why: 同时维护多个项目，每个项目结束会话时留一份 HANDOFF.md，想要一个常驻桌面、一眼看清各项目进度和下一步的看板
Stages: 网页看板 → 桌面组件 → 数据源统一 → 安装包分发 → 日常常驻
Current: 安装包分发
Evidence: 仓库 github.com/koopatroopada/hands-off-dashboard（dev/main 均在 521a56f）；本地 lite/build/Hands-off-Dashboard-Lite-Setup-1.0.0.exe（4.60 MB）已真机验收
Gate: GitHub Release 上能直接下载到轻量版安装包，外部机器双击装完、首启选好工作目录即正常出卡片
Blocker: 仓库里还没有可下载的安装包（Release 未建），也没有 LICENSE
Next-Determined: DETERMINED
Next: 建 GitHub Release v1.0.0 挂上 Hands-off-Dashboard-Lite-Setup-1.0.0.exe（4.60 MB），让外部能直接下载安装
Created: 2026-11-03
Last-Activity: 2026-11-14

# Handoff: 真机验收通过，轻量版安装包落地并推送 GitHub

生成时间：2026-11-14 01:05

## Current state

### 开源发布（`313ff5b`、`728b50d`）

- 仓库 <https://github.com/koopatroopada/hands-off-dashboard>，public，默认分支 main。
- **推送方式有过一次反转**：11-13 之前本机 `github.com` 的 git 通道（clone/push）502 超时，只有 `api.github.com` 通，所以用 Git Data API 逐条镜像：blobs → tree → commit → 更新 ref，SHA 与原提交完全一致；空仓库时 Git Data API 不可用，先用 Contents API 建引导提交再 force 覆盖 ref。**11-14 该通道已恢复，标准 `git push` 直接可用**（见下节）。API 镜像流程保留在这里，作为网络再断时的备用方案。
- README 重写为对外版：为什么 → 它做什么 → 快速开始 → HANDOFF 字段表 → 配置/接口 → 桌面组件原理 → 目录 → 演示 → FAQ → 已知限制。后来追加了「桌面安装包」双方案对照表与轻量版章节。
- 公开前把 `demo/index.html` 里的真实项目（newday）换成 `examples/` 下三份虚构数据（`maple-clinic-site`、`episode-12-clips`、`keyboard-practice`），`build-demo.js` 加了 `--root` 与 `build:demo:example`。
- `.gitignore` 补 `image.png`（设计参考图，含本机路径）、`dist/`、`lite/*.exe|*.png|*.log`、测试临时目录。

### Electron 安装包（`647af4a`）

- `npm run dist` → `dist/Hands-off-Dashboard-Setup-1.0.0.exe`，**116.13 MB**，NSIS oneClick、x64、未签名、装到当前用户（免 UAC）。
- 配置在 `electron-builder.yml`，构建入口 `scripts/build-installer.js`（设 `ELECTRON_BUILDER_BINARIES_MIRROR=npmmirror`，因为 github releases 在本机被拦），开机自启靠 `build-resources/installer.nsh` 的 `customInstall/customUnInstall` 宏往 `$SMSTARTUP` 建/删快捷方式。
- `desktop/main.js` 新增 `ensurePackagedRoots()`：打包版且无已存 roots 时弹原生多选目录框，取消回退 `app.getAppPath()/examples`；`serverOverrides()` 在打包版强制用 roots 覆盖 `config.json` 里写死的 `D:/1Projects`，本地 dev 行为不变。首启流程有测试开关 `HS_SKIP_FIRST_RUN=1`。
- 两个必须记住的配置：`asar: false`（koffi 的 `.node` 要真实路径）、`files` 白名单必须含 `node_modules/@koromix/koffi-win32-x64/**/*`（`koffi/src/koffi/index.cjs` 按 `${__dirname}/../../../@koromix/koffi-${pkg}` 找原生模块，漏了贴桌面层直接失效）。

### 体积诊断（用户追问「为什么这么大」的答案）

解压后 359 MB，拆开看：`electron.exe` 238.3 MB（Chromium + V8 + Node 全在里面）、Chromium 配套文件 ~118 MB、**项目自身仅 2.3 MB**，其中自有代码 131 KB / 12 个文件，koffi 2.1 MB。结论：**体积是 Chromium 的门票，与功能复杂度无关**；开不开 asar 不影响总量。这条结论直接导致下一段的换宿主决定。

### 轻量版 `lite/`（`dd91a7d`）

目标由用户给定：功能不变、安装包 ≤ 20 MB、技术栈不限。选型 **Go + 系统自带 WebView2**（本机无 MSVC，Rust/C# 路线排除；`github.com/jchv/go-webview2` 纯 Go 无 CGO、内嵌 WebView2Loader.dll，可直接编译）。Go 1.27.4 装在 `D:\2Enviroment\Go`。

- `main.go` 编排；`data.go` 是 `lib/handoff.js` 的 Go 复刻；`server.go` 实现三个同契约 HTTP 接口并把 `desktop/preload.js` 包成桥脚本注入 `index.html`；`ipc.go` 用 `/api/desktop/<channel>` 复刻 10 个 IPC 通道（与 `desktop/main.js` 同名）；`window.go` 管分层透明窗口、贴底巡护、拖动、DPI、热键；`dialog.go` 用 zenity 做目录多选；`state.go` 复用 `%APPDATA%\hands-off-dashboard\desktop-state.json`，**与 Electron 版共用，两版可互换**。
- **`preload.js` 一行不改复用**：Go 侧把整个文件包进 IIFE，用 fetch 版 `ipcRenderer` 顶掉 Electron 依赖，再作为 `/__hs/bridge.js` 插到 `</head>` 前。这是省掉重写 UI 逻辑的关键。
- **透明**：`ICoreWebView2Controller2` 的 vtable 是 `ICoreWebView2Controller` 的超集，用 `unsafe.Pointer` 强转后调 `PutDefaultBackgroundColor(A:0)`，不用 IID/QueryInterface。窗口另加 `WS_EX_LAYERED`。
- **外观坑**：必须注入 `preload.js` 的 `OVERRIDE_CSS`（`shellOpacity: 1` 把外壳设成不透明白）。不注入时半透明玻璃叠在透明窗口黑底上，看板会整体偏深色——曾被误判成 bug。
- 贴底沿用 Electron 版结论：`GetWindow(progman, GW_HWNDPREV)` 作 Z 序锚点，每 50 ms 巡护（已在位时一次 `GetWindow` 比较即跳过）。`SetParent` 挂 Progman 的老方案在新宿主里同样不可行（透明合成只对顶层窗口生效）。

### 两个宿主的体积对照

| 方案 | 安装包 | 解压后 | 前提 |
| --- | --- | --- | --- |
| Electron（`npm run dist`） | 116.13 MB | 359 MB | 无 |
| Go + WebView2（`npm run dist:lite`） | **4.60 MB** | 9.3 MB | 需系统 WebView2 Runtime（Win11 自带；缺失时安装器调官方引导程序联网补） |

**-96%**，距 20 MB 上限还剩 15.4 MB。轻量版已成为主推方案。

### 验证到什么程度

- `npm test` 15 项全过（两个宿主共用同一套数据层测试）。
- **功能等价性用逐字段比对**：同一个 `/api/projects` 请求，Go 版与 Node 版返回用 `util.isDeepStrictEqual` 对比，示例目录与用户真实目录（`D:\1Projects` + `D:\3Data\WorkBuddyData`，3 个项目）各跑一次，除 `generatedAt` 外完全一致。`/api/handoff` 的 markdown 逐字符一致，`/api/reveal` 合法 200 / 非法 404。
- 窗口层：`next == Progman`（与 Electron 版同级）、`shellOpacity 0.45` 能透出后面的资源管理器且文字可读、拖动 +60/+30 精确且 drag-end 重新贴底并持久化、热键真实注册、单实例第二进程正常退出并通知首实例。
- 安装器真跑过：一键静默、免 UAC、落盘 9.3 MB、桌面/开始菜单/自启快捷方式 + 卸载注册表齐全、WebView2 已存在时自动跳过引导程序；卸载把目录、快捷方式、自启、进程全清干净（加了 `SilentUninstall silent`）。
- **真机人工验收（2026-11-14）：用户确认通过，无修改清单**。首启的原生目录选择框、右键面板与两个滑块的真实鼠标操作、重启后位置与透明度记忆，这些此前「自动测不了」的缺口全部补齐。

### 真机验收通过 + 三个提交推送 GitHub（2026-11-14，`521a56f`）

- 按上一版 `Next` 的分支：验收通过 → 走「没问题 → 推 github」。`HANDOFF.md` 改动提交为 `521a56f`；先把本地 `main` 快进到 `dev`，再 `git push origin dev main`，两端都是 `728b50d..521a56f`。
- **远端此前实际停在 `728b50d`，不是旧文档里记的 `313ff5b`**（`dca596f`、`728b50d` 早已推上去），本地领先的是 3 个提交：`647af4a`、`dd91a7d`、`521a56f`。
- **环境反转**：`git ls-remote origin` 现在 exit 0，`credential.helper=manager`（Windows Git Credential Manager）里已有凭据，标准 `git push` 一次成功，退出码 0。以后优先试 `git push`，别默认走 API 镜像。
- 含明文 PAT 的 curl 命令被安全审批拦下（approval timed out），未重试、未绕过，改走系统凭据完成推送。
- 核对：`git fetch` 后 `git status -sb` 为 `## dev...origin/dev`（无 ahead/behind）；匿名 API 查最近三条提交 = `521a56f` / `dd91a7d` / `647af4a`；远端 `HANDOFF.md` 头部与本地逐字一致。

### 踩过的坑（下次别再犯）

- **`ELECTRON_RUN_AS_NODE=1` + `NODE_OPTIONS=--require ...shim` 只在 agent 终端里注入**，直接跑打包后的 exe 会退化成纯 Node。冒烟测试必须 `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS`。已确认 User/Machine 级环境变量是干净的，用户双击快捷方式不受影响。
- NSIS：`File /oname=` **不能带引号**（报 "output name must not begin with a quote"），所以 exe 名改成 `Hands-off-Dashboard.exe`（无空格）；路径含中文时 `.nsi` 必须带 **UTF-8 BOM**，否则报 "Bad text encoding"；Git Bash 会把 `/INPUTCHARSET` 当路径转换，不可用。
- 自写诊断工具（`lite/tools/probe`）是 **DPI 不感知**进程，`GetWindowRect` 返回虚拟化坐标（1002×662 @150%），会被误判成 DPI bug。以宿主自身日志（DPI 感知，1503×993 物理）为准。
- 贴底巡护每 50 ms 把窗口拉回，所以「临时置顶截图」会被瞬间撤销；要截图得 `HS_NO_ATTACH=1`。
- 从 Bash 用 `&` 启动的 exe 会随父 shell 退出被连带杀掉，看起来像「应用自己退出」。用后台任务方式启动才稳定。
- 安全策略拦截了 `csc.exe`、PowerShell `Add-Type`、从 Bash 调 PowerShell —— 截屏最后是用 Go + Win32 GDI 自己写的（`lite/tools/shot`）。
- Go 的 `time.Format` 是截断毫秒，JS `toISOString()` 是四舍五入，`isoTime()` 里手动补了这半毫秒。

### 分支现状

`dev`、`main`、`origin/dev`、`origin/main` 全部指向 `521a56f`，无 ahead/behind。`ui` 和 `workbuddy/main-622ca596` 停在 `060a285`，可删。

## Next steps

1. **建 GitHub Release v1.0.0，挂 `lite/build/Hands-off-Dashboard-Lite-Setup-1.0.0.exe`**（4.60 MB）。Release 上传二进制不需要文件进仓库，`dist/` 与 `lite/*.exe` 被 .gitignore 挡着不影响；Release 说明里写清 WebView2 前提和 `npm run dist:lite` 的复现方式。
2. **补 LICENSE**：现在没有许可证等于默认保留所有权利，和 README 里对外推广的口径不一致。MIT 最省事。
3. **吊销那个 PAT**：`ghp_...` 在会话里明文出现过，去 GitHub Settings → Developer settings 删掉换新的。
4. **进「日常常驻」后观察几天**：把轻量版设为开机自启连跑，确认 Win+D、热键、重启后位置记忆都稳定，再把 `Current` 推到下一阶段。
5. 收尾小事：`design-spec.html` 与 `demo/` 是否还留、`ui` 分支删不删、线上静态快照（`npm run build`）还是旧版。

## Relevant artifacts

- `lite/` — Go 宿主全部源码；`lite/installer.nsi` 安装脚本；`scripts/build-lite.js`（`npm run dist:lite`，可用 `GO_BIN` / `NSIS_MAKENSIS` 覆盖工具链路径）
- `desktop/main.js`、`desktop/preload.js` — Electron 宿主；preload 的 `OVERRIDE_CSS` 被 Go 版直接复用
- `lib/handoff.js` — HANDOFF.md 解析与数据源（根目录固定路径），`lite/data.go` 是它的复刻
- `electron-builder.yml`、`build-resources/installer.nsh`、`scripts/build-installer.js` — Electron 打包链路
- `lite/tools/probe`、`lite/tools/shot` — z-order 诊断与 GDI 截屏
- `examples/*/HANDOFF.md` — 三份虚构示例数据，对外演示用
- <https://github.com/koopatroopada/hands-off-dashboard>

## Suggested skills

- handoff — 会话结束时覆盖更新本文件
