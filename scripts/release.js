#!/usr/bin/env node
/**
 * 发布 GitHub Release：读版本号 → 确认安装包 → 建 tag/Release → 上传 asset → 校验 digest。
 *
 *   node scripts/release.js                 # 创建（或复用）当前版本的 Release 并上传
 *   node scripts/release.js --dry-run       # 只打印将要做什么
 *   node scripts/release.js --notes notes.md  # 用文件内容作为 Release 说明
 *   node scripts/release.js --replace       # 同名 asset 已存在时删掉重传
 *   node scripts/release.js --build         # 安装包不存在时先跑 npm run dist
 *
 * 凭据从 Windows 凭据管理器（git credential）动态读取，脚本和命令行里都不出现明文 token。
 * 需要 PAT 具备 repo 权限；GITHUB_TOKEN 环境变量可覆盖。
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const VERSION = PKG.version;
const TAG = `v${VERSION}`;
const ASSET = path.join(ROOT, 'app', 'build', `Hands-off-Dashboard-Setup-${VERSION}.exe`);
const GIT = process.env.GIT_BIN || 'git';
const API = 'https://api.github.com';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = has('--dry-run');
const REPLACE = has('--replace');
const BUILD = has('--build');

function step(msg) {
  console.log(`\n[release] ${msg}`);
}

function fail(msg) {
  console.error(`\n[release] 失败：${msg}`);
  process.exit(1);
}

/* ── 仓库与凭据 ───────────────────────────────────────────── */

