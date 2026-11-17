'use strict';

/**
 * 桌面组件的渲染侧桥接：
 * 1. 注入「透明窗口」所需样式（原 index.html 一行不改，全部用覆盖实现）
 * 2. 把两层不透明度写进 CSS 变量并持久化
 * 3. 右键面板：两个滑块 + 刷新 + 工作目录管理（增/删）+ 退出；单击面板外任意位置即关闭
 * 4. 拖动：位移阈值判定 + 宿主 SetWindowPos 只改坐标
 * 5. 边缘拉伸：8 条感应区给光标方向，宿主接管鼠标捕获后改窗口矩形
 */

// ipcRenderer 由宿主注入：启动时本文件会被包进 /__hs/bridge.js，
// 宿主在最前面提供基于同源 POST 的实现，因此这里不需要任何模块加载器。

const STYLE_ID = 'hs-desktop-style';
const PANEL_ID = 'hs-desktop-panel';

const DEFAULTS = { shellOpacity: 1, cardOpacity: 0.56 };

let settings = { ...DEFAULTS };
let roots = [];
let panel = null;
let panelOpen = false;
let sliderActive = false;

/* ── 透明样式 ─────────────────────────────────────────────── */

const OVERRIDE_CSS = `
  /* 窗口本体透明，让桌面壁纸透出来 */
  html, body {
    background: transparent !important;
    background-image: none !important;
  }

  /* 去掉外层 24px 留白：否则窗口边缘留着一条透明但仍拦截鼠标的区域 */
  .stage { padding: 0 !important; }

  /* 外壳：由 --hs-shell 控制，默认 1（与原型一致） */
  .app-shell {
    background: rgba(255, 255, 255, var(--hs-shell, 1)) !important;
    box-shadow: 0 22px 56px rgba(0, 0, 0, 0.32) !important;
  }

  /* 内部各层不再叠白，避免半透明叠加把实际不透明度抬高 */
  .app-header,
  .board-area { background: transparent !important; }

  /* 看板区保留一点灰底层次，跟着外壳一起变透 */
  .board-panel {
    background: rgba(243, 244, 247, calc(var(--hs-shell, 1) * 0.6)) !important;
  }

  /* 项目卡：--hs-card 默认 0.56，等于原型的 --glass */
  .project {
    background: rgba(255, 255, 255, var(--hs-card, 0.56)) !important;
  }

  /* 抽屉自带不透明底，打开时保持可读 */
  .drawer { background: rgba(255, 255, 255, 0.97) !important; }

  /* ── 右键面板 ── */
  #${PANEL_ID} {
    display: none;
    position: fixed;
    z-index: 2147483000;
    width: 244px;
    padding: 14px 14px 12px;
    border-radius: 14px;
    background: rgba(26, 30, 40, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 18px 46px rgba(0, 0, 0, 0.46);
    color: #f4f5f7;
    font-family: "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.5;
    letter-spacing: -0.01em;
    user-select: none;
    pointer-events: auto;
  }

  #${PANEL_ID} .hs-kicker {
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.48);
    margin-bottom: 8px;
  }

  #${PANEL_ID} .hs-row {
    display: grid;
    grid-template-columns: 32px 1fr 38px;
    align-items: center;
    gap: 10px;
    margin-bottom: 2px;
  }

  #${PANEL_ID} .hs-label { color: rgba(255, 255, 255, 0.72); }

  #${PANEL_ID} .hs-value {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.9);
  }

  /* 轨道只有 4px，但控件本身留足 20px 高度，滑块才好按住 */
  #${PANEL_ID} input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 20px;
    margin: 0;
    background: transparent;
    outline: none;
    cursor: pointer;
  }

  #${PANEL_ID} input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
  }

  #${PANEL_ID} input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.2);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }

  #${PANEL_ID} .hs-divider {
    height: 1px;
    margin: 10px 0 9px;
    background: rgba(255, 255, 255, 0.12);
  }

  /* ── 通用按钮（刷新 / 添加目录）── */
  #${PANEL_ID} .hs-btn {
    appearance: none;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.86);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: center;
  }

  #${PANEL_ID} .hs-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  #${PANEL_ID} .hs-btn:active {
    background: rgba(255, 255, 255, 0.2);
  }

  #${PANEL_ID} .hs-btn[data-flash="1"] {
    border-color: rgba(120, 190, 120, 0.5);
    color: #c9f0c9;
  }

  /* ── 工作目录列表 ── */
  #${PANEL_ID} .hs-roots {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  #${PANEL_ID} .hs-root {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 9px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
  }

  #${PANEL_ID} .hs-root-path {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    direction: rtl; /* 超长时优先截断前缀（盘符），保留结尾的项目目录名 */
    text-align: left;
    color: rgba(255, 255, 255, 0.82);
    font-variant-numeric: tabular-nums;
  }

  #${PANEL_ID} .hs-root-x {
    appearance: none;
    flex: none;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    font: inherit;
    font-size: 13px;
    line-height: 18px;
    cursor: pointer;
  }

  #${PANEL_ID} .hs-root-x:hover {
    background: rgba(220, 80, 80, 0.3);
    color: #ffd9d4;
  }

  #${PANEL_ID} .hs-hint {
    font-size: 11px;
    line-height: 1.65;
    color: rgba(255, 255, 255, 0.46);
  }

  #${PANEL_ID} .hs-quit {
    appearance: none;
    width: 100%;
    margin-top: 10px;
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.86);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  #${PANEL_ID} .hs-quit:hover {
    background: rgba(220, 80, 80, 0.22);
    border-color: rgba(220, 80, 80, 0.42);
    color: #ffd9d4;
  }

  /* ── 边缘拉伸感应区（8px 边 / 16px 角）── */
  #hs-resize-layer {
    position: fixed;
    inset: 0;
    z-index: 2147482000;
    pointer-events: none;
  }

  #hs-resize-layer .hs-edge {
    position: absolute;
    background: transparent;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
  }

  /* 四角比圆角半径略留余量，保证窗口圆角裁剪后仍能按住拉伸 */
  .hs-edge[data-edge="left"]         { left: 0;  top: 22px; bottom: 22px; width: 8px;  cursor: ew-resize; }
  .hs-edge[data-edge="right"]        { right: 0; top: 22px; bottom: 22px; width: 8px;  cursor: ew-resize; }
  .hs-edge[data-edge="top"]          { top: 0;   left: 22px; right: 22px; height: 8px; cursor: ns-resize; }
  .hs-edge[data-edge="bottom"]       { bottom: 0; left: 22px; right: 22px; height: 8px; cursor: ns-resize; }
  .hs-edge[data-edge="top-left"]     { top: 0;    left: 0;  width: 22px; height: 22px; cursor: nwse-resize; }
  .hs-edge[data-edge="top-right"]    { top: 0;    right: 0; width: 22px; height: 22px; cursor: nesw-resize; }
  .hs-edge[data-edge="bottom-left"]  { bottom: 0; left: 0;  width: 22px; height: 22px; cursor: nesw-resize; }
  .hs-edge[data-edge="bottom-right"] { bottom: 0; right: 0; width: 22px; height: 22px; cursor: nwse-resize; }

  /* 抽屉打开时让开右侧滚动条，别把内容区的拖拽吞掉 */
  body:has(.drawer.is-open) #hs-resize-layer { display: none; }

  /* 拉伸中锁住光标：鼠标会移出感应区甚至移出窗口，不能变回箭头 */
  html.hs-resizing, html.hs-resizing * {
    cursor: var(--hs-resize-cursor, ew-resize) !important;
  }
`;

function injectOverrideStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = OVERRIDE_CSS;
  document.head.appendChild(style);
}

/* ── 透明度 ───────────────────────────────────────────────── */

function applyOpacity() {
  const root = document.documentElement;
  root.style.setProperty('--hs-shell', String(settings.shellOpacity));
  root.style.setProperty('--hs-card', String(settings.cardOpacity));
}

function persist() {
  ipcRenderer.invoke('desktop:set-opacity', {
    shellOpacity: settings.shellOpacity,
    cardOpacity: settings.cardOpacity
  });
}

/* ── 右键面板 ─────────────────────────────────────────────── */

/** 按钮点击后闪一下确认反馈（「已刷新」/「已添加」） */
function flashButton(button, text) {
  if (!button) return;
  const original = button.textContent;
  button.textContent = text;
  button.dataset.flash = '1';
  setTimeout(() => {
    button.textContent = original;
    delete button.dataset.flash;
  }, 900);
}

/** 把工作目录列表画进面板 */
function renderRoots() {
  if (!panel) return;
  const list = panel.querySelector('.hs-roots');
  if (!list) return;
  list.innerHTML = '';

  for (const dir of roots) {
    const row = document.createElement('div');
    row.className = 'hs-root';

    const path = document.createElement('span');
    path.className = 'hs-root-path';
    path.textContent = String(dir).split('\\').join('/');
    path.title = path.textContent;
    row.appendChild(path);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'hs-root-x';
    remove.setAttribute('aria-label', `移除工作目录 ${path.textContent}`);
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const result = await ipcRenderer.invoke('desktop:remove-root', dir);
        roots = result.roots || [];
        renderRoots();
      } finally {
        remove.disabled = false;
      }
    });
    row.appendChild(remove);

    list.appendChild(row);
  }
}

