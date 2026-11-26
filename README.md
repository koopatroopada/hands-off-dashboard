# Hands-off Dashboard

把每个项目的 `HANDOFF.md` 变成桌面上的一张卡片：当前阶段、证据、卡点、下一步。回到桌面，一眼就知道每个坑该从哪儿接着挖。

![看板预览](docs/preview.png)

## 为什么

有了 AI 之后，就开始尝试做各种东西。即便有了 AI，我也会因为这些都是新东西而感到大脑过载。所以我在网上搜索，如何同时管理多进程任务，并且这些任务之间没什么关联。

上网搜索了一圈之后，这个问题我好像想明白了。所谓多进程任务之间切换带来的损失，主要是「上下文」遗忘，导致需要重新思考下一步该怎么办。这样每次切换到一个任务的时候就会产生固定思考成本。

这个问题的解法就是每次要切换的时候，趁自己还没有遗忘掉当前任务的上下文，先想清楚下一步。当之后再次回到这个任务的时候，直接照着之前的决策往下行动。

于是有了这块看板。

## 下载安装

适用于 Windows 10 / 11。

**[下载安装包 `Hands-off-Dashboard-Setup-1.1.0.exe`（4.5 MB）](https://github.com/koopatroopada/hands-off-dashboard/releases/download/v1.1.0/Hands-off-Dashboard-Setup-1.1.0.exe)**

双击即可。**没有安装向导、不需要管理员权限**：自动装到当前用户目录，装完立刻启动，看板直接出现在桌面上。同时会生成桌面快捷方式、开始菜单入口、开机自启和卸载项。

首次启动会弹出一个目录选择框，挑你放项目的工作目录（可多选）。选完就按各项目根目录的 `HANDOFF.md` 出卡片；直接取消则显示随包附带的三个示例项目。之后在右键菜单 →「工作目录」里随时增删。

> 需要系统自带的 WebView2 运行时（Win11 与多数 Win10 已自带）。万一没有，安装器会用微软官方引导程序静默补齐，这一步需要联网。

## 它做什么

- **两种视图**：默认是看板视图，每个项目一张横向长卡；页头右侧的图标按钮切到方格视图，每个项目只剩名称和当前阶段，项目多的时候一屏看全。
- **每个项目一张卡**：当前阶段与阶段进度、下一步、最近活动、创建时间，以及交接文档里的 Why 摘录。
- **为什么做**：卡片中间那段就是文档里的 `Why`，默认折叠几行，点箭头展开——顺手提醒自己当初为什么开这个坑。
- **查看全文**：卡片标题下的「查看全文」在右侧抽屉渲染整份 markdown，开头的 `Key: value` 头部会变成字段面板。
- **定位文件**：抽屉里一键在资源管理器里选中这份 md。
- **排序与置顶**：按创建时间或最近活动升降序，置顶记住在本地；置顶状态在看板与方格两种视图之间同步，置顶项目始终排在最前。
- **容错**：缺字段显示占位文案，读不到文档时卡片直接给出期望路径，不留空卡、不报错。

## 日常操作

| 操作 | 效果 |
| --- | --- |
| 拖动卡片或空白处 | 移动位置（自动记住） |
| 把鼠标移到四边 / 四角再拖动 | 光标变成拉伸图标，按住即可改窗口大小（自动记住，最小 460×280） |
| 右键 | 外观面板：外壳 / 卡片不透明度、刷新、工作目录管理、退出 |
| `Ctrl+Alt+H` | 隐藏 / 显示 |
| `Ctrl+Alt+Q` | 退出 |

窗口无边框透明，贴在桌面壁纸之上、所有普通窗口之下：按 `Win+D` 回到桌面就露出来，被别的窗口盖住也会自动归位。不占任务栏、不抢焦点。

## 给项目写一份 `HANDOFF.md`

放在**项目根目录**，开头是连续的 `Key: value`，空一行之后写正文：

```
Audience: 我自己
Why: 同时维护多个项目，想一眼看清各项目进度和下一步
Stages: 网页看板 → 桌面组件 → 日常常驻
Current: 桌面组件
Evidence: 可访问的链接或可安装的产物
Gate: 进入下一阶段必须跨过的门槛
Blocker: 当前主要缺口
Next-Determined: DETERMINED
Next: 下一个具体动作
Created: 2026-11-01
Last-Activity: 2026-11-09

# Handoff: 标题

正文随便写，支持标题、列表、表格、代码、引用。
```

工作目录下**每个子文件夹都算一个项目**，但只有根目录含 `HANDOFF.md` 的才会上板；没有的直接跳过。扫描会跳过隐藏目录和 `node_modules` 这类文件夹。

字段缺哪个都不影响解析：

| 字段 | 含义 | 缺失时 |
| --- | --- | --- |
| `Audience` | 这份文档写给谁 | 不显示 |
| `Why` | 为什么要做 | 显示占位文案 |
| `Stages` | 阶段序列，用 `→` 分隔 | 不显示进度 |
| `Current` | 当前阶段，命中 `Stages` 时显示 `3/5` | 显示「未标注阶段」 |
| `Evidence` | 目前能拿出的证据 | 占位文案 |
| `Gate` | 通过条件 | 占位文案 |
| `Blocker` | 当前卡点 | 占位文案 |
| `Next-Determined` | `DETERMINED` / `UNDETERMINED` | 按未定处理 |
| `Next` | 下一个动作 | 占位文案 |
| `Created` / `Last-Activity` | 日期，用于排序 | 排序时按最旧处理 |

## 自己构建

```bash
npm run dist       # 编译 + 打包，产物在 app/build/
npm run release    # 建 tag/Release、上传 asset、校验 digest
```

需要 Node.js 18+、Go 1.27+ 和 NSIS 3.x。工具链不在默认位置时可用 `GO_BIN`、`GOPATH_DIR`、`NSIS_MAKENSIS` 指定。产物在 `app/build/Hands-off-Dashboard-Setup-<版本>.exe`。

`npm run release` 会从 `package.json` 读版本号，用 `git credential` 里保存的 GitHub 凭据发布，命令行不出现明文 token。可加 `--dry-run` 只看步骤、`--build` 先构建、`--replace` 覆盖同名 asset、`--notes notes.md` 指定 Release 说明。重复执行是安全的：Release 已存在就复用，asset 内容一致就跳过上传。

## 目录

```
index.html          单文件界面（内联 CSS/JS，无外部依赖）
config.json         默认工作目录与端口
ui/preload.js       桌面态样式、右键面板、拖动与边缘拉伸交互
app/                Windows 桌面宿主（Go + 系统 WebView2）
  main.go           启动编排：单实例、服务、建窗
  window.go         分层透明窗口、贴底巡护、拖动 / 拉伸、DPI、热键
  data.go           HANDOFF.md 解析与数据组装
  server.go         本地服务 + 把 preload.js 包成桥脚本注入页面
  ipc.go            桌面交互的 12 个动作
  dialog.go         原生目录多选
  state.go          配置与状态持久化
  installer.nsi     一键安装包脚本
scripts/build.js    编译 → WebView2 引导程序 → NSIS 打包
scripts/release.js  建 tag/Release → 上传 asset → 校验 digest
examples/           三个虚构项目，首次启动的示例数据
assets/             图标
docs/               预览图
```

## 常见问题

**双击后没看到组件**：按 `Win+D` 回到桌面，它是贴在壁纸上的，会被普通窗口盖住。日志在 `%APPDATA%\hands-off-dashboard\dashboard.log`。

**没有卡片**：只有根目录含 `HANDOFF.md`（全大写、不在 `docs/` 里）的文件夹才会上板。右键 →「工作目录」确认目录加对了。

**改了文档卡片没变**：右键 →「刷新」，或 `Ctrl+Alt+H` 隐藏再显示。

**怎么卸载**：开始菜单里的「卸载 Hands-off Dashboard」，或系统设置 → 应用。卸载会清掉快捷方式、开机自启和安装目录。

## 已知限制

- Windows 专属：依赖 Win32 窗口层级与系统 WebView2 运行时。
- 只认项目根目录的 `HANDOFF.md` 这一个文件名。
- 本地服务只监听 `127.0.0.1`，不对外网开放，也不写入你的文件。

## 许可证

[MIT](LICENSE)。
