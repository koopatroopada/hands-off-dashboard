'use strict';

/**
 * 桌面组件的渲染侧桥接：
 * 1. 注入「透明窗口」所需样式（原 index.html 一行不改，全部用覆盖实现）
 * 2. 把两层不透明度写进 CSS 变量并持久化
 * 3. 右键面板：两个滑块 + 退出；单击面板外任意位置即关闭
 * 4. 拖动：按住任意非控件区域（卡片、留白都可）挪动窗口，
 *    位移超过阈值才算拖动，普通单击仍然照常触发页面交互
 */

const { ipcRenderer } = require('electron');

const STYLE_ID = 'hs-desktop-style';
const PANEL_ID = 'hs-desktop-panel';
const DRAG_THRESHOLD = 4;

const DEFAULTS = { shellOpacity: 1, cardOpacity: 0.56 };

let settings = { ...DEFAULTS };
let panel = null;
let panelOpen = false;
let sliderActive = false;
let pendingDrag = null; // { x, y }
let dragging = false;

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

  /* 拖动时光标提示 */
  .hs-dragging, .hs-dragging * {
    cursor: grabbing !important;
    user-select: none !important;
  }

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
    <div class="hs-hint">按住卡片或空白处可拖动窗口<br />单击空白 / 右键再次点击可关闭本菜单<br />Ctrl+Alt+H 隐藏 · Ctrl+Alt+Q 退出</div>
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

  el.querySelector('.hs-quit').addEventListener('click', () => {
    ipcRenderer.send('desktop:quit');
  });

  el.addEventListener('contextmenu', (event) => event.preventDefault());

  document.body.appendChild(el);

  return el;
}

function openPanel(x, y) {
  if (!panel) panel = buildPanel();

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

/* ── 拖动窗口 ─────────────────────────────────────────────── */

// 真正需要独占鼠标的控件不参与拖动；其余（卡片、留白、标题）都可以按下拖动
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], .doc-link, .why-toggle, .pin, .sort-button, .drawer';

function startDrag() {
  pendingDrag = null;
  dragging = true;
  document.documentElement.classList.add('hs-dragging');
  ipcRenderer.send('desktop:drag-start');
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  document.documentElement.classList.remove('hs-dragging');
  ipcRenderer.send('desktop:drag-end');
}

function resetDrag() {
  dragging = false;
  pendingDrag = null;
  document.documentElement.classList.remove('hs-dragging');
}

function bindInteractions() {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const inPanel = event.target.closest(`#${PANEL_ID}`);
      if (inPanel) {
        if (event.target.matches('input[type="range"]')) sliderActive = true;
        return;
      }

      // 面板外任何一次按下（含右键）都先把菜单收起来
      if (panelOpen) closePanel();

      if (event.button !== 0) return;
      if (event.target.closest(INTERACTIVE)) return;

      // 上一次拖动若在窗口外松开，状态可能残留，这里先复位
      if (dragging) resetDrag();

      // 关键：不做这一步，按下后会进入浏览器的「拖选文本」，
      // 浏览器随即派发 pointercancel，拖动刚起步就被取消（还会把看板横向滚偏）
      event.preventDefault();

      pendingDrag = { x: event.clientX, y: event.clientY };
    },
    true
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (dragging) return; // 拖动中由主进程轮询光标，更平滑
      if (!pendingDrag) return;
      if ((event.buttons & 1) === 0) {
        pendingDrag = null;
        return;
      }
      const dx = event.clientX - pendingDrag.x;
      const dy = event.clientY - pendingDrag.y;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      startDrag();
    },
    true
  );

  const release = () => {
    pendingDrag = null;
    sliderActive = false;
    endDrag();
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  // 拖动窗口时不要触发浏览器原生拖拽（图片/链接被拖走会很怪）
  document.addEventListener('dragstart', (event) => event.preventDefault());

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openPanel(event.clientX, event.clientY);
  });

  // 窗口不激活、也收不到 blur，鼠标离开窗口即视为点了外面
  document.addEventListener('mouseleave', () => {
    if (dragging || sliderActive) return;
    closePanel();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });

  window.addEventListener('resize', closePanel);

  ipcRenderer.on('desktop:drag-finished', resetDrag);
}

/* ── 初始化 ───────────────────────────────────────────────── */

async function init() {
  injectOverrideStyle();

  try {
    const saved = await ipcRenderer.invoke('desktop:bootstrap');
    if (saved) {
      if (Number.isFinite(saved.shellOpacity)) settings.shellOpacity = saved.shellOpacity;
      if (Number.isFinite(saved.cardOpacity)) settings.cardOpacity = saved.cardOpacity;
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