async function syncRoots() {
  try {
    const result = await ipcRenderer.invoke('desktop:get-roots');
    roots = result.roots || [];
  } catch {
    /* 拿不到就保持现值 */
  }
  renderRoots();
}

function buildPanel() {
  const el = document.createElement('div');
  el.id = PANEL_ID;
  el.innerHTML = `
    <div class="hs-kicker">外观</div>
    <div class="hs-row">
      <span class="hs-label">外壳</span>
      <input type="range" min="0" max="100" step="1" data-key="shellOpacity" aria-label="外壳不透明度" />
      <span class="hs-value" data-out="shellOpacity"></span>
    </div>
    <div class="hs-row">
      <span class="hs-label">卡片</span>
      <input type="range" min="0" max="100" step="1" data-key="cardOpacity" aria-label="卡片不透明度" />
      <span class="hs-value" data-out="cardOpacity"></span>
    </div>
    <div class="hs-divider"></div>
    <div class="hs-kicker">数据</div>
    <button type="button" class="hs-btn" data-act="refresh">刷新</button>
    <div class="hs-divider"></div>
    <div class="hs-kicker">工作目录（只展示含 HANDOFF.md 的文件夹）</div>
    <div class="hs-roots"></div>
    <button type="button" class="hs-btn" data-act="add-root">添加目录…</button>
    <div class="hs-divider"></div>
    <div class="hs-hint">按住卡片或空白处可拖动窗口<br />拖动四边 / 四角可调整大小<br />单击空白 / 右键再次点击可关闭本菜单<br />Ctrl+Alt+H 隐藏 · Ctrl+Alt+Q 退出</div>
    <button type="button" class="hs-quit">退出组件</button>
  `;

  el.querySelectorAll('input[type="range"]').forEach((input) => {
    const key = input.dataset.key;
    const out = el.querySelector(`[data-out="${key}"]`);
    input.value = String(Math.round(settings[key] * 100));
    out.textContent = `${input.value}%`;

    input.addEventListener('input', () => {
      settings[key] = Number(input.value) / 100;
      out.textContent = `${input.value}%`;
      applyOpacity();
    });
    input.addEventListener('change', persist);
    input.addEventListener('pointerdown', () => {
      sliderActive = true;
    });
  });

  // 刷新：主进程在页面主世界派发 hs-refresh，页面脚本静默重读 /api/projects
  el.querySelector('[data-act="refresh"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await ipcRenderer.invoke('desktop:refresh');
      flashButton(button, '已刷新');
    } finally {
      button.disabled = false;
    }
  });

  // 添加目录：主进程弹原生目录选择框（支持多选），选定即生效
  el.querySelector('[data-act="add-root"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await ipcRenderer.invoke('desktop:add-roots');
      roots = result.roots || [];
      renderRoots();
      if (result.added) flashButton(button, `已添加 ${result.added} 个`);
    } finally {
      button.disabled = false;
    }
  });

  el.querySelector('.hs-quit').addEventListener('click', () => {
    ipcRenderer.send('desktop:quit');
  });

  el.addEventListener('contextmenu', (event) => event.preventDefault());

  document.body.appendChild(el);

  return el;
}

