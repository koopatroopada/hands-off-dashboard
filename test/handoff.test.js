'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildPayload,
  findHandoffFile,
  loadConfig,
  parseBooleanFlag,
  parseHandoff,
  parseHeader,
  splitStages
} = require('../lib/handoff');

const SAMPLE = [
  'Audience: 我自己自用',
  'Why: 想把手表上的流程计时做顺',
  'Stages: 原型 → 真机验证 → 上架',
  'Current: 真机验证',
  'Evidence: 线上 PWA 可访问',
  'Gate: 真机上能启动倒计时',
  'Blocker: 本机没有 DevEco Studio',
  'Next-Determined: DETERMINED',
  'Next: 装 DevEco Studio 编译三个文件',
  'Created: 2026-11-02',
  'Last-Activity: 2026-11-04',
  '',
  '# Handoff: 示例交接文档',
  '',
  '生成时间：2026-11-04 19:20',
  '',
  '## Current state',
  '',
  '正文内容。'
].join('\n');

test('parseHeader 只读第一个空行之前的结构化头部', () => {
  const header = parseHeader(SAMPLE);
  assert.equal(header.audience, '我自己自用');
  assert.equal(header.nextdetermined, 'DETERMINED');
  assert.equal(header.lastactivity, '2026-11-04');
  assert.equal(header['# handoff'], undefined, '正文标题不应混进头部');
});

test('parseHeader 遇到没有头部的外来文档时返回空对象', () => {
  assert.deepEqual(parseHeader('# 随便一篇笔记\n\n正文'), {});
});

test('splitStages 支持箭头与空项', () => {
  assert.deepEqual(splitStages('原型 → 真机验证 → 上架'), ['原型', '真机验证', '上架']);
  assert.deepEqual(splitStages('只有一步'), ['只有一步']);
  assert.deepEqual(splitStages(''), []);
  assert.deepEqual(splitStages(null), []);
});

test('parseBooleanFlag 不会被 UNDETERMINED 里的 DETERMINED 骗过', () => {
  assert.equal(parseBooleanFlag('UNDETERMINED'), false);
  assert.equal(parseBooleanFlag('DETERMINED'), true);
  assert.equal(parseBooleanFlag('未定'), false);
  assert.equal(parseBooleanFlag(null), null);
  assert.equal(parseBooleanFlag('???'), null);
});

test('parseHandoff 组装出卡片需要的字段', () => {
  const project = parseHandoff(SAMPLE);
  assert.equal(project.title, '示例交接文档');
  assert.equal(project.generatedAt, '2026-11-04 19:20');
  assert.equal(project.current, '真机验证');
  assert.deepEqual(project.stages, ['原型', '真机验证', '上架']);
  assert.equal(project.nextDetermined, true);
  assert.equal(project.created, '2026-11-02');
  assert.equal(project.lastActivity, '2026-11-04');
  assert.equal(project.blocker, '本机没有 DevEco Studio');
});

test('parseHandoff 对缺字段的文档降级成空值而不是抛错', () => {
  const project = parseHandoff('Why: 只有一句为什么\n\n# 标题\n');
  assert.equal(project.why, '只有一句为什么');
  assert.equal(project.current, null);
  assert.deepEqual(project.stages, []);
  assert.equal(project.nextDetermined, null);
  assert.equal(project.created, null);
});

test('parseHandoff 把 n/a 之类的占位值当作没填', () => {
  const project = parseHandoff('Gate: n/a\nBlocker: 无\nNext: - \n\n');
  assert.equal(project.gate, null);
  assert.equal(project.blocker, null);
  assert.equal(project.next, null);
});

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-test-'));
  // alpha：根目录有 HANDOFF.md，同时留着旧的 docs/handoff-*.md 干扰项
  await fs.mkdir(path.join(root, 'alpha', 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'alpha', 'HANDOFF.md'), SAMPLE, 'utf8');
  await fs.writeFile(path.join(root, 'alpha', 'docs', 'handoff-20260101-000000.md'), SAMPLE, 'utf8');
  await fs.writeFile(path.join(root, 'alpha', 'docs', 'handoff-20260202-000000.md'), SAMPLE, 'utf8');
  // beta：只有 HANDOFF.md
  await fs.mkdir(path.join(root, 'beta'), { recursive: true });
  await fs.writeFile(path.join(root, 'beta', 'HANDOFF.md'), SAMPLE, 'utf8');
  // gamma：没有任何交接文档
  await fs.mkdir(path.join(root, 'gamma'), { recursive: true });
  await fs.writeFile(path.join(root, 'gamma', 'notes.md'), '没有交接文档', 'utf8');
  // delta：只有旧命名的 handoff-*.md，写死后应当被忽略
  await fs.mkdir(path.join(root, 'delta', 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'delta', 'docs', 'handoff-20260303-000000.md'), SAMPLE, 'utf8');
  return root;
}

