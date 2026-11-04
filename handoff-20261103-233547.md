Audience: 我自己（单机自用，明确不上架）
Why: 我喜欢一边听 B 站音乐合集一边学习，本来也在用番茄钟，想把这两件事合成一件——用音乐代替钟表来计时
Stages: Opendesign 交互原型 → 可安装自用 → 核心功能稳定 → 自用顺手 → 数据可迁移
Current: 自用顺手
Evidence: 番茄专注-1.1.4.apk（versionCode 6，可直接安装到真机）
Gate: 1.1.4 的进度恢复在真机上验证通过
Blocker: 1.1.4 新增的进度存档只做过离线单测，真机未验证（电脑侧手机未连接）
Next-Determined: DETERMINED
Next: 手机 USB 连上后 adb install -r 番茄专注-1.1.4.apk，专注中途把 App 从后台划掉再打开，确认首页显示「已暂停 · 继续专注」且进度从原位接着走
Created: 2026-11-03
Last-Activity: 2026-11-03

# Handoff: 番茄进度不再一杀就没（1.1.4）

生成时间：2026-11-03 23:35

## Current state

### 本轮（1.1.4）改了什么

**问题**：进行中的番茄只存在于页面内存的 `player` 对象里。`localStorage` 存了合集、专注记录、头像，唯独没存进度。系统清后台、手机重启、手滑划掉后台，这一颗就从 0 开始。

**做法**（全部在 `index.html` 的前端，未动 Java）：

- 新增独立存档键 `fanqie.focus.v1`，不混进 `fanqie.data.v1`——主数据里带着头像那串 base64，每 5 秒整份重写没意义。新函数：`persistPlayer(force)` / `loadPlayerSnapshot()` / `clearPlayerSnapshot()` / `restorePlayer()` / `afterRestore()`，位置在 `saveState` 之后。
- **落盘时机**：`tickPlayer` 每 5 秒节流写一次；开始专注、暂停/继续、±15 秒、拖动进度、结算时 `persistPlayer(true)` 立刻写；`visibilitychange` 进入 hidden 和 `pagehide` 再补一次。
- **恢复策略**：冷启动把进度接回来，但 `playing` 强制为 false。WebView 里音频要等用户手势才能出声，一打开 App 突然响也不合适。首页 hero 会自动显示「已暂停 · 继续专注」（`isLive` 判断走的是 `player.elapsed < playerTotalSeconds()`，不依赖 `playing`）。
- **音频定位**：新增 `seekAudioToProgress()`，在 Blob 挂上后和 `loadedmetadata` 各调一次。同时在 `timeupdate` 里加了守卫——`currentTime` 比 `elapsed` 落后 2 秒以上直接 return，否则第一帧就把 20 分钟的进度一把拉回 0。
- **走满的情况**：如果存下的 `elapsed` 已经 >= 总长（说明是在弹结算前被杀的），`afterRestore()` 直接调 `finishFocus()` 弹结算，这颗不白做。
- **清理点**：`saveDone`、删合集、恢复演示数据、`tickPlayer` 找不到合集，都调 `clearPlayerSnapshot()`。

**顺带修的计时问题**：没有音轨时原来是 `player.elapsed += 1`，靠页面 `setInterval` 每秒加。WebView 切后台后这个定时器会被节流到一分钟一次甚至更慢——专注 30 分钟可能只记到 10 分钟。改成 `player.anchorAt` / `anchorElapsed` + `Date.now()` 差值累加，并在 `beginFocus`、`toggle-play`、`nudgePlayer`、`seek change` 处把 `anchorAt` 归零重锚。注意音频分支里也会清 `anchorAt`（有音轨时以音频为准），否则从音轨模式退回时间戳模式会算错。

### 验证到哪一步（重要）

- ✅ 把四个存档函数从 `index.html` 里抠出来、配最小 mock 跑了 **20 项离线单测，全通过**。脚本在 `.tmp/test-focus-store.js`，可直接 `node .tmp/test-focus-store.js` 重跑。覆盖：正常写入读回、空存储不恢复、`elapsed` 为 0 丢弃、合集已删不恢复、超出总长截断、坏 JSON 不崩、字段类型写坏、结算后清空、5 秒节流、合集缺 `audioDuration` 时用快照值。
- ✅ `assembleDebug` 通过；`aapt2` 确认 `versionCode=6 / versionName=1.1.4`；APK 内 `index.html` 与源文件逐字节一致；内联 JS 过了 `node --check`。
- ❌ **真机没测**：电脑上 `adb devices` 为空。杀进程恢复这条只验证了逻辑，没验证过真实行为。

### 版本与已验证范围