function openPanel(x, y) {
  if (!panel) panel = buildPanel();

  // 打开时同步一次工作目录（可能在别处被修改）
  syncRoots();

  // 先把面板放到左上角量尺寸，再按鼠标位置夹在视口内
  panel.style.left = '0px';
  panel.style.top = '0px';
  panel.style.display = 'block';

  const rect = panel.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  panel.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  panel.style.top = `${Math.max(8, Math.min(y, maxY))}px`;

  panelOpen = true;
}

function closePanel() {
  if (!panel || !panelOpen) return;
  panel.style.display = 'none';
  panelOpen = false;
}

/* ── 边缘拉伸 ─────────────────────────────────────────────── */

// 名称要和宿主 resizeEdges 里的键一一对应；第二项是拉伸期间锁定的光标。
const RESIZE_EDGES = [
  ['left', 'ew-resize'],
  ['right', 'ew-resize'],
  ['top', 'ns-resize'],
  ['bottom', 'ns-resize'],
  ['top-left', 'nwse-resize'],
  ['top-right', 'nesw-resize'],
  ['bottom-left', 'nesw-resize'],
  ['bottom-right', 'nwse-resize']
];

function buildResizeHandles() {
  if (document.getElementById('hs-resize-layer')) return;
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', buildResizeHandles, { once: true });
    return;
  }
  const layer = document.createElement('div');
  layer.id = 'hs-resize-layer';
  for (const [edge] of RESIZE_EDGES) {
    const handle = document.createElement('div');
    handle.className = 'hs-edge';
    handle.dataset.edge = edge;
    layer.appendChild(handle);
  }
  document.body.appendChild(layer);
}

/** 按下感应区：只把方向交给宿主，之后的鼠标跟踪由 Win32 捕获负责 */
function startResize(edge) {
  const found = RESIZE_EDGES.find(([name]) => name === edge);
  const root = document.documentElement;
  root.style.setProperty('--hs-resize-cursor', found ? found[1] : 'ew-resize');
  root.classList.add('hs-resizing');
  ipcRenderer.send('desktop:resize-start', { edge });
}

/** 收尾解锁光标。宿主捕获了鼠标时网页收不到 pointerup，所以要监听宿主派发的事件 */
function endResize() {
  const root = document.documentElement;
  if (!root.classList.contains('hs-resizing')) return;
  root.classList.remove('hs-resizing');
  root.style.removeProperty('--hs-resize-cursor');
  ipcRenderer.send('desktop:resize-end');
}

/* ── 拖动窗口 ─────────────────────────────────────────────── */

// 需要独占鼠标手势的控件：滑条之类不能一边拖控件一边拖窗口。
// 其余位置（卡片、标题、留白）一律可拖——是不是拖动交给位移阈值去判，
// 不要用选择器黑名单，否则卡片里几乎每个像素都被某个 a/button 盖住，等于全卡不可拖。
const NO_DRAG = 'input, select, textarea';