test('findHandoffFile 只认项目根目录的 HANDOFF.md', async () => {
  const root = await makeTempRoot();
  assert.equal(path.basename(await findHandoffFile(path.join(root, 'alpha'))), 'HANDOFF.md');
  assert.equal(await findHandoffFile(path.join(root, 'gamma')), null);
  assert.equal(await findHandoffFile(path.join(root, 'delta')), null, '旧命名的 handoff-*.md 不再被识别');
});

test('buildPayload 跳过没有 HANDOFF.md 的文件夹', async () => {
  const root = await makeTempRoot();
  const payload = await buildPayload({ root, projects: [], ignore: [] });
  assert.deepEqual(payload.projects.map((item) => item.name), ['alpha', 'beta']);
  assert.equal(payload.projects[0].error, null);
  assert.equal(payload.projects[0].handoff.relPath, 'alpha/HANDOFF.md');
  // gamma 没有交接文档、delta 只有旧命名的 docs/handoff-*.md，都不出现在看板上
});

test('buildPayload 支持多个工作目录，合并扫描', async () => {
  const root = await makeTempRoot();
  const root2 = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-test-'));
  await fs.mkdir(path.join(root2, 'zeta'), { recursive: true });
  await fs.writeFile(path.join(root2, 'zeta', 'HANDOFF.md'), SAMPLE, 'utf8');

  const payload = await buildPayload({ roots: [root, root2], projects: [], ignore: [] });
  assert.deepEqual(payload.projects.map((item) => item.name), ['alpha', 'beta', 'zeta']);
  assert.equal(payload.roots.length, 2);
  assert.equal(payload.projects.find((item) => item.name === 'zeta').handoff.relPath, 'zeta/HANDOFF.md');
});

test('buildPayload 跨工作目录按目录绝对路径去重', async () => {
  const root = await makeTempRoot();
  const payload = await buildPayload({ roots: [root, root], projects: [], ignore: [] });
  assert.deepEqual(payload.projects.map((item) => item.name), ['alpha', 'beta']);
});

test('loadConfig 支持 roots 数组、兼容单数 root、同一路径去重', async () => {
  const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-cfg-'));
  const configPath = path.join(appDir, 'config.json');

  await fs.writeFile(configPath, JSON.stringify({ roots: ['D:/a', 'D:/a', 'D:/b'] }), 'utf8');
  let config = await loadConfig(appDir);
  assert.equal(config.roots.length, 2);
  assert.deepEqual(config.roots.map((item) => path.basename(item)), ['a', 'b']);

  await fs.writeFile(configPath, JSON.stringify({ root: 'D:/legacy' }), 'utf8');
  config = await loadConfig(appDir);
  assert.deepEqual(config.roots.map((item) => path.basename(item)), ['legacy']);

  // overrides.roots（桌面组件状态文件里的工作目录）优先于配置文件
  config = await loadConfig(appDir, { roots: ['D:/override'] });
  assert.deepEqual(config.roots.map((item) => path.basename(item)), ['override']);
});

test('buildPayload 忽略 config.json 里的 handoff 字段，路径写死', async () => {
  const root = await makeTempRoot();
  const payload = await buildPayload({
    root,
    projects: [{ name: 'alpha', handoff: 'alpha/docs/handoff-20260101-000000.md' }],
    ignore: []
  });
  assert.equal(payload.projects[0].handoff.relPath, 'alpha/HANDOFF.md');
});

test('buildPayload 跳过 worktree，避免同一个仓库出现两张卡', async () => {
  const root = await makeTempRoot();
  const worktree = path.join(root, 'alpha-dev');
  await fs.mkdir(worktree, { recursive: true });
  await fs.writeFile(path.join(worktree, '.git'), 'gitdir: /elsewhere/.git/worktrees/alpha-dev\n', 'utf8');
  await fs.writeFile(path.join(worktree, 'HANDOFF.md'), SAMPLE, 'utf8');

  const payload = await buildPayload({ root, projects: [], ignore: [] });
  assert.deepEqual(payload.projects.map((item) => item.name), ['alpha', 'beta']);
});

test('buildPayload 对缺 HANDOFF.md 的项目返回错误字段而不是整份失败', async () => {
  const root = await makeTempRoot();
  const payload = await buildPayload({
    root,
    projects: [{ name: 'gamma' }],
    ignore: []
  });
  assert.equal(payload.projects.length, 1);
  assert.match(payload.projects[0].error, /找不到交接文档/);
});
