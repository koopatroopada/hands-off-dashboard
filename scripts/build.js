#!/usr/bin/env node
/**
 * 构建 Windows 一键安装包：编译 Go 宿主 → 准备 WebView2 引导程序 → NSIS 打包。
 *
 *   npm run dist
 *
 * 工具链可用环境变量覆盖：GO_BIN / GOPATH_DIR / NSIS_MAKENSIS。
 * 产物：app/build/Hands-off-Dashboard-Setup-<version>.exe
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const BUILD = path.join(APP, 'build');
const VERSION = require(path.join(ROOT, 'package.json')).version;

const GO_BIN = process.env.GO_BIN || 'D:/2Enviroment/Go/bin/go.exe';
const GOPATH = process.env.GOPATH_DIR || 'D:/2Enviroment/Go/gopath';
const WV2_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
const WV2_FILE = path.join(BUILD, 'MicrosoftEdgeWebview2Setup.exe');
const HOST_EXE = path.join(APP, 'hs-dashboard.exe');
const OUT = path.join(BUILD, `Hands-off-Dashboard-Setup-${VERSION}.exe`);

function step(msg) {
  console.log(`\n[dist] ${msg}`);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function findNSIS() {
  if (process.env.NSIS_MAKENSIS) return process.env.NSIS_MAKENSIS;
  const candidates = [
    'C:/Program Files (x86)/NSIS/makensis.exe',
    path.join(os.homedir(), 'AppData/Local/Programs/NSIS/makensis.exe'),
    // 本机若装过 electron-builder，复用它下载的 NSIS 3.x。
    path.join(os.homedir(), 'AppData/Local/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-w8az6/makensis.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'makensis';
}

function buildGo() {
  step('编译桌面宿主（Go）');
  run(GO_BIN, ['build', '-ldflags', '-s -w -H windowsgui', '-o', 'hs-dashboard.exe', '.'], {
    cwd: APP,
    env: {
      ...process.env,
      GOPATH,
      GOMODCACHE: path.join(GOPATH, 'pkg/mod'),
      GOPROXY: process.env.GOPROXY || 'https://goproxy.cn,direct',
      CGO_ENABLED: '0',
      PATH: `${path.dirname(GO_BIN)}${path.delimiter}${process.env.PATH}`,
    },
  });
  console.log(`  → ${HOST_EXE} (${(fs.statSync(HOST_EXE).size / 1048576).toFixed(1)} MB)`);
}

async function fetchWebView2() {
  if (fs.existsSync(WV2_FILE)) {
    console.log('  WebView2 引导程序已存在，跳过下载');
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
  step('打包一键安装包（NSIS）');
  fs.mkdirSync(BUILD, { recursive: true });
  run(findNSIS(), ['installer.nsi'], { cwd: APP });
}

(async () => {
  try {
    buildGo();
    await fetchWebView2();
    buildInstaller();
    const size = fs.statSync(OUT).size;
    console.log(`\n[dist] 完成：${OUT}`);
    console.log(`[dist] 安装包 ${(size / 1048576).toFixed(2)} MB（${size} 字节）`);
    if (size > 20 * 1048576) {
      console.log('[dist] 警告：超过 20 MB 目标');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\n[dist] 失败：${error.message}`);
    console.error('提示：需要 Go 1.27+ 与 NSIS 3.x，可用 GO_BIN / GOPATH_DIR / NSIS_MAKENSIS 指定路径。');
    process.exitCode = 1;
  }
})();