let dragOrigin = null; // { screenX, screenY }
let dragging = false; // 已经越过阈值
let suppressClick = false; // 拖完松手的那一次 click 要吃掉
let lastSent = 0;

function endDrag() {
  if (!dragOrigin) return;
  dragOrigin = null;
  if (dragging) {
    dragging = false;
    suppressClick = true;
    document.documentElement.style.cursor = '';
  }
  ipcRenderer.send('desktop:drag-end');
}

function bindInteractions() {
  document.addEventListener(
    'pointerdown',
    (event) => {
      // 感应区优先：边缘按下只能拉伸，不能同时进入拖动手势
      const handle = event.target.closest('.hs-edge');
      if (handle) {
        if (panelOpen) closePanel();
        if (event.button !== 0) return;
        event.preventDefault();
        startResize(handle.dataset.edge);
        return;
      }

      const inPanel = event.target.closest(`#${PANEL_ID}`);
      if (inPanel) {
        if (event.target.matches('input[type="range"]')) sliderActive = true;
        return;
      }

      // 面板外任何一次按下（含右键）都先把菜单收起来
      if (panelOpen) closePanel();

      if (event.button !== 0) return;
      if (event.target.closest(NO_DRAG)) return;
      // 抽屉打开时优先保证正文里能选字、滚动
      if (event.target.closest('.drawer.is-open')) return;

      // 不拦默认行为的话，按下后会进入浏览器的「拖选文本」，
      // 浏览器随即派发 pointercancel，拖动刚起步就被取消（还会把看板横向滚偏）
      event.preventDefault();

      // 用 screenX/screenY 而不是 clientX/clientY：窗口跟着鼠标移动，
      // 指针相对窗口的位置几乎不变，只有屏幕坐标才反映真实位移
      dragOrigin = { screenX: event.screenX, screenY: event.screenY };
      lastSent = event.timeStamp;
    },
    true
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!dragOrigin) return;
      if ((event.buttons & 1) === 0) {
        endDrag();
        return;
      }

      if (!dragging) {
        // 阈值以下当作点击，超过才真正开始搬窗口
        const dx = event.screenX - dragOrigin.screenX;
        const dy = event.screenY - dragOrigin.screenY;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        dragging = true;
        document.documentElement.style.cursor = 'grabbing';
        ipcRenderer.send('desktop:drag-start', dragOrigin);
      }

      // 高频指针事件下适当节流，避免每 1ms 一次 IPC
      if (event.timeStamp - lastSent < 16) return;
      lastSent = event.timeStamp;
      ipcRenderer.send('desktop:drag-move', {
        screenX: event.screenX,
        screenY: event.screenY
      });
    },
    true
  );

  const release = () => {
    sliderActive = false;
    endResize();
    endDrag();
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  // 拖动结束时那一下 click 不该再触发卡片上的链接
  document.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true
  );

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openPanel(event.clientX, event.clientY);
  });

  // 鼠标离开组件即视为点了外面（窗口可能没激活、收不到 blur）
  document.addEventListener('mouseleave', () => {
    if (sliderActive) return;
    closePanel();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });

  window.addEventListener('resize', closePanel);

  // 宿主接管鼠标捕获后网页收不到 pointerup，由宿主主动派发这个事件收尾
  window.addEventListener('hs-resize-end', endResize);
}

/* ── 初始化 ───────────────────────────────────────────────── */

async function init() {
  injectOverrideStyle();
  buildResizeHandles();

  try {
    const saved = await ipcRenderer.invoke('desktop:bootstrap');
    if (saved) {
      if (Number.isFinite(saved.shellOpacity)) settings.shellOpacity = saved.shellOpacity;
      if (Number.isFinite(saved.cardOpacity)) settings.cardOpacity = saved.cardOpacity;
      if (Array.isArray(saved.roots)) roots = saved.roots;
    }
  } catch {
    // 读取失败就用默认值
  }

  applyOpacity();
  bindInteractions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
