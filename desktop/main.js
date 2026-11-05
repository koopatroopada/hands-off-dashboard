'use strict';

/**
 * Hands-off Dashboard · 桌面组件主进程
 *
 * 目标形态：无边框、背景透明、真正「属于桌面」（Win+D 显示桌面时不会被收起），
 * 被普通窗口自然盖住，点击不会把自己顶到前面，右键可调两层不透明度。
 *
 * 层级实现说明：
 * Electron 没有「桌面层」API。这里用 Win32 的 SetParent 把窗口挂到 Progman
 * （桌面窗口）下面，使其成为桌面的子窗口——子窗口不会参与 Win+D 的最小化，
 * 也就不会被「显示桌面」收走。挂载失败时退回 SetWindowPos(HWND_BOTTOM) +
 * 最小化兜底。
 */

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
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

const HWND_TOP = 0n;
const HWND_BOTTOM = 1n;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

const GWL_STYLE = -16;
const WS_CHILD = 0x40000000n;
const WS_POPUP = 0x80000000n;
const GA_PARENT = 1;

const USE_CHILD_STYLE = process.env.HS_DESKTOP_CHILD === '1';
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
    GetAsyncKeyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)'),
    FindWindowW: user32.func('uint64 __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)'),
    SetParent: user32.func('uint64 __stdcall SetParent(uint64 hWndChild, uint64 hWndNewParent)'),
    GetAncestor: user32.func('uint64 __stdcall GetAncestor(uint64 hWnd, uint gaFlags)'),
    GetWindowLongPtrW: user32.func('int64 __stdcall GetWindowLongPtrW(uint64 hWnd, int nIndex)'),
    SetWindowLongPtrW: user32.func('int64 __stdcall SetWindowLongPtrW(uint64 hWnd, int nIndex, int64 dwNewLong)'),
    GetLastError: koffi.load('kernel32.dll').func('uint __stdcall GetLastError()')
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

let progmanHwnd = 0n;
let attached = false;

function findProgman() {
  if (!api) return 0n;
  return asHwnd(api.FindWindowW('Progman', null));
}

/**
 * 取窗口的父窗口。
 * 注意不能用 GetParent：窗口没有 WS_CHILD 时它返回的是 owner（恒为 0），
 * 会让人误判成「没挂上桌面」。GetAncestor(GA_PARENT) 才是真正的父窗口。
 */
function desktopParentOf(hwnd) {
  if (!api) return 0n;
  return asHwnd(api.GetAncestor(hwnd, GA_PARENT));
}

