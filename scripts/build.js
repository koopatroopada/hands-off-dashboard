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
const TOOLCHAIN = path.join(ROOT, '.toolchain');
const VERSION = require(path.join(ROOT, 'package.json')).version;

// 本机没装 Go / NSIS 时用仓库里下载好的 .toolchain（被 .gitignore 忽略）。
const LOCAL_GO = path.join(TOOLCHAIN, 'goroot', 'go', 'bin', 'go.exe');
const GO_BIN = process.env.GO_BIN || (fs.existsSync(LOCAL_GO) ? LOCAL_GO : 'D:/2Enviroment/Go/bin/go.exe');
const GOPATH =
  process.env.GOPATH_DIR || (fs.existsSync(TOOLCHAIN) ? path.join(TOOLCHAIN, 'gopath') : 'D:/2Enviroment/Go/gopath');
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
    path.join(TOOLCHAIN, 'nsis', 'makensis.exe'),
    'C:/Program Files (x86)/NSIS/makensis.exe',
    path.join(os.homedir(), 'AppData/Local/Programs/NSIS/makensis.exe'),
    // 本机若装过 electron-builder，复用它下载的 NSIS 3.x。
    path.join(os.homedir(), 'AppData/Local/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-w8az6/makensis.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'makensis';
}

function buildGo() {
  step('编译桌面宿主（Go）');
  const env = {
    ...process.env,
    GOPATH,
    GOMODCACHE: path.join(GOPATH, 'pkg/mod'),
    GOPROXY: process.env.GOPROXY || 'https://goproxy.cn,direct',
    CGO_ENABLED: '0',
    PATH: `${path.dirname(GO_BIN)}${path.delimiter}${process.env.PATH}`,
  };
  // Go 默认在 %TEMP% 下建 work dir，某些受限环境会拒绝；指向 .toolchain 即可。
  if (fs.existsSync(TOOLCHAIN)) {
    env.GOCACHE = process.env.GOCACHE || path.join(TOOLCHAIN, 'gocache');
    env.GOTMPDIR = process.env.GOTMPDIR || path.join(TOOLCHAIN, 'gotmp');
    fs.mkdirSync(env.GOTMPDIR, { recursive: true });
  }

  // 少数环境里 go 无法直接覆盖 app\hs-dashboard.exe（它用临时文件 + rename 落盘，
  // 而工作区根目录上有「禁止删除子项」的权限项，rename 会被拒）。
  // 先编译到 .toolchain/out，再整文件拷回去就绕开了这一步。
  if (fs.existsSync(TOOLCHAIN)) {
    const staging = path.join(TOOLCHAIN, 'out');
    fs.mkdirSync(staging, { recursive: true });
    const staged = path.join(staging, 'hs-dashboard.exe');
    const args = ['build', '-ldflags', '-s -w -H windowsgui'];
    try {
      run(GO_BIN, [...args, '-o', HOST_EXE, '.'], { cwd: APP, env, stdio: 'pipe' });
    } catch (error) {
      const detail = `${error.stdout || ''}${error.stderr || ''}`.trim();
      if (!/Access is denied|拒绝访问/i.test(detail)) {
        console.error(detail);
        throw error;
      }
      run(GO_BIN, [...args, '-o', staged, '.'], { cwd: APP, env });
      fs.copyFileSync(staged, HOST_EXE);
      fs.rmSync(staged, { force: true });
      console.log('  （无法直接覆盖 exe，已改为先编译到临时目录再拷回）');
    }
  } else {
    run(GO_BIN, ['build', '-ldflags', '-s -w -H windowsgui', '-o', HOST_EXE, '.'], { cwd: APP, env });
  }

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
  const nsis = findNSIS();

  // 先在正常路径试一次，失败再走临时目录兜底；首次尝试的日志先攒着，
  // 免得兜底成功时终端里还留着一段 "Can't open output file" 的假报错。
  try {
    run(nsis, ['installer.nsi'], { cwd: APP, stdio: 'pipe' });
    return;
  } catch (error) {
    const firstAttempt = `${error.stdout || ''}${error.stderr || ''}`.trim();
    // 少数环境里 makensis 无法把 OutFile 直接写进 app\build（报 Can't open output file），
    // 退一步：改写到项目根的临时目录打包，再把成品拷回 build。
    const staging = path.join(ROOT, '.nsis-out');
    fs.mkdirSync(staging, { recursive: true });
    const script = fs.readFileSync(path.join(APP, 'installer.nsi'), 'utf8');
    const patched = script.replace(
      /^OutFile\s+"[^"]*"/m,
      `OutFile "${path.join(staging, path.basename(OUT)).replace(/\\/g, '\\\\')}"`
    );
    if (patched === script) {
      console.error(firstAttempt);
      throw error;
    }
    const tempNsi = path.join(APP, '.installer-build.nsi');
    // installer.nsi 必须带 UTF-8 BOM，临时副本也一样。
    fs.writeFileSync(tempNsi, '\ufeff' + patched.replace(/^\ufeff/, ''), 'utf8');
    try {
      run(nsis, [path.basename(tempNsi)], { cwd: APP });
    } catch (fallbackError) {
      console.error(firstAttempt);
      throw fallbackError;
    } finally {
      fs.rmSync(tempNsi, { force: true });
    }
    const staged = path.join(staging, path.basename(OUT));
    if (!fs.existsSync(staged)) {
      console.error(firstAttempt);
      throw error;
    }
    fs.copyFileSync(staged, OUT);
    fs.rmSync(staging, { recursive: true, force: true });
    console.log('  （app\\build 无法直接写出，已改为先输出到临时目录再拷回）');
  }
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
