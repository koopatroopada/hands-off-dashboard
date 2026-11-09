Audience: 我自己（单机自用的项目交接看板 + 桌面组件）
Why: 同时维护多个项目，每个项目结束会话时留一份 HANDOFF.md，想要一个常驻桌面、一眼看清各项目进度和下一步的看板
Stages: 网页看板 → 桌面组件 → 开机自启 → 数据源统一 → 稳定自用
Current: 数据源统一
Evidence: 桌面「项目交接看板」快捷方式双击即启动（含开机自启）；本地看板 http://127.0.0.1:4177
Gate: dev 分支 6 个提交合并回 main，线上静态快照与本地形态同步
Blocker: dev 领先 main 未合并；线上快照仍是旧版，且无法承载 Electron 形态
Next-Determined: DETERMINED
Next: git checkout main && git merge dev，把桌面组件与 HANDOFF.md 数据源改造落到 main
Created: 2026-11-03
Last-Activity: 2026-11-09

# Handoff: 桌面组件贴桌面 + 开机自启 + 数据源统一到 HANDOFF.md

生成时间：2026-11-09 18:31

## Current state

### 桌面组件（Electron，`desktop/`）

透明无边框窗口贴在桌面层，Win+D 回桌面时可见，普通窗口会盖住它。本轮踩透的关键机制：

- **Z 序锚点用 Progman 的前邻居**：Win+D 会把 Progman 提到普通窗口前面，组件掉到它后面被壁纸盖住。以 Progman 本身作 `SetWindowPos` 的 hWndInsertAfter 会被 z-band 规则**静默拒绝**（返回 TRUE 但 Z 序不动）；以「Z 序紧挨 Progman 之上的窗口」（`GetWindow(progman, GW_HWNDPREV)`，同 band）作锚点则立即生效。
- **巡护间隔 50ms**：错位只能事后纠正，间隔=闪没时长；已在位时一次 `GetWindow` 比较即跳过。实测进入「显示桌面」80ms 内归位。
- `SetParent` 挂 Progman 的方案已放弃（Chromium 透明合成只对顶层窗口生效，子窗口 alpha 失效露灰底）；`SetWindowBand` 也放弃（即便调通也落到 Progman 之后）。
- `focusable: true` + focus 时立即 pinToBottom：`focusable:false`（WS_EX_NOACTIVATE）会让 Chromium 丢 pointerdown，拖动/菜单关闭/滑条三个 bug 同根因。
- 拖动用 screenX/screenY 位移 + `SetWindowPos(..., SWP_NOSIZE|SWP_NOZORDER)` 只改坐标（`setBounds` 在 150% 缩放下累积漂移）。
- 单实例锁：重复启动自动退出。右键面板可调外壳/卡片不透明度，Ctrl+Alt+Q 或右键退出。

### 快捷方式与开机自启（`38ab2cf`）

- `scripts/install-shortcuts.ps1`（WScript.Shell COM）建桌面 + `shell:startup` 两份 .lnk，均指 `node_modules/electron/dist/electron.exe` + `desktop\main.js`；根目录 `安装快捷方式.bat` / `取消开机自启.bat` 双击即用。
- 图标 `assets/icon.ico`：`scripts/make-icon.js` 纯 Node 手写 PNG 编码，256×256，配色取自原型 `--frame/--accent`。
- 坑：快捷方式不能从带 `ELECTRON_RUN_AS_NODE` 的终端启动；系统级环境变量已确认干净，explorer 启动正常。

### 数据源统一（`b16b4e3`）

- `lib/handoff.js`：`HANDOFF_NAME = 'HANDOFF.md'`，`findHandoffFile()` 只看项目根目录的 `HANDOFF.md`；`resolveSpecs()` 忽略 config 里的 `handoff` 字段。
- `config.json`：`root: D:/1Projects`，两个项目（newday、Hands-off-Dashboard）都不再写 handoff 路径。
- 本项目交接文档已从 `handoff-20261103-233547-1.md` 迁移为根目录 `HANDOFF.md`（本文件）；纯重复的 `handoff-20261103-233547.md` 已删除。
- handoff skill（用户级 `~/.workbuddy/skills/handoff`，v1.2.0）：输出路径固定为项目根目录 `HANDOFF.md`，每次整份覆盖更新；`Created` 优先从现有文件读取；`docs/handoff-*.md` 历史归档只作过程记录不当作现状。
- 测试 12 项全过（新增「config 的 handoff 字段被忽略」+ docs/ 干扰项用例）。
- 运行时验证：`GET /api/projects` 两张卡均指向各自根目录 `HANDOFF.md`，无报错。

### 多工作目录 + 右键菜单刷新（`615478a`）

- **每个工作目录下的每个子文件夹都视为一个项目，但只展示含 `HANDOFF.md` 的**：没有交接文档的文件夹直接跳过，看板上不放「找不到交接文档」的空卡片（用户明确要求）。显式 `projects` 清单仍保留错误卡用于诊断。扫描跳过隐藏目录、SKIP_DIRS、git worktree。
- `config.json` 从单个 `root` 改为 `roots` 数组；`loadConfig` 兼容旧单数 `root`、环境变量、overrides，路径去重。跨工作目录按绝对路径去重。`readProject` 的 relDir/relPath 相对各自所属根目录（spec.root）。
- **右键菜单新增**：「刷新」（主进程在页面主世界 `executeJavaScript` 派发 `hs-refresh` 事件，页面静默重读，不重载不闪烁）、「工作目录」管理（添加走原生目录选择框支持多选；每条带 × 移除；至少保留一个；改完写状态文件 `%APPDATA%/hands-off-dashboard/desktop-state.json` 并原地突变运行时 config，下一次 `/api/projects` 即时生效，不重启服务）。
- roots 优先级：组件状态文件 > config.json。`projects` 显式清单保留兼容，常规留空走扫描。
- 验证：15 项测试全过；CDP 实测面板渲染/刷新链路（事件到达主世界、status 更新）。

### 原型契约

`index.html` 的 `<style>` 与原型字节相同，UI 不改；已批准的例外仅「查看全文+路径」行与全文抽屉。样式注入全部在 `desktop/preload.js` 完成。

## Next steps

1. **合并 dev → main**（dev 领先 main 多个提交：桌面组件全套修复 + 快捷方式 + 数据源统一 + 多工作目录）。
2. 两个无引用文件待拍板：`design-spec.html`、`image.png`。
3. 线上静态快照（`npm run build` 产物）仍是旧版，需重新构建发布；线上形态无法承载桌面组件，定位为演示。
4. ~~右键「添加目录…」的原生对话框只能人工验证~~ → 用户已实测添加成功，当前工作目录为 `D:/1Projects` + `D:/3Data/WorkBuddyData`（后者 7 个文件夹均无 HANDOFF.md，按新规则全部跳过，看板仍只有 2 张卡）。

## Relevant artifacts

- `desktop/main.js` — 窗口层级、拖动、单实例、状态持久化（`%APPDATA%/hands-off-dashboard/desktop-state.json`）
- `desktop/preload.js` — 透明化样式注入、拖动/右键面板交互
- `lib/handoff.js` — HANDOFF.md 解析与数据源（根目录固定路径）
- `scripts/install-shortcuts.ps1`、`安装快捷方式.bat`、`取消开机自启.bat`、`assets/icon.ico`
- `C:/Users/adaic/.workbuddy/skills/handoff/SKILL.md` — v1.2.0，输出固定为 HANDOFF.md

## Suggested skills

- handoff — 会话结束时覆盖更新本文件