function git(args, opts = {}) {
  return execFileSync(GIT, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

/** 从 origin 的 URL 解析 owner/repo，兼容 https 与 ssh 两种写法。 */
function detectRepo() {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;
  let url = '';
  try {
    url = git(['config', '--get', 'remote.origin.url']).trim();
  } catch {
    fail('读不到 remote.origin.url，先确认这是一个带 origin 的 git 仓库');
  }
  const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) fail(`无法从 origin URL 解析 owner/repo：${url}`);
  return `${m[1]}/${m[2]}`;
}

function detectBranch() {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch {
    return 'main';
  }
}

/** 走 git credential 拿 token，避免在脚本、命令行、日志里出现明文。 */
function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execFileSync(GIT, ['credential', 'fill'], {
      cwd: ROOT,
      encoding: 'utf8',
      input: 'protocol=https\nhost=github.com\n\n',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const m = out.match(/^password=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* 落到下面的报错 */
  }
  fail('拿不到 GitHub 凭据：git credential 里没有 github.com 的记录，也没有 GITHUB_TOKEN');
}

async function api(token, method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hands-off-dashboard-release',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

/* ── 安装包 ───────────────────────────────────────────────── */

function ensureInstaller() {
  if (fs.existsSync(ASSET)) return;
  if (!BUILD) {
    fail(`找不到安装包：${ASSET}\n先跑 npm run dist，或者加 --build 让本脚本代跑`);
  }
  step('安装包不存在，先执行 npm run dist');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (!fs.existsSync(ASSET)) fail(`构建结束仍未找到 ${ASSET}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function defaultNotes() {
  return [
    `## 本次更新`,
    '',
    '- 见仓库提交记录：https://github.com/' + REPO + '/commits/' + BRANCH,
    '',
    '## 下载安装',
    '',
    `双击 \`${path.basename(ASSET)}\` 即可。**没有安装向导、不需要管理员权限**：自动装到当前用户目录，装完立刻启动，看板直接出现在桌面上。同时生成桌面快捷方式、开始菜单入口、开机自启和卸载项。`,
    '',
    `- 安装包：${sizeMb()} MB`,
    '- 适用：Windows 10 / 11',
    '- 前提：系统 WebView2 运行时（Win11 与多数 Win10 已自带；缺失时安装器会联网静默补齐）',
    '',
    '详细用法与 `HANDOFF.md` 格式见 [README](https://github.com/' + REPO + '#readme)。',
  ].join('\n');
}

function sizeMb() {
  return (fs.statSync(ASSET).size / 1048576).toFixed(1);
}

/* ── 主流程 ───────────────────────────────────────────────── */

let REPO = '';
let BRANCH = '';

(async () => {
  REPO = detectRepo();
  BRANCH = detectBranch();
  ensureInstaller();

  const size = fs.statSync(ASSET).size;
  const digest = sha256(ASSET);
  step(`仓库 ${REPO} · 版本 ${VERSION} · 分支 ${BRANCH}`);
  console.log(`  安装包 ${path.basename(ASSET)}`);
  console.log(`  ${size} 字节（${sizeMb()} MB）`);
  console.log(`  sha256 ${digest}`);

  if (DRY_RUN) {
    step('--dry-run：以下动作不会真的执行');
    console.log(`  1. 创建（或复用）tag ${TAG} 与 Release`);
    console.log(`  2. 上传 asset ${path.basename(ASSET)}`);
    console.log(`  3. 校验服务端 digest 与本地一致`);
    return;
  }

  const token = getToken();

  // 工作区有未提交改动只警告，不阻断——发布的是已经构建好的二进制。
  try {
    if (git(['status', '--porcelain']).trim()) {
      console.log('\n  ⚠ 工作区有未提交改动，发布前建议先提交');
    }
  } catch {
    /* 忽略 */
  }

  step('查找已有 Release');
  const found = await api(token, 'GET', `/repos/${REPO}/releases/tags/${TAG}`);
  let release = null;
  if (found.ok) {
    release = found.data;
    console.log(`  已存在 Release ${TAG}（id ${release.id}），复用`);
  } else if (found.status === 404) {
    step(`创建 Release ${TAG}`);
    const notesFile = valueOf('--notes');
    const body = notesFile ? fs.readFileSync(path.resolve(ROOT, notesFile), 'utf8') : defaultNotes();
    const created = await api(token, 'POST', `/repos/${REPO}/releases`, {
      tag_name: TAG,
      target_commitish: BRANCH,
      name: `Hands-off Dashboard ${TAG}`,
      draft: false,
      prerelease: false,
      body,
    });
    if (!created.ok) fail(`创建 Release 失败：HTTP ${created.status} ${JSON.stringify(created.data)}`);
    release = created.data;
    console.log(`  已创建（id ${release.id}）`);
  } else {
    fail(`查询 Release 失败：HTTP ${found.status} ${JSON.stringify(found.data)}`);
  }

  const assetName = path.basename(ASSET);
  const existing = (release.assets || []).find((a) => a.name === assetName);
  if (existing) {
    const sameSize = existing.size === size;
    const sameDigest = (existing.digest || '').replace(/^sha256:/, '') === digest;
    if (sameSize && sameDigest) {
      step('asset 已存在且与本地一致，跳过上传');
      console.log(`  https://github.com/${REPO}/releases/download/${TAG}/${assetName}`);
      return;
    }
    if (!REPLACE) {
      fail(
        `asset ${assetName} 已存在但内容不同（服务端 ${existing.size} 字节）。\n` +
          '确认要覆盖就加 --replace'
      );
    }
    step(`删除旧 asset ${assetName}`);
    const del = await api(token, 'DELETE', `/repos/${REPO}/releases/assets/${existing.id}`);
    if (!del.ok && del.status !== 204) fail(`删除旧 asset 失败：HTTP ${del.status}`);
  }

  step('上传 asset');
  const uploadUrl = `${release.upload_url.split('{')[0]}?name=${encodeURIComponent(assetName)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hands-off-dashboard-release',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
    },
    body: fs.readFileSync(ASSET),
  });
  const uploaded = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) fail(`上传失败：HTTP ${uploadRes.status} ${JSON.stringify(uploaded)}`);
  console.log(`  已上传：${uploaded.name} · ${uploaded.size} 字节 · ${uploaded.state}`);

  step('校验 digest');
  const serverDigest = (uploaded.digest || '').replace(/^sha256:/, '');
  if (!serverDigest) {
    console.log('  服务端未返回 digest，改为复查 asset 大小');
  } else if (serverDigest !== digest) {
    fail(`digest 不一致：本地 ${digest}，服务端 ${serverDigest}`);
  } else {
    console.log(`  一致：sha256:${digest}`);
  }

  const finalCheck = await api(token, 'GET', `/repos/${REPO}/releases/tags/${TAG}`);
  const assets = finalCheck.ok ? finalCheck.data.assets || [] : [];
  const mine = assets.find((a) => a.name === assetName);
  if (!mine) fail('发布后复查不到该 asset');
  if (mine.size !== size) fail(`复查大小不一致：本地 ${size}，服务端 ${mine.size}`);

  step(`完成：https://github.com/${REPO}/releases/tag/${TAG}`);
  console.log(
    `  直链：https://github.com/${REPO}/releases/download/${TAG}/${assetName}`
  );
})().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
