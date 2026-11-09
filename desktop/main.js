'use strict';

/**
 * Hands-off Dashboard · 桌面组件主进程
 *
 * 目标形态：无边框、背景透明、贴在桌面层（被普通窗口自然盖住、点击不抢焦点），
 * 右键可调两层不透明度。
 *
 * 层级实现说明：
 * Electron 没有「桌面层」API。这里用 Win32 把窗口插到「桌面窗口之上、
 * 普通窗口之下」，再用 50ms 定时器盯着 Z 序、随时纠正。
 *
 * 两个坑（都实测过，别退回去）：
 * 1. 不能用 HWND_BOTTOM，那是 Z 序最底端，窗口会跑到桌面窗口背后被壁纸盖住；
 * 2. 不能用 Progman 本身当 SetWindowPos 的参照窗口——Win8 起窗口按 z-band
 *    分组，跨 band 的插入请求返回 TRUE 但 Z 序不动。要用「紧挨在 Progman
 *    之上的那个窗口」当锚点。
 *
 * 曾经试过 SetParent 把窗口挂成 Progman（桌面）的子窗口，好处是 Win+D 收不走，
 * 但 Chromium 的透明合成只对顶层窗口生效——变成子窗口后 alpha 通道直接失效，
 * 半透明的区域会被渲染成一块不透明的深灰底，等于没有透明。桌面组件一旦不能
 * 透出壁纸就失去意义，因此放弃子窗口方案，改为「顶层窗口 + 定时巡护」。
 */

const { app, BrowserWindow, dialog, ipcMain, screen, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createServer } = require('../server.js');

const APP_TITLE = 'Hands-off Dashboard';

// 直接跑 desktop/main.js 时 Electron 会把 userData 落到通用的 "Electron" 目录，
// 和其他开发中的 Electron 应用共用；这里固定到自己的目录，并从旧位置迁移一次。
const appDataDir = app.getPath('appData');
const legacyStateFile = path.join(appDataDir, 'Electron', 'desktop-state.json');
app.setPath('userData', path.join(appDataDir, 'hands-off-dashboard'));

const stateFile = () => path.join(app.getPath('userData'), 'desktop-state.json');

function migrateLegacyState() {
  try {
    const target = stateFile();
    if (fs.existsSync(target) || !fs.existsSync(legacyStateFile)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacyStateFile, target);
  } catch {
    /* 迁移失败不影响启动 */
  }
}

/* ── Win32 ─────────────────────────────────────────────────── */

const HWND_BOTTOM = 1n;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;

const SW_RESTORE = 9;
const SW_SHOWNOACTIVATE = 4;

const GW_HWNDNEXT = 2; // Z 序里下一个（更靠下）的窗口
const GW_HWNDPREV = 3; // Z 序里上一个（更靠上）的窗口

const SKIP_ATTACH = process.env.HS_NO_ATTACH === '1';
// 调试用：把窗口置顶，方便在没有桌面遮挡的情况下验证交互
const DEBUG_TOPMOST = process.env.HS_TOPMOST === '1';

let api = null;

try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  api = {
    SetWindowPos: user32.func(
      'bool __stdcall SetWindowPos(uint64 hWnd, uint64 hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)'
    ),
    FindWindowW: user32.func('uint64 __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)'),
    GetWindow: user32.func('uint64 __stdcall GetWindow(uint64 hWnd, uint uCmd)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(uint64 hWnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(uint64 hWnd)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(uint64 hWnd, int nCmdShow)')
  };
} catch (error) {
  console.error('[desktop] 无法加载 user32.dll，窗口将保持在普通窗口层：', error.message);
}

function hwndOf(win) {
  const buffer = win.getNativeWindowHandle();
  // koffi 只接受 number/BigInt 形式的句柄，传 Buffer 会静默返回 false
  return buffer.length === 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

/** koffi 的 64 位返回值可能是 number 也可能是 BigInt，统一成 BigInt 再比较 */
const asHwnd = (value) => (typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value) || 0)));

function findProgman() {
  if (!api) return 0n;
  return asHwnd(api.FindWindowW('Progman', null));
}

