# Hands-off Dashboard

读取本地项目交接文档的只读看板。每个项目一张卡片，直接展示交接文档头部里的**当前阶段、证据、通过条件、阻塞项、下一步**——不用打开文档就知道下一个动作是什么。

## 快速开始

两种形态，按需选一个：

**网页版**：双击 `start.bat`，起本地服务并打开浏览器。数据实时、功能完整，适合专心看板的时候。

**桌面组件**：双击 `start-desktop.bat`，无边框半透明卡片贴在桌面最底层，不占任务栏、不抢焦点，写代码时瞥一眼就能看到下一步。首次运行会自动装 Electron（约 350 MB）。

命令行等价写法：

```bash
node server.js          # 网页版，或 npm start
node server.js --no-open  # 只起服务不开浏览器
npm run desktop         # 桌面组件
```

网页版默认地址 `http://127.0.0.1:4177/`，端口被占用时自动往后找。关闭命令行窗口即停止服务。

网页版需要 Node.js 18 以上，**没有任何 npm 依赖**。桌面组件需要额外安装 Electron（`npm install` 一次），它会自己起一个内部服务，不需要先跑 `start.bat`。

## 数据从哪来

默认读 `config.json` 里 `root` 指向的根目录（当前是 `D:/1Projects`），按 `projects` 清单逐个取交接文档。

`projects` 里每一项：

| 字段 | 说明 |
| --- | --- |
| `name` | 卡片标题，也是目录名的默认值 |
| `dir` | 项目目录，相对 `root`，省略时用 `name` |
| `handoff` | 交接文档路径，相对 `root`；省略时按下面的规则自动找 |
| `id` | 内部标识，用于置顶记忆，省略时用 `name` |

把 `projects` 写成空数组 `[]`（或整段删掉）就切成**自动发现**：扫描根目录下每个文件夹，只要目录里有交接文档就收录。自动发现会跳过隐藏目录，以及 `.git` 是文件而非目录的目录——也就是 git worktree，避免同一个仓库出现两张卡。

找交接文档的规则：先看 `docs/`，再看项目根目录；匹配 `handoff-*.md`、`handoff_*.md`、`HANDOFF.md`；同一个目录有多份时取文件名最大的（即时间戳最新）。

## 交接文档格式

头部是连续多行 `Key: value`，以第一个空行为界，之后才是正文：

```
Audience: 谁在用
Why: 为什么要做
Stages: 阶段一 → 阶段二 → 阶段三
Current: 当前所在阶段
Evidence: 目前能拿出的证据
Gate: 通过条件
Blocker: 当前卡点
Next-Determined: DETERMINED 或 UNDETERMINED
Next: 下一个动作
Created: 2026-11-02
Last-Activity: 2026-11-04

# Handoff: 标题
...
```

缺哪个字段都行，卡片会显示对应的占位文案，不会报错。`Stages` 用 `→` 分隔，`Current` 命中其中一项时卡片右上角显示 `3/5` 这样的进度。

## 界面

界面与原型逐字一致，没有对原型做任何版式改动：`<style>` 段是在原型原文基础上追加了一段「查看全文」入口与全文抽屉的样式，`<body>` 只把两处写死的示例值换成了占位符（`Data generated` 的时间、右下角项目数），由脚本填真实值。

也就是说，深色外框 + 圆角白壳、`Sort` 分段控件、方向切换、项目数、约 15% 宽的玻璃卡片横向滚动、标题跑马灯、为什么做 6.4 行截断与展开箭头、`Stage` / `Next step` / 底部日期，全部保持原型行为。

功能层做了这些：

- **查看全文**：卡片标题下方一行「查看全文」按钮加交接文档路径，点开右侧抽屉渲染完整 markdown（开头那段 `Key: value` 头部渲染成字段面板，支持标题、列表、表格、代码、引用）。`Esc`、点遮罩、点关闭都能收起，焦点回到原按钮。
- **定位文件**：抽屉右上角按钮，在资源管理器里选中这份 md（窄屏隐藏）。
- 数据来自本地服务，而不是脚本里写死的 `PROJECTS` 常量。
- 读不到交接文档的项目，用同一套卡片骨架显示占位文案，并在 `Next step` 位置给出错误原因。
- 加载中 / 拿不到数据时，复用原型已有的空状态卡片。
- 排序、置顶（localStorage）、滚动、跑马灯等交互逻辑与原型相同。
- 深链 `?doc=<项目 id>` 可直接打开某个项目的全文，方便直接分享/自测。