| 版本 | 内容 | 真机 |
| --- | --- | --- |
| 1.1.0 | 原生 WebView 壳、短链解析、音轨下载 | 已验 |
| 1.1.1 | CDN 排序方向 bug（`cdnRank` 降序写反，把能用的 mcdn 节点排到最后）、`dead` 集合、退避重试 | 已验，第 5/6 个合集 403 消失 |
| 1.1.2 | 换头像（WebView 未实现 `onShowFileChooser`）、前台服务、清理调试接口 | 已验 |
| 1.1.3 | 只改播放页一行文案（「一直循环」→「播完即收」） | 未单独验证 |
| 1.1.4 | 进度存档 + 计时精度 | **未验** |

根目录现有 1.1.1 / 1.1.2 / 1.1.3 / 1.1.4 四个 APK，1.1.1 和 1.1.2 是用户真机验过的回滚点。用户还没决定删哪些。

### 已明确的方向性决定

- **不上架**。目标是自用顺心。`交付说明.md` 第六节里「正式签名 + 上架」已标注为自用不需要。
- **不做批量预下载**。用户明确否掉过。
- **视频暂时放下**。用户原话：「你不用管做视频这件事，你做好这个项目就好了」。`视频素材清单.md` 留着没删，但不作为当前方向。

### 环境坑

- 构建：`$env:JAVA_HOME="D:\2Enviroment\Android Studio\jbr"`，然后 `.\gradlew.bat assembleDebug`（在 `android/` 下）。Gradle 9.8.2 在 `~/.gradle-dist`。
- 改 `index.html` 后**必须** `cp index.html android/app/src/main/assets/www/index.html`，否则打包进去的还是旧的。有几次就是漏了这步。
- `adb` 在 `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe`，不在 PATH 里。
- 本机访问 `api.bilibili.com` 走沙箱代理会 502，电脑侧复现不了 B 站的 CDN 行为，只能真机看。
- 用户从 Opendesign 重新导出一份原型会**覆盖** `index.html` 里的桥接代码（`NATIVE`、`__potatoResolve`、`audioCardHtml` 等），需要重新接。

## Next steps

1. **真机验证 1.1.4（最高优先级）**：手机连上后 `adb install -r 番茄专注-1.1.4.apk`，专注到一半从后台划掉再打开，看首页是否显示「已暂停 · 继续专注」、点进去进度是否从原位接着走、音频是否从该位置续上。若还连着电脑，顺手跑 `.tmp/regression.js`（18 项端到端，走 CDP）。
2. **数据备份导出**：记录只在本机，换机或重装就全没了。用户已认可这是下一个收益点。做法倾向：原生侧写一个导出方法（JSON 落到 `Downloads` 或走系统分享），前端加「导出 / 导入」入口，导入时做 schema 校验（`normalizeState` 已有归一化逻辑可复用）。
3. **清理根目录 APK**：建议保留 1.1.4 + 1.1.2（真机验过的回滚点），删 1.1.1 / 1.1.3。**删之前问用户**，他之前对留哪个有自己想法。
4. **原生播放器（大工程，排在后面）**：把音频从网页 `audio` 搬到 ExoPlayer/MediaPlayer，通知栏显示剩余时间、能暂停继续，锁屏彻底不依赖 WebView。当前前台服务只解决「进程别被杀」，理论上系统强制掐 WebView 时音频仍会断。

## Relevant artifacts

- `index.html` —— 前端主文件，所有改动都在这里
- `android/app/src/main/assets/www/index.html` —— 打包用的副本，改完要同步
- `android/app/src/main/java/com/fanqie/focus/MainActivity.java` —— WebView 壳、安全区、文件选择、通知权限
- `android/app/src/main/java/com/fanqie/focus/BiliBridge.java` —— 短链解析、音轨下载、外部跳转
- `android/app/src/main/java/com/fanqie/focus/FocusService.java` —— 前台服务 + MediaSession
- `android/app/build.gradle.kts` —— 版本号在这里（当前 6 / 1.1.4）
- `android/build-apk.bat` —— 一键打包脚本，输出名也要跟着改
- `.tmp/test-focus-store.js` —— 1.1.4 的 20 项存档单测
- `.tmp/regression.js` —— 18 项端到端回归（需真机 + CDP）
- `.tmp/cdp-eval.js` / `.tmp/ev.js` —— CDP 调试助手
- `交付说明.md` —— 面向用户的使用说明 + 问题修复记录（第五节按版本编号，新增修复要续编号）
- `handoff-20261103-214149.md` —— 上一份交接（1.1.1 时期），保留供追溯

## Suggested skills

无。本项目全程直接用 Read / Edit / Bash / PowerShell 推进，没有匹配的现成技能；真机排查用 `.tmp/` 下的 CDP 脚本即可。
