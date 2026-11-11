#!/usr/bin/env node
'use strict';
// PromptGate Video on a computer: serves ./src on localhost and, when Claude is available
// on this machine, the editing assistant (see assistant.js). Zero dependencies.
//   node server.js            → http://127.0.0.1:4173
//   PORT=8080 node server.js
//   ANTHROPIC_API_KEY=... node server.js   (or just be signed in to Claude Code)
const fs = require('fs');
const http = require('http');
const path = require('path');
const assistant = require('./assistant.js');
const collector = require('./collect.js');

const SRC = path.join(__dirname, 'src');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

const MAX_BODY = 512 * 1024;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
// The assistant spends the owner's Claude credit, so only this app's own page may call it:
// the Host must be this server on loopback (blocks DNS rebinding), a browser Origin must match
// it (blocks other sites), and the body must be JSON (a cross-site form cannot send that).
function sameSite(req) {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === 'http://' + host;
}
function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// opts.env: environment to read credentials from (default process.env). opts.fetch /
// opts.collectFetch: test hooks for the Claude and web-page requests.
function createServer(opts) {
  const env = (opts && opts.env) || process.env;
  const fetchImpl = opts && opts.fetch;
  const collectFetch = opts && opts.collectFetch;
  return http.createServer(async (req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { rel = null; }
    if (/^\/api\/(status|assistant|collect|draft)$/.test(rel || '')) {
      if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
      try {
        if (rel === '/api/status' && req.method === 'GET') return json(res, 200, await assistant.status(env));
        if (rel !== '/api/status' && req.method === 'POST') {
          if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'badRequest' });
          const body = await readJson(req);
          if (!body || typeof body !== 'object') return json(res, 400, { error: 'badRequest' });
          if (rel === '/api/collect') {
            if (!Array.isArray(body.urls) || !body.urls.length) return json(res, 400, { error: 'badRequest' });
            return json(res, 200, await collector.collect(body.urls, { fetch: collectFetch }));
          }
          const out = rel === '/api/draft' ? await assistant.draft(body, env, fetchImpl) : await assistant.ask(body, env, fetchImpl);
          return json(res, out.error ? (out.error === 'noAssistant' ? 503 : out.error === 'badRequest' ? 400 : 502) : 200, out);
        }
      } catch (_) { return json(res, 500, { error: 'server' }); }
      return json(res, 405, { error: 'badRequest' });
    }
    if (rel === '/') rel = '/index.html';
    const file = rel == null ? null : path.join(SRC, path.normalize(rel));
    const type = file && TYPES[path.extname(file)];
    // Only GET/HEAD, only known file types, never outside ./src.
    if (!/^(GET|HEAD)$/.test(req.method) || !type || !file.startsWith(SRC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---- desktop launcher ----------------------------------------------------------------------
// `node server.js --open` (npm start, or the double-click files) starts the app and opens it in
// the default browser. If the app already runs on that port, it only opens the window; if
// something else holds the port, it tries the next ones.
function openCommand(platform, url) {
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}
function openBrowser(url) {
  if (process.env.PGV_NO_OPEN) return false;
  const [cmd, args] = openCommand(process.platform, url);
  try {
    const child = require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => console.log(`Mở trình duyệt tại / open your browser at: ${url}`));
    child.unref();
    return true;
  } catch (_) { return false; }
}
// Is PromptGate Video itself answering on this port?
function isOurs(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/status', headers: { host: `127.0.0.1:${port}` }, timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body).local === true); } catch (_) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
// Resolves { server, port, reused } — reused: the app was already running there.
function start(opts) {
  const o = opts || {};
  const base = o.port || 4173, tries = o.tries || 10;
  return new Promise((resolve, reject) => {
    const attempt = (port) => {
      const server = createServer(o);
      server.once('error', async (e) => {
        if (e.code !== 'EADDRINUSE') return reject(e);
        if (await isOurs(port)) return resolve({ server: null, port, reused: true });
        if (port + 1 < base + tries) return attempt(port + 1);
        reject(e);
      });
      server.listen(port, '127.0.0.1', () => resolve({ server, port, reused: false }));
    };
    attempt(base);
  });
}

if (require.main === module) {
  const open = process.argv.includes('--open');
  start({ port: Number(process.env.PORT) || 4173, tries: open ? 10 : 1 }).then(({ port, reused }) => {
    const url = `http://127.0.0.1:${port}/`;
    if (reused) console.log(`PromptGate Video đã chạy sẵn / already running: ${url}`);
    else console.log(`PromptGate Video: ${url}  (Ctrl+C để dừng / to stop)`);
    if (open) openBrowser(url);
    if (reused) process.exit(0);
  }, (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Cổng ${Number(process.env.PORT) || 4173} đang bận. Thử: npm start (tự chọn cổng khác) hoặc PORT=5000 npm run video` : e.message);
    process.exit(1);
  });
}

module.exports = { createServer, start, isOurs, openCommand, SRC };
