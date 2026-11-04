#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildPayload, loadConfig } = require('./lib/handoff');

const APP_DIR = __dirname;
const INDEX_FILE = path.join(APP_DIR, 'index.html');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--root') args.root = argv[i + 1];
    if (token === '--port') args.port = argv[i + 1];
    if (token === '--no-open') args.open = false;
  }
  return args;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(text);
}

async function sendIndex(res) {
  try {
    const html = await fs.readFile(INDEX_FILE);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': html.length
    });
    res.end(html);
  } catch (error) {
    sendText(res, 500, `无法读取 index.html：${error.message}`);
  }
}

function findProject(payload, id) {
  return payload.projects.find((project) => project.id === id) || null;
}

function openInExplorer(target) {
  const windowsPath = target.split('/').join('\\');
  if (process.platform === 'win32') {
    spawn('explorer.exe', [`/select,${windowsPath}`], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [process.platform === 'darwin' ? '-R' : path.dirname(target)], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}

async function handle(config, req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const route = url.pathname.replace(/\/+$/, '') || '/';

  if (route === '/' || route === '/index.html') {
    await sendIndex(res);
    return;
  }

  if (route === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  if (route === '/api/projects') {
    try {
      sendJson(res, 200, await buildPayload(config));
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (route === '/api/handoff') {
    try {
      const payload = await buildPayload(config);
      const project = findProject(payload, url.searchParams.get('id'));
      if (!project || !project.handoff) {
        sendJson(res, 404, { error: '找不到该项目或它没有交接文档' });
        return;
      }
      const markdown = await fs.readFile(project.handoff.path, 'utf8');
      sendJson(res, 200, {
        id: project.id,
        name: project.name,
        relPath: project.handoff.relPath,
        mtime: project.handoff.mtime,
        markdown
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (route === '/api/reveal') {
    try {
      const payload = await buildPayload(config);
      const project = findProject(payload, url.searchParams.get('id'));
      const target = url.searchParams.get('target');
      if (!project) {
        sendJson(res, 404, { error: '找不到该项目' });
        return;
      }
      const filePath = target === 'handoff' && project.handoff ? project.handoff.path : project.dir;
      openInExplorer(filePath);
      sendJson(res, 200, { ok: true, opened: filePath });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  sendText(res, 404, 'Not found');
}

function listen(server, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    const attempt = () => {
      const onError = (error) => {
        if (error.code === 'EADDRINUSE' && attempts < 20) {
          attempts += 1;
          port += 1;
          server.removeListener('error', onError);
          attempt();
          return;
        }
        reject(error);
      };

      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    };

    attempt();
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(APP_DIR, args);
  const server = http.createServer((req, res) => {
    handle(config, req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
    });
  });

  const port = await listen(server, config.port);
  const url = `http://127.0.0.1:${port}/`;

  console.log('');
  console.log('  Hands-off Dashboard');
  console.log(`  根目录  ${config.root}`);
  console.log(`  地址    ${url}`);
  console.log('  关闭窗口或按 Ctrl+C 结束服务');
  console.log('');

  if (config.open) openBrowser(url);

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`启动失败：${error.message}`);
  process.exit(1);
});