/**
 * 贴在桌面之上、所有普通窗口之下。
 *
 * 参照物不能直接用 Progman（桌面窗口）。实测（Win10/11）以 Progman 作
 * SetWindowPos 的 hWndInsertAfter 会返回 TRUE 却不动 Z 序——Win8 起窗口按
 * z-band 分组，桌面窗口在自己的 band 里，跨 band 的插入请求被静默丢弃。
 * 改用「Z 序上紧挨在 Progman 之上的那个窗口」作锚点：它与我们在同一个 band，
 * 插入到它之后，落点就正好是「桌面之上、其他普通窗口之下」。
 *
 * 已经在位时直接返回（一次 GetWindow 比较），不产生多余调用。
 */
function pinToBottom(win) {
  if (!api || !win || win.isDestroyed()) return;
  try {
    const hwnd = hwndOf(win);
    const progman = findProgman();

    if (!progman) {
      // 资源管理器重启中，先压到底，下一轮再纠正
      api.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      return;
    }

    // 紧贴在 Progman 之上 = 已经处于目标位置
    if (asHwnd(api.GetWindow(hwnd, GW_HWNDNEXT)) === progman) return;

    const anchor = asHwnd(api.GetWindow(progman, GW_HWNDPREV));
    // SWP_NOACTIVATE：只调整层级，不抢焦点
    api.SetWindowPos(hwnd, anchor, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch {
    /* 窗口销毁瞬间忽略 */
  }
}

/**
 * 每 50ms 检查一次：
 * 1. 万一被外部强制最小化或隐藏（「显示桌面」类工具、资源管理器重启），
 *    原样还原——窗口声明了 minimizable:false，通常不会被最小化
 * 2. Z 序被改动（典型是 Win+D：Progman 被提到所有普通窗口前面，
 *    窗口随即掉到它后面、被壁纸盖住），重新插回桌面之上
 *
 * 50ms 而不是 600ms，是因为 Win+D 造成的错位只能事后纠正，
 * 间隔直接决定「组件消失多久」。已在位时检查只是一次 GetWindow 比较，
 * 每秒 20 次的量级对 CPU 没有可测影响，而 50ms 以内的空缺基本看不出来。
 */
function keepOnDesktop(win) {
  if (!win || win.isDestroyed() || DEBUG_TOPMOST) return;

  const hwnd = hwndOf(win);
  if (api) {
    try {
      if (api.IsIconic(hwnd)) {
        console.log('[desktop] 被最小化（Win+D），还原');
        api.ShowWindow(hwnd, SW_RESTORE);
        win.showInactive();
      } else if (!api.IsWindowVisible(hwnd)) {
        console.log('[desktop] 被隐藏，重新显示');
        api.ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        win.showInactive();
      }
    } catch {
      /* 窗口销毁瞬间忽略 */
    }
  }

  pinToBottom(win);
}

/* ── 状态持久化 ─────────────────────────────────────────────── */

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    console.error('[desktop] 保存状态失败：', error.message);
  }
  return next;
}

/* ── 窗口 ──────────────────────────────────────────────────── */

let win = null;
let httpServer = null;
let runtimeConfig = null; // createServer 返回的 config 对象，改 roots 时原地突变让服务即时生效

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 660;

/** 工作目录列表：状态文件里存过就用它，否则落到 config.json 的默认值 */
function currentRoots() {
  const saved = readState();
  if (Array.isArray(saved.roots) && saved.roots.length) return [...saved.roots];
  if (runtimeConfig && Array.isArray(runtimeConfig.roots)) return [...runtimeConfig.roots];
  return [];
}

/** 更新工作目录：写状态文件 + 原地突变运行时 config，下一次 /api/projects 立即生效 */
function setRoots(nextRoots) {
  writeState({ roots: nextRoots });
  if (runtimeConfig) {
    runtimeConfig.roots = [...nextRoots];
    runtimeConfig.root = nextRoots[0];
  }
  return nextRoots;
}

/** 通知页面静默重读数据（在主世界派发，确保跨 contextIsolation 可达） */
function refreshPage() {
  if (!win || win.isDestroyed()) return;
  win.webContents
    .executeJavaScript("window.dispatchEvent(new Event('hs-refresh'))", true)
    .catch(() => { /* 页面正在跳转时忽略 */ });
}

