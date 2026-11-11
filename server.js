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

// opts.env: environment to read credentials from (default process.env). opts.fetch: test hook.
function createServer(opts) {
  const env = (opts && opts.env) || process.env;
  const fetchImpl = opts && opts.fetch;
  return http.createServer(async (req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { rel = null; }
    if (rel === '/api/status' || rel === '/api/assistant') {
      if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
      try {
        if (rel === '/api/status' && req.method === 'GET') return json(res, 200, await assistant.status(env));
        if (rel === '/api/assistant' && req.method === 'POST') {
          if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'badRequest' });
          const body = await readJson(req);
          if (!body || typeof body !== 'object') return json(res, 400, { error: 'badRequest' });
          const out = await assistant.ask(body, env, fetchImpl);
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

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  const server = createServer();
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Cổng ${port} đang bận. Thử: PORT=${port + 1} npm run video` : e.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => console.log(`PromptGate Video: http://127.0.0.1:${port}  (Ctrl+C để dừng)`));
}

module.exports = { createServer, SRC };
