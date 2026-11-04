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
| `id` | 内部标识，用于置顶记忆和 `?doc=` 深链，省略时用 `name` |

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

界面完全沿用原型：深色外框 + 圆角白壳、顶栏标题与 `Data generated` 时间、`Sort` 分段控件（`Created` / `Last activity`）、方向切换、右下角项目数，以及板面上约 15% 宽的玻璃卡片横向滚动。卡片内部顺序也是原型的：标题（过长自动跑马灯）+ 图钉 → 为什么做（6.4 行截断，右下角箭头展开）→ `Stage`（阶段名 + 进度 + 证据）→ `Next step`（门槛 + 加粗下一步）→ 底部日期。

在这套排版之上只加了两处，都不改变布局：

- **底部 `Handoff`**：卡片底部日期后的一个小号文字链接，点开右侧抽屉看完整交接文档（结构化头部渲染成字段面板，支持标题、列表、表格、代码）。
- **抽屉右上角 `Reveal file`**：在资源管理器里选中这份 md。

其他行为：

- 排序/方向的置顶状态存在浏览器 localStorage，置顶项目永远排最前。
- 深链 `http://127.0.0.1:4177/?doc=xinyitian` 直接打开某个项目的全文。
- 页面重新获得焦点时会静默重读（30 秒内不重复请求），改完文档回来看一眼即可。
- 窄屏沿用原型的横向滚动（≤900px 卡片占 30% 宽），不改成纵向堆叠。

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
| `GET /api/projects` | 全部项目与解析后的字段 |
| `GET /api/handoff?id=xxx` | 单个项目的交接文档原文 |
| `GET /api/reveal?id=xxx&target=handoff` | 在资源管理器里定位文件 |

服务只监听 `127.0.0.1`，不对外网开放，也不会写任何文件——纯只读。

## 目录

```
index.html         单文件界面（内联 CSS/JS，无外部依赖）
server.js          零依赖 HTTP 服务
lib/handoff.js     交接文档解析 + 项目发现
config.json        根目录与项目清单
start.bat          Windows 一键启动
test/              node --test 单元测试（npm test）
```

## 常见问题

**页面提示"没连上本地服务"**：直接双击 `index.html` 打不开，浏览器不允许 `file://` 读本地文件。必须走 `start.bat` 或 `node server.js`。

**端口被占用**：会自动顺延到 4178、4179……以命令行打印的地址为准。

**改了文档卡片没变**：切回浏览器窗口就会重读（30 秒节流）；想立刻生效按一次 `F5`。服务本身不缓存。

**某个项目显示"找不到交接文档"**：检查 `config.json` 里的 `handoff` 是否是相对 `root` 的路径，注意 Windows 下写成 `项目名/docs/xxx.md` 这种正斜杠形式最省事。