async function boot() {
  migrateLegacyState();
  const saved = readState();
  const { workArea } = screen.getPrimaryDisplay();

  const width = Math.round(Number.isFinite(saved.width) ? saved.width : DEFAULT_WIDTH);
  const height = Math.round(Number.isFinite(saved.height) ? saved.height : DEFAULT_HEIGHT);
  const x = Math.round(Number.isFinite(saved.x) ? saved.x : workArea.x + workArea.width - width - 40);
  const y = Math.round(Number.isFinite(saved.y) ? saved.y : workArea.y + workArea.height - height - 40);

  // 用户在面板里配置过工作目录就以状态文件为准（config.json 只是初始默认）
  const overrides = { open: false };
  if (Array.isArray(saved.roots) && saved.roots.length) overrides.roots = saved.roots;

  const { url, server, config } = await createServer(overrides);
  httpServer = server;
  runtimeConfig = config;

  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 460,
    minHeight: 280,
    title: APP_TITLE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    focusable: process.env.HS_FOCUSABLE === '0' ? false : true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: DEBUG_TOPMOST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  win.setMenuBarVisibility(false);

  // 事件必须在 loadURL 之前注册：await 结束后 ready-to-show / did-finish-load
  // 可能已经触发过，once 就再也等不到了
  win.once('ready-to-show', () => {
    win.showInactive();
    if (!SKIP_ATTACH && !DEBUG_TOPMOST) pinToBottom(win);
    console.log('[desktop] 启动完成（顶层窗口 + 贴底）');
  });

  await win.loadURL(url);

  win.webContents.on('did-finish-load', () => keepOnDesktop(win));

  // 位置与尺寸记忆（防抖）
  let saveTimer = null;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [wx, wy] = win.getPosition();
      const [ww, wh] = win.getSize();
      writeState({ x: Math.round(wx), y: Math.round(wy), width: Math.round(ww), height: Math.round(wh) });
    }, 400);
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);

  // 窗口必须可聚焦，否则收不到 pointerdown：
  // Windows 上 focusable:false 等价于 WS_EX_NOACTIVATE，Chromium 会丢掉按下事件，
  // 只派发 pointerup，还伴随一串假的 mouseleave——拖动、点空白关菜单、拖滑条
  // 全都依赖 pointerdown，于是三个功能一起失灵。
  // 代价是点击会激活窗口并把它提到 Z 序前面，这里一旦收到焦点就立刻压回桌面层。
  win.on('focus', () => {
    if (DEBUG_TOPMOST || SKIP_ATTACH) return;
    pinToBottom(win);
  });

  // 兜底：万一仍被最小化（Win+D / 显示桌面），立刻恢复
  win.on('minimize', () => {
    console.log('[desktop] 收到最小化事件，立即恢复');
    if (!win || win.isDestroyed()) return;
    win.restore();
    win.showInactive();
    keepOnDesktop(win);
  });

  // 定时归位：Win+D 被收走、层级被意外改动、资源管理器重建桌面时自动修正
  const keeper = setInterval(() => keepOnDesktop(win), 50);
  keeper.unref?.();

  win.on('closed', () => {
    clearInterval(keeper);
    win = null;
  });
}

/* ── IPC ───────────────────────────────────────────────────── */

ipcMain.handle('desktop:bootstrap', () => {
  const saved = readState();
  return {
    shellOpacity: Number.isFinite(saved.shellOpacity) ? saved.shellOpacity : 1,
    cardOpacity: Number.isFinite(saved.cardOpacity) ? saved.cardOpacity : 0.56,
    roots: currentRoots(),
    version: app.getVersion(),
    desktopLayer: !!api && !DEBUG_TOPMOST
  };
});

ipcMain.handle('desktop:set-opacity', (_event, payload) => {
  const patch = {};
  if (payload && Number.isFinite(payload.shellOpacity)) {
    patch.shellOpacity = Math.min(1, Math.max(0, payload.shellOpacity));
  }
  if (payload && Number.isFinite(payload.cardOpacity)) {
    patch.cardOpacity = Math.min(1, Math.max(0, payload.cardOpacity));
  }
  writeState(patch);
  return patch;
});

