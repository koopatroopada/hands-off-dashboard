'use strict';

/**
 * Hands-off Dashboard · 桌面组件主进程
 *
 * 目标形态：无边框、背景透明、贴在桌面最底层（被普通窗口盖住），
 * 点击不会把自己顶到前面，右键可调两层不透明度。
 *
 * 层级实现说明：Electron 没有「桌面层」API，Windows 上只能调 Win32
 * 的 SetWindowPos(hwnd, HWND_BOTTOM)。配合 focusable: false
 * （等价于 WS_EX_NOACTIVATE），点击窗口不会激活它，也就不会弹到前面。
 */

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createServer } = require('../server.js');

const APP_TITLE = 'Hands-off Dashboard';

const stateFile = () => path.join(app.getPath('userData'), 'desktop-state.json');

/* ── Win32 ─────────────────────────────────────────────────── */

const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

let SetWindowPos = null;
let GetAsyncKeyState = null;

try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  SetWindowPos = user32.func(
    'bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, unsigned int uFlags)'
  );
  GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
} catch (error) {
  console.error('[desktop] 无法加载 user32.dll，窗口将无法钉在桌面层：', error.message);
}

function hwndOf(win) {
  const buffer = win.getNativeWindowHandle();
  // koffi 只接受 number/BigInt 形式的句柄，传 Buffer 会返回 false
  return buffer.length === 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

function pinToBottom(win) {
  if (!SetWindowPos || !win || win.isDestroyed()) return;
  try {
    SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch (error) {
    // 窗口关闭瞬间可能拿不到句柄，忽略即可
  }
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
  const saved = readState();
  const { workArea } = screen.getPrimaryDisplay();

  const width = Number.isFinite(saved.width) ? saved.width : DEFAULT_WIDTH;
  const height = Number.isFinite(saved.height) ? saved.height : DEFAULT_HEIGHT;
  const x = Number.isFinite(saved.x) ? saved.x : workArea.x + workArea.width - width - 40;
  const y = Number.isFinite(saved.y) ? saved.y : workArea.y + workArea.height - height - 40;

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
    pinToBottom(win);
  });

  await win.loadURL(url);

  win.webContents.on('did-finish-load', () => pinToBottom(win));

  // 位置与尺寸记忆（防抖）
  let saveTimer = null;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [wx, wy] = win.getPosition();
      const [ww, wh] = win.getSize();
      writeState({ x: wx, y: wy, width: ww, height: wh });
    }, 400);
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);

  // 定时压回底层：任何意外把它提上台面时都能自动归位
  const keeper = setInterval(() => pinToBottom(win), 1500);
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
    version: app.getVersion()
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
  const [originX, originY] = win.getPosition();

  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(dragTimer);
      dragTimer = null;
      return;
    }

    // 鼠标左键松开就结束；主进程轮询全局光标，鼠标移出窗口也不会中断拖动
    if (GetAsyncKeyState && (GetAsyncKeyState(0x01) & 0x8000) === 0) {
      clearInterval(dragTimer);
      dragTimer = null;
      const [wx, wy] = win.getPosition();
      const [ww, wh] = win.getSize();
      writeState({ x: wx, y: wy, width: ww, height: wh });
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    win.setPosition(originX + (cursor.x - originCursor.x), originY + (cursor.y - originCursor.y));
  }, 16);
});

ipcMain.on('desktop:drag-end', () => {
  clearInterval(dragTimer);
  dragTimer = null;
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
      pinToBottom(win);
    }
  });

  app.whenReady().then(async () => {
    await boot();

    globalShortcut.register('Control+Alt+H', () => {
      if (!win || win.isDestroyed()) return;
      if (win.isVisible()) win.hide();
      else {
        win.showInactive();
        pinToBottom(win);
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