/** 在自己所在的父窗口内提到最上层：盖住桌面图标层，但不越过普通窗口 */
function raiseOnDesktop(win) {
  if (!api || !win || win.isDestroyed()) return;
  try {
    api.SetWindowPos(hwndOf(win), HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  } catch {
    /* 窗口销毁瞬间忽略 */
  }
}

function pinToBottom(win) {
  if (!api || !win || win.isDestroyed()) return;
  try {
    api.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch {
    /* 窗口销毁瞬间忽略 */
  }
}

/** 把窗口挂到桌面（Progman）下面，返回是否成功 */
function attachToDesktop(win) {
  if (!api || !win || win.isDestroyed()) return false;

  const hwnd = hwndOf(win);
  const progman = findProgman();
  if (!progman) return false;
  progmanHwnd = progman;

  if (desktopParentOf(hwnd) === progman) {
    raiseOnDesktop(win);
    return true;
  }

  api.SetParent(hwnd, progman);
  if (desktopParentOf(hwnd) !== progman) {
    console.log('[desktop] SetParent 失败，错误码：', api.GetLastError(), 'hwnd=', hwnd, 'progman=', progman);
    return false;
  }

  if (USE_CHILD_STYLE) {
    // 真正的子窗口样式：Win+D 属于「最小化所有顶层窗口」，管不到子窗口
    const style = api.GetWindowLongPtrW(hwnd, GWL_STYLE);
    api.SetWindowLongPtrW(hwnd, GWL_STYLE, (style | WS_CHILD) & ~WS_POPUP);
  }

  raiseOnDesktop(win);
  return true;
}

function keepOnDesktop(win) {
  if (!win || win.isDestroyed() || DEBUG_TOPMOST) return;

  if (attached) {
    const hwnd = hwndOf(win);
    // 资源管理器重启/桌面重建后父窗口会失效，需要重新挂载
    if (!api || desktopParentOf(hwnd) !== progmanHwnd) {
      attached = attachToDesktop(win);
      if (!attached) {
        console.log('[desktop] 桌面挂载丢失，退回底层窗口');
        pinToBottom(win);
      }
      return;
    }
    raiseOnDesktop(win);
    return;
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
let dragTimer = null;

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 660;

async function boot() {
  migrateLegacyState();
  const saved = readState();
  const { workArea } = screen.getPrimaryDisplay();

  const width = Math.round(Number.isFinite(saved.width) ? saved.width : DEFAULT_WIDTH);
  const height = Math.round(Number.isFinite(saved.height) ? saved.height : DEFAULT_HEIGHT);
  const x = Math.round(Number.isFinite(saved.x) ? saved.x : workArea.x + workArea.width - width - 40);
  const y = Math.round(Number.isFinite(saved.y) ? saved.y : workArea.y + workArea.height - height - 40);

  const { url, server } = await createServer({ open: false });
  httpServer = server;

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
    focusable: false, // 点击不激活 → 不会把自己顶到最前
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
    attached = SKIP_ATTACH || DEBUG_TOPMOST ? false : attachToDesktop(win);
    console.log('[desktop] 桌面挂载：', attached ? 'Progman 子窗口' : '退回底层窗口');
    if (!attached && !DEBUG_TOPMOST) pinToBottom(win);
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

  // 兜底：万一仍被最小化（Win+D / 显示桌面），立刻恢复
  win.on('minimize', () => {
    console.log('[desktop] 收到最小化事件，立即恢复');
    if (!win || win.isDestroyed()) return;
    win.restore();
    win.showInactive();
    keepOnDesktop(win);
  });

  // 定时归位：层级被意外改动、或资源管理器重建桌面时自动修正
  const keeper = setInterval(() => keepOnDesktop(win), 1500);
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
    version: app.getVersion(),
    desktopLayer: attached
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

ipcMain.on('desktop:drag-start', () => {
  if (!win || win.isDestroyed()) return;

  const originCursor = screen.getCursorScreenPoint();
  // 尺寸只在拖动开始时取一次，之后每帧都带上同样的宽高：
  // 只调 setPosition 在 150% 缩放下会被反复取整，窗口会越拖越大。
  // 取整是有意为之：Electron 的 DIP 尺寸是物理像素 / 缩放比，直接回写小数会持续漂移。
  const origin = win.getBounds();
  origin.x = Math.round(origin.x);
  origin.y = Math.round(origin.y);
  origin.width = Math.round(origin.width);
  origin.height = Math.round(origin.height);

  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(dragTimer);
      dragTimer = null;
      return;
    }

    // 鼠标左键松开就结束；主进程轮询全局光标，鼠标移出窗口也不会中断拖动
    if (api && api.GetAsyncKeyState && (api.GetAsyncKeyState(0x01) & 0x8000) === 0) {
      stopDrag();
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const nextX = origin.x + (cursor.x - originCursor.x);
    const nextY = origin.y + (cursor.y - originCursor.y);

    if (api) {
      // 用 Win32 只挪位置（SWP_NOSIZE + SWP_NOZORDER）：
      // Electron 的 setBounds 每次都要在 DIP 与物理像素之间换算，150% 缩放下会累积取整误差，
      // 连拖几次窗口就会悄悄变大
      const scale = screen.getDisplayNearestPoint(cursor).scaleFactor || 1;
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
      win.setBounds({ x: nextX, y: nextY, width: origin.width, height: origin.height });
    }
  }, 16);
});

function stopDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
  if (!win || win.isDestroyed()) return;
  const [wx, wy] = win.getPosition();
  const [ww, wh] = win.getSize();
  writeState({ x: Math.round(wx), y: Math.round(wy), width: Math.round(ww), height: Math.round(wh) });
  if (attached) raiseOnDesktop(win);
  // 通知渲染层清掉拖动状态：鼠标在窗口外松开时它收不到 pointerup
  if (!win.webContents.isDestroyed()) win.webContents.send('desktop:drag-finished');
}

ipcMain.on('desktop:drag-end', () => {
  if (dragTimer) stopDrag();
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
    clearInterval(dragTimer);
    if (httpServer) httpServer.close();
  });

  app.on('window-all-closed', () => app.quit());
}
