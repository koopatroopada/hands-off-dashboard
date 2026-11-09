'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * 交接文档的位置与文件名是硬约定：**项目根目录下的 HANDOFF.md**。
 *
 * 不再扫描 docs/、不再按文件名时间戳挑最新的、也不允许 config.json 覆盖路径。
 * 一份项目只有一份交接文档，避免看板读到早已过期的历史归档
 * （比如 newday 的 docs/handoff-20261104-*.md 已被 HANDOFF.md 取代）。
 */
const HANDOFF_NAME = 'HANDOFF.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.workbuddy', '.superpowers']);

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function normalizeKey(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function statSafe(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

/**
 * 交接文档开头的 11 行 `Key: value` 结构化头部。
 * 头部以第一个空行为界，之后的 `# Handoff: ...` 不参与解析。
 */
function parseHeader(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const header = {};

  for (const line of lines) {
    if (!line.trim()) break;
    const match = line.match(/^([A-Za-z][A-Za-z0-9 _-]*?):\s*(.*)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    if (!key) continue;
    header[key] = match[2].trim();
  }

  return header;
}

function splitStages(value) {
  if (!value) return [];
  return String(value)
    .split(/→|->|\u2192|\u21d2/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanFlag(raw) {
  if (raw == null || raw === '') return null;
  const value = String(raw).toUpperCase();
  // UNDETERMINED 里也含 DETERMINED，必须先判否定。
  if (value.includes('UNDETERMINED') || value.includes('未定')) return false;
  if (value.includes('DETERMINED') || value.includes('已定')) return true;
  return null;
}

function parseDate(raw) {
  if (!raw) return null;
  const match = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function cleanText(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^(?:n\/?a|none|null|-|无|暂无)[.。]?$/i.test(value)) return null;
  return value;
}

function firstHeading(text) {
  const match = String(text).match(/^#\s+(.+)$/m);
  if (!match) return null;
  return match[1].replace(/^handoff\s*[:：]\s*/i, '').trim() || null;
}

function generatedAt(text) {
  const match = String(text).match(
    /生成时间\s*[:：]\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/
  );
  if (!match) return null;
  return match[2] ? `${match[1]} ${match[2]}` : match[1];
}

/**
 * 把一份交接文档正文解析成看板卡片需要的字段。
 * 只依赖头部结构，正文缺失也不影响降级展示。
 */
function parseHandoff(text, meta = {}) {
  const header = parseHeader(text);

  return {
    title: firstHeading(text),
    generatedAt: generatedAt(text),
    audience: cleanText(header.audience),
    why: cleanText(header.why),
    stages: splitStages(header.stages),
    current: cleanText(header.current),
    evidence: cleanText(header.evidence),
    gate: cleanText(header.gate),
    blocker: cleanText(header.blocker),
    next: cleanText(header.next),
    nextDetermined: parseBooleanFlag(header.nextdetermined),
    created: parseDate(header.created),
    lastActivity: parseDate(header.lastactivity),
    ...meta
  };
}

/**
 * 在项目目录里找交接文档。只有一个合法位置：根目录的 HANDOFF.md。
 * 找不到就返回 null（调用方据此提示「把这个文件补上」）。
 */
async function findHandoffFile(dir) {
  const target = path.join(dir, HANDOFF_NAME);
  const stat = await statSafe(target);
  return stat && stat.isFile() ? target : null;
}

async function isWorktree(dir) {
  const gitEntry = await statSafe(path.join(dir, '.git'));
  return Boolean(gitEntry && gitEntry.isFile());
}

async function readProject(spec, root) {
  const project = {
    id: spec.id,
    name: spec.name,
    dir: spec.dir,
    relDir: toPosix(path.relative(root, spec.dir)) || '.',
    handoff: null,
    error: null
  };

  const stat = await statSafe(spec.handoffPath);
  if (!stat || !stat.isFile()) {
    project.error = `找不到交接文档：${toPosix(path.relative(root, spec.handoffPath))}（交接文档固定为项目根目录的 ${HANDOFF_NAME}）`;
    return project;
  }

  let text;
  try {
    text = await fs.readFile(spec.handoffPath, 'utf8');
  } catch (error) {
    project.error = `读取失败：${error.message}`;
    return project;
  }

  const parsed = parseHandoff(text);
  project.handoff = {
    path: spec.handoffPath,
    relPath: toPosix(path.relative(root, spec.handoffPath)),
    mtime: stat.mtime.toISOString(),
    bytes: stat.size,
    title: parsed.title
  };

  return Object.assign(project, {
    id: spec.id,
    name: spec.name,
    dir: spec.dir,
    relDir: project.relDir,
    handoff: project.handoff,
    error: null,
    title: parsed.title,
    generatedAt: parsed.generatedAt,
    audience: parsed.audience,
    why: parsed.why,
    stages: parsed.stages,
    current: parsed.current,
    evidence: parsed.evidence,
    gate: parsed.gate,
    blocker: parsed.blocker,
    next: parsed.next,
    nextDetermined: parsed.nextDetermined,
    created: parsed.created,
    lastActivity: parsed.lastActivity
  });
}

/**
 * 未配置显式清单时，扫描根目录下所有带交接文档的项目。
 * worktree（.git 是文件）与隐藏目录会被跳过，避免同一个仓库出现两张卡。
 */
async function discover(root, ignore) {
  const skipped = new Set([...SKIP_DIRS, ...ignore]);
  let entries;

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new Error(`无法读取根目录 ${root}：${error.message}`);
  }

  const specs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || skipped.has(entry.name)) continue;

    const dir = path.join(root, entry.name);
    if (await isWorktree(dir)) continue;

    const handoffPath = await findHandoffFile(dir);
    if (!handoffPath) continue;

    specs.push({ id: entry.name, name: entry.name, dir, handoffPath });
  }

  return specs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

async function resolveSpecs(config) {
  const root = config.root;
  const configured = Array.isArray(config.projects) ? config.projects.filter(Boolean) : [];

  if (!configured.length) return discover(root, config.ignore || []);

  const specs = [];
  for (const item of configured) {
    const name = item.name || (item.dir ? path.basename(item.dir) : null);
    if (!name) continue;

    const dir = path.resolve(root, item.dir || name);
    // 路径写死，config.json 里即便还留着 handoff 字段也不再生效
    specs.push({ id: item.id || name, name, dir, handoffPath: path.join(dir, HANDOFF_NAME) });
  }

  return specs;
}

/**
 * 组装前端要的整份数据。单个项目失败不影响其它项目。
 */
async function buildPayload(config) {
  const root = config.root;
  const specs = await resolveSpecs(config);
  const projects = [];

  for (const spec of specs) {
    try {
      projects.push(await readProject(spec, root));
    } catch (error) {
      projects.push({
        id: spec.id,
        name: spec.name,
        dir: spec.dir,
        relDir: toPosix(path.relative(root, spec.dir)) || '.',
        handoff: null,
        error: error.message
      });
    }
  }

  return {
    root: toPosix(root),
    generatedAt: new Date().toISOString(),
    count: projects.length,
    projects
  };
}

async function loadConfig(appDir, overrides = {}) {
  const configPath = path.join(appDir, 'config.json');
  let fileConfig = {};

  try {
    fileConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`config.json 解析失败：${error.message}`);
    }
  }

  const root = path.resolve(
    overrides.root || process.env.DASHBOARD_ROOT || fileConfig.root || path.resolve(appDir, '..')
  );

  return {
    root,
    port: Number(overrides.port || process.env.DASHBOARD_PORT || fileConfig.port || 4177),
    open: overrides.open ?? fileConfig.open ?? true,
    projects: fileConfig.projects || [],
    ignore: fileConfig.ignore || []
  };
}

module.exports = {
  HANDOFF_NAME,
  buildPayload,
  discover,
  findHandoffFile,
  loadConfig,
  parseHandoff,
  parseHeader,
  parseBooleanFlag,
  splitStages,
  toPosix
};
