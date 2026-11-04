'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildPayload,
  findHandoffFile,
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
  await fs.mkdir(path.join(root, 'alpha', 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'alpha', 'docs', 'handoff-20260101-000000.md'), SAMPLE, 'utf8');
  await fs.writeFile(path.join(root, 'alpha', 'docs', 'handoff-20260202-000000.md'), SAMPLE, 'utf8');
  await fs.mkdir(path.join(root, 'beta'), { recursive: true });
  await fs.writeFile(path.join(root, 'beta', 'HANDOFF.md'), SAMPLE, 'utf8');
  await fs.mkdir(path.join(root, 'gamma'), { recursive: true });
  await fs.writeFile(path.join(root, 'gamma', 'notes.md'), '没有交接文档', 'utf8');
  return root;
}

test('findHandoffFile 优先 docs/ 并取文件名最大的那份', async () => {
  const root = await makeTempRoot();
  const found = await findHandoffFile(path.join(root, 'alpha'));
  assert.equal(path.basename(found), 'handoff-20260202-000000.md');
  assert.equal(await findHandoffFile(path.join(root, 'gamma')), null);
});

test('buildPayload 只收录有交接文档的项目', async () => {
  const root = await makeTempRoot();
  const payload = await buildPayload({ root, projects: [], ignore: [] });
  assert.deepEqual(payload.projects.map((item) => item.name), ['alpha', 'beta']);
  assert.equal(payload.projects[0].error, null);
  assert.equal(payload.projects[0].handoff.relPath, 'alpha/docs/handoff-20260202-000000.md');
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

test('buildPayload 对坏路径返回错误字段而不是整份失败', async () => {
  const root = await makeTempRoot();
  const payload = await buildPayload({
    root,
    projects: [{ name: 'alpha', handoff: 'alpha/docs/nope.md' }],
    ignore: []
  });
  assert.equal(payload.projects.length, 1);
  assert.match(payload.projects[0].error, /找不到交接文档/);
});
