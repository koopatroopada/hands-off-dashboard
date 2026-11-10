#!/usr/bin/env node
'use strict';

/**
 * 把当前交接数据打包成纯静态快照，产出 demo/index.html。
 *
 * 页面本身不变，只是把运行时的两个接口用内置 fetch 拦截替换成预生成数据：
 *   /api/projects  → 发布那一刻的整份数据
 *   /api/handoff   → 发布那一刻的交接全文
 * 所以这个目录可以直接丢给静态托管，不需要 Node 服务。
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig, buildPayload } = require('./lib/handoff');

const APP_DIR = __dirname;
const OUT_DIR = path.join(APP_DIR, 'demo');
const SCRIPT_ANCHOR = "\n  <script>\n    'use strict';";

/** JSON 内嵌进 <script> 时，必须打断 </script> 与 <!-- 这些序列。 */
function toInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** `--root=<dir>` 用指定目录代替 config.json 的工作目录，相对路径按项目根解析。 */
function rootOverride(argv) {
  const flag = argv.find((item) => item.startsWith('--root='));
  if (!flag) return {};
  const value = flag.slice('--root='.length).trim();
  return value ? { roots: [path.resolve(APP_DIR, value)] } : {};
}

async function main() {
  const config = await loadConfig(APP_DIR, rootOverride(process.argv.slice(2)));
  const payload = await buildPayload(config);

  const docs = {};
  for (const project of payload.projects) {
    if (!project.handoff) continue;
    docs[project.id] = await fs.readFile(project.handoff.path, 'utf8');
  }

  const html = await fs.readFile(path.join(APP_DIR, 'index.html'), 'utf8');
  if (!html.includes(SCRIPT_ANCHOR)) {
    throw new Error('index.html 结构变了：找不到主脚本入口，无法注入快照');
  }

  const injection = `
  <style>
    /* 静态快照没有本地服务，定位文件按钮无从生效，直接不显示。 */
    #drawerReveal { display: none; }
  </style>

  <script>
    window.__SNAPSHOT__ = {
      payload: ${toInlineJson(payload)},
      docs: ${toInlineJson(docs)}
    };

    (function () {
      var snapshot = window.__SNAPSHOT__;

      function reply(body, status) {
        return new Response(JSON.stringify(body), {
          status: status || 200,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      }

      // 不能用 new URL(url, location.href)：file:// 下 '/api/projects' 会解析成 '/D:/api/projects'。
      function endpointOf(rawUrl) {
        var clean = String(rawUrl).split('#')[0];
        var parts = clean.split('?');
        var matched = parts[0].match(/\\/api\\/([a-z]+)$/);
        return {
          name: matched ? matched[1] : '',
          query: new URLSearchParams(parts[1] || '')
        };
      }

      window.fetch = function (input) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var endpoint = endpointOf(url);

        if (endpoint.name === 'projects') return Promise.resolve(reply(snapshot.payload));

        if (endpoint.name === 'handoff') {
          var id = endpoint.query.get('id');
          if (snapshot.docs[id] == null) return Promise.resolve(reply({ error: '快照里没有这个项目的交接文档' }, 404));
          return Promise.resolve(reply({ id: id, markdown: snapshot.docs[id] }));
        }

        if (endpoint.name === 'reveal') return Promise.resolve(reply({ ok: true }));

        return Promise.reject(new Error('静态快照不支持该接口：' + url));
      };
    })();
  </script>
`;

  const output = html.replace(SCRIPT_ANCHOR, injection + SCRIPT_ANCHOR);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), output);

  const built = new Date(payload.generatedAt).toLocaleString('zh-CN', { hour12: false });
  console.log(`快照已生成：demo/index.html（${(output.length / 1024).toFixed(0)} KB）`);
  console.log(`数据时间：${built}`);
  payload.projects.forEach((project) => {
    const state = project.error ? `错误：${project.error}` : project.current || '未标注阶段';
    console.log(`  - ${project.name} → ${project.handoff ? project.handoff.relPath : '无交接文档'} | ${state}`);
  });
}

main().catch((error) => {
  console.error('生成失败：', error.message);
  process.exit(1);
});
