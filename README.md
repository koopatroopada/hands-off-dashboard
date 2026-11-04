# Hands-off Dashboard

读取本地项目交接文档的只读看板。每个项目一张卡片，直接展示交接文档头部里的**当前阶段、证据、通过条件、阻塞项、下一步**——不用打开文档就知道下一个动作是什么。

## 快速开始

双击 `start.bat`。它会启动本地服务并自动打开浏览器。

命令行等价写法：

```bash
node server.js          # 或 npm start
node server.js --no-open  # 只起服务不开浏览器
```

默认地址 `http://127.0.0.1:4177/`，端口被占用时自动往后找。关闭命令行窗口即停止服务。

需要 Node.js 18 以上，**没有任何 npm 依赖**，不用 `npm install`。

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
server.js          零依赖 HTTP 服务
lib/handoff.js     交接文档解析 + 项目发现
config.json        根目录与项目清单
start.bat          Windows 一键启动
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