/* ── 工作目录与刷新 ───────────────────────────────────────── */

ipcMain.handle('desktop:get-roots', () => ({ roots: currentRoots() }));

ipcMain.handle('desktop:add-roots', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '添加工作目录（可多选）',
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return { roots: currentRoots(), added: 0 };

  const existing = new Set(currentRoots().map((item) => String(item).toLowerCase()));
  const merged = [...currentRoots()];
  let added = 0;
  for (const dir of result.filePaths) {
    if (existing.has(String(dir).toLowerCase())) continue;
    existing.add(String(dir).toLowerCase());
    merged.push(dir);
    added += 1;
  }

  if (added) {
    setRoots(merged);
    refreshPage();
  }
  return { roots: merged, added };
});

ipcMain.handle('desktop:remove-root', (_event, dir) => {
  const next = currentRoots().filter((item) => String(item).toLowerCase() !== String(dir).toLowerCase());
  if (next.length === currentRoots().length) return { roots: next, removed: 0 };
  // 至少保留一个工作目录，全删会让看板没有任何可扫描的地方
  if (!next.length) return { roots: currentRoots(), removed: 0 };
  setRoots(next);
  refreshPage();
  return { roots: next, removed: 1 };
});

ipcMain.handle('desktop:refresh', () => {
  refreshPage();
  return true;
});

/* ── 拖动 ───────────────────────────────────────────────────── */

let dragOrigin = null;

ipcMain.on('desktop:drag-start', (_event, point) => {
  if (!win || win.isDestroyed() || !point) return;
  const [wx, wy] = win.getPosition();
  console.log('[desktop] drag-start', wx, wy, point.screenX, point.screenY);
  dragOrigin = {
    winX: Math.round(wx),
    winY: Math.round(wy),
    screenX: point.screenX,
    screenY: point.screenY
  };
});

ipcMain.on('desktop:drag-move', (_event, point) => {
  if (!win || win.isDestroyed() || !dragOrigin || !point) return;

  const nextX = Math.round(dragOrigin.winX + (point.screenX - dragOrigin.screenX));
  const nextY = Math.round(dragOrigin.winY + (point.screenY - dragOrigin.screenY));

  if (api) {
    // 只挪坐标（SWP_NOSIZE | SWP_NOZORDER）：
    // Electron 的 setBounds 每次都要在 DIP 与物理像素之间换算，
    // 150% 缩放下会累积取整误差，连拖几次窗口会悄悄变大（实测每次 +9×15 DIP）
    const scale = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor || 1;
    api.SetWindowPos(
      hwndOf(win),
      0n,
      Math.round(nextX * scale),
      Math.round(nextY * scale),
      0,
      0,
      SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
    );
  } else {
    win.setPosition(nextX, nextY);
  }
});

ipcMain.on('desktop:drag-end', () => {
  if (dragOrigin) console.log('[desktop] drag-end');
  dragOrigin = null;
  if (!win || win.isDestroyed()) return;
  const [wx, wy] = win.getPosition();
  const [ww, wh] = win.getSize();
  writeState({ x: Math.round(wx), y: Math.round(wy), width: Math.round(ww), height: Math.round(wh) });
  pinToBottom(win);
});

ipcMain.on('desktop:quit', () => {
  app.quit();
});

/* ── 生命周期 ──────────────────────────────────────────────── */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      win.showInactive();
      keepOnDesktop(win);
    }
  });

  app.whenReady().then(async () => {
    await boot();

    globalShortcut.register('Control+Alt+H', () => {
      if (!win || win.isDestroyed()) return;
      if (win.isVisible()) win.hide();
      else {
        win.showInactive();
        keepOnDesktop(win);
      }
    });

    globalShortcut.register('Control+Alt+Q', () => app.quit());

    app.on('activate', () => {
      if (!win) boot();
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (httpServer) httpServer.close();
  });

  app.on('window-all-closed', () => app.quit());
}