## 触屏（手机 / 平板）

只在 `@media (pointer: coarse)` 下生效，桌面版式与交互一行未动。

- **左右滑动**：切换项目。触屏上一张卡约占满屏宽（`min(560px, 100% - 20px)`），右侧露出下一张的边缘，配合 `scroll-snap-type: x mandatory`，滑一下正好停在一张卡上。
- **上下滑动**：滚动当前卡片内部的内容。卡片高度就是可视高度，内容超出时在卡片内滚动；滚到边界后不会把整页拖走（`overscroll-behavior-y: contain`）。

实现上有两个坑，改动时请勿回退：

1. `.board-scroller` 与 `.project` **不要设** `touch-action: none`，否则单指完全滑不动；也**不要设** `pan-x pan-y`，它不含 `pinch-zoom`，在卡片自身可纵向滚动时会吞掉横向手势。保持默认 `auto`，让浏览器按手势方向分发。
2. `.project` 的 `overscroll-behavior` 必须写成 `overscroll-behavior-y`。写成简写会把横向滚动链一起切断，手势传不到外层看板容器。

这两条都是在真机等效的触摸事件模拟下逐项对比得出的，不是推测。

## 桌面组件

双击 `start-desktop.bat`，或 `npm run desktop`。

它是一个**无边框透明窗口**，用 `SetParent` 挂进桌面窗口（Progman）成为桌面的子窗口：被普通窗口盖住，只在你回到桌面时露出来；按 `Win+D` 显示桌面时**不会**被收走（子窗口不属于「最小化所有顶层窗口」的范围）。不占任务栏、不抢焦点。

**怎么用**

| 操作 | 效果 |
| --- | --- |
| 按住卡片或空白处拖动 | 移动组件位置（位置和尺寸自动记住） |
| 右键 | 打开外观面板：两个滑块 + 退出 |
| 单击面板外任意位置 / 鼠标移出组件 | 关闭外观面板 |
| `Ctrl+Alt+H` | 隐藏 / 显示 |
| `Ctrl+Alt+Q` | 退出组件 |

**两层不透明度**

右键面板里的两个滑块各自独立：

- **外壳**：整个窗口底色。调到 0 就只剩文字和边框，完全透出壁纸；默认 100%（与网页版一致）。
- **卡片**：单张项目卡的底色。默认 56%，等于原型里的 `--glass` 毛玻璃。

两个值存在 `%APPDATA%/hands-off-dashboard/desktop-state.json`，下次启动沿用。

**实现要点（改之前务必先读）**

1. **挂进桌面才挡得住 `Win+D`**。Electron 没有「桌面层」API，Windows 的桌面小工具平台在 Win8 就废弃了。只调 `SetWindowPos(hwnd, HWND_BOTTOM)` 压到底是不够的：`Win+D` 会最小化所有顶层窗口，组件照样消失（它甚至不会收到 `minimize` 事件，所以「最小化就恢复」这条路也走不通）。正解是 `SetParent(hwnd, FindWindow('Progman'))`，让它变成桌面的子窗口。挂上之后每 1.5 s 用 `HWND_TOP` 在自己所在父窗口里提到最上层（盖住桌面图标层，但不会越过普通窗口），同时兼作资源管理器重启后的自动重挂。
2. **父窗口要用 `GetAncestor(hwnd, GA_PARENT)` 判断，不能用 `GetParent`**。窗口没有 `WS_CHILD` 样式时 `GetParent` 返回的是 owner（恒为 0），会被误判成「没挂上」，于是每 1.5 s 往桌面最底层压——表现为组件在桌面上凭空消失。
3. **`focusable: false` 是必须的**。它等价于 `WS_EX_NOACTIVATE`：点击窗口不会激活它，也就不会弹到最前。没有这一条，点一下卡片窗口就会跳到所有窗口上面。
4. **HWND 必须用 BigInt 传**。`koffi` 里把 `getNativeWindowHandle()` 的 Buffer 直接当指针传会静默失败（返回 `false`），要先 `readBigUInt64LE` 转成 BigInt。
5. **拖动不要在 `pointerdown` 里放过默认行为**。不 `preventDefault()` 的话，按下后会进入浏览器的「拖选文本」，浏览器紧接着派发 `pointercancel`，拖动刚起步就被取消；而且拖选还会把看板横向滚偏。
6. **拖动要用 `SetWindowPos(..., SWP_NOSIZE | SWP_NOZORDER)` 只改坐标**。`win.setBounds()` 每次都要在 DIP 与物理像素之间换算，150% 缩放下会累积取整误差——连拖几次窗口就会悄悄变大（实测每次 +5 DIP）。
7. **`ELECTRON_RUN_AS_NODE` 会让整个方案失灵**。某些 IDE 终端会设这个变量，Electron 会退化成纯 Node 运行，`require('electron')` 拿不到 `app` / `BrowserWindow`，报错是 `Cannot read properties of undefined (reading 'handle')`。`start-desktop.bat` 里已经把它和 `NODE_OPTIONS` 清空。
8. **事件要在 `loadURL` 之前注册**。`await win.loadURL()` 返回时 `ready-to-show` 和 `did-finish-load` 可能已经触发过，之后再挂 `once` 永远等不到，窗口就不会显示。

