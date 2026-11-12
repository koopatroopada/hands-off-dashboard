#!/usr/bin/env node
'use strict';

/**
 * npm run dist 的入口。
 *
 * electron-builder 默认从 GitHub releases 下载 NSIS / winCodeSign 等二进制，
 * 而 github.com 在部分网络环境里不可达。这里默认改走 npmmirror 镜像；
 * 如果外部已经设置了 ELECTRON_BUILDER_BINARIES_MIRROR，则以外部为准。
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const cli = path.join(projectDir, 'node_modules', 'electron-builder', 'cli.js');
const mirror = process.env.ELECTRON_BUILDER_BINARIES_MIRROR
  || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const result = spawnSync(process.execPath, [cli, '--win', '--x64'], {
  cwd: projectDir,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILDER_BINARIES_MIRROR: mirror }
});

process.exit(result.status == null ? 1 : result.status);
