#!/usr/bin/env node
/**
 * 构建轻量版（Go + 系统 WebView2）的一键安装包。
 *
 * 与 Electron 版 `npm run dist` 并列，互不影响：
 *   npm run dist          → Electron 版安装包（约 117 MB）
 *   npm run dist:lite     → 轻量版安装包（约 4.7 MB）
 *
 * 步骤：go build → 取 WebView2 引导程序 → makensis → 报告体积。
 * 工具链位置可用环境变量覆盖：GO_BIN / NSIS_MAKENSIS。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LITE = path.join(ROOT, 'lite');
const BUILD = path.join(LITE, 'build');

const GO_BIN = process.env.GO_BIN || 'D:/2Enviroment/Go/bin/go.exe';
const GOPATH = process.env.GOPATH_DIR || 'D:/2Enviroment/Go/gopath';
const NSIS = process.env.NSIS_MAKENSIS
  || 'C:/Users/adaic/AppData/Local/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-w8az6/makensis.exe';
const WV2_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
const WV2_FILE = path.join(BUILD, 'MicrosoftEdgeWebview2Setup.exe');
const OUT = path.join(BUILD, 'Hands-off-Dashboard-Lite-Setup-1.0.0.exe');

function step(msg) {
  console.log(`\n[dist:lite] ${msg}`);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function buildGo() {
  step('编译 Go 宿主');
  run(GO_BIN, ['build', '-ldflags', '-s -w -H windowsgui', '-o', 'hs-lite.exe', '.'], {
    cwd: LITE,
    env: {
      ...process.env,
      GOPATH,
      GOMODCACHE: path.join(GOPATH, 'pkg/mod'),
      GOPROXY: process.env.GOPROXY || 'https://goproxy.cn,direct',
      CGO_ENABLED: '0',
      PATH: `${path.dirname(GO_BIN)}${path.delimiter}${process.env.PATH}`
    }
  });
  const exe = path.join(LITE, 'hs-lite.exe');
  console.log(`  → ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
}

async function fetchWebView2() {
  if (fs.existsSync(WV2_FILE)) {
    console.log(`  WebView2 引导程序已存在，跳过下载`);
    return;
  }
  step('下载 WebView2 引导程序（微软官方，约 1.9 MB）');
  const res = await fetch(WV2_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(WV2_FILE, Buffer.from(await res.arrayBuffer()));
  console.log(`  → ${WV2_FILE} (${(fs.statSync(WV2_FILE).size / 1048576).toFixed(1)} MB)`);
}

function buildInstaller() {
  step('打包 NSIS 安装包');
  fs.mkdirSync(BUILD, { recursive: true });
  const makensis = fs.existsSync(NSIS) ? NSIS : 'makensis';
  run(makensis, ['installer.nsi'], { cwd: LITE });
}

(async () => {
  try {
    buildGo();
    await fetchWebView2();
    buildInstaller();
    const size = fs.statSync(OUT).size;
    console.log(`\n[dist:lite] 完成：${OUT}`);
    console.log(`[dist:lite] 安装包 ${(size / 1048576).toFixed(2)} MB（${size} 字节）`);
    if (size > 20 * 1048576) {
      console.log('[dist:lite] 警告：超过 20 MB 目标');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\n[dist:lite] 失败：${error.message}`);
    process.exitCode = 1;
  }
})();