调试开关：`HS_NO_ATTACH=1` 跳过桌面挂载（用于对比），`HS_TOPMOST=1` 置顶显示（其他窗口挡住时也能点）。

**它和网页版的差别**

- 数据仍读同一批 md 文件，但组件自己起一个内部服务（端口从 4177 往后找），不需要先跑 `start.bat`。
- 页面本身一行没改，透明化和右键面板全部由 `desktop/preload.js` 用覆盖样式注入。
- 网页版的抽屉、排序、置顶、滚动在组件里同样可用。

## 配置

`config.json`：

```json
{
  "root": "D:/1Projects",
  "port": 4177,
  "open": true,
  "projects": [ ... ],
  "ignore": ["Hands-off-Dashboard-dev"]
}
```

也可以走命令行和环境变量覆盖：`--root`、`--port`、`--no-open`；`DASHBOARD_ROOT`、`DASHBOARD_PORT`，环境变量优先于配置文件。

## 接口

| 路径 | 说明 |
| --- | --- |
| `GET /api/projects` | 页面唯一使用的接口：全部项目与解析后的字段 |
| `GET /api/handoff?id=xxx` | 返回交接文档原文 markdown，「查看全文」抽屉用它 |
| `GET /api/reveal?id=xxx&target=handoff` | 在资源管理器里定位文件，抽屉右上角「定位文件」用它 |

服务只监听 `127.0.0.1`，不对外网开放，也不会写任何文件——纯只读。

## 目录

```
index.html         单文件界面（内联 CSS/JS，无外部依赖）
server.js          零依赖 HTTP 服务（命令行与桌面组件共用）
lib/handoff.js     交接文档解析 + 项目发现
config.json        根目录与项目清单
start.bat          Windows 一键启动（网页版）
start-desktop.bat  Windows 一键启动（桌面组件）
desktop/main.js    桌面组件主进程：挂进桌面（Progman）、拖动、缩放、层级守护
desktop/preload.js 透明化样式注入、右键面板、两层不透明度、拖动与菜单交互
build-demo.js      把当前数据打包成静态快照（npm run build:demo）
test/              node --test 单元测试（npm test）
```

## 静态快照（demo/）

`npm run build:demo` 会读一遍当前数据，产出 `demo/index.html`：把 `/api/projects` 与 `/api/handoff` 的返回值直接内嵌进页面，并在页面里用一个 fetch 拦截器顶替这两个接口。产物没有任何外部依赖，可以直接丢给静态托管，或者双击用浏览器打开。

适合给别人看界面效果，代价要清楚：

- 数据是**发布那一刻**的快照，之后改 md 不会反映到线上；要更新就重新跑一次 `npm run build:demo` 再发布。
- 页面上的「刷新」和切窗自动重读只会重新读同一份快照。
- 「定位文件」按钮在快照里被隐藏，因为它依赖本地服务。
- 卡片数据里的「Data generated」时间是快照的生成时间，可以据此判断新鲜度。

真正的日常使用仍然是 `start.bat` 起本地服务，数据实时、功能完整。

## 常见问题

**页面提示"没连上本地服务"**：直接双击 `index.html` 打不开，浏览器不允许 `file://` 读本地文件。必须走 `start.bat` 或 `node server.js`。

**端口被占用**：会自动顺延到 4178、4179……以命令行打印的地址为准。

**改了文档卡片没变**：切回浏览器窗口就会重读（30 秒节流）；想立刻生效按一次 `F5`。服务本身不缓存。

**某个项目显示"找不到交接文档"**：检查 `config.json` 里的 `handoff` 是否是相对 `root` 的路径，注意 Windows 下写成 `项目名/docs/xxx.md` 这种正斜杠形式最省事。
