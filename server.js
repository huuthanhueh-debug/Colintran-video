#!/usr/bin/env node
'use strict';
// PromptGate Video on a computer: serves video/src on localhost. Zero dependencies.
//   node video/server.js            → http://127.0.0.1:4173
//   PORT=8080 node video/server.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

function createServer() {
  return http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { rel = null; }
    if (rel === '/') rel = '/index.html';
    const file = rel == null ? null : path.join(SRC, path.normalize(rel));
    const type = file && TYPES[path.extname(file)];
    // Only GET/HEAD, only known file types, never outside video/src.
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
    console.error(e.code === 'EADDRINUSE' ? `Cổng ${port} đang bận. Thử: PORT=${port + 1} node video/server.js` : e.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => console.log(`PromptGate Video: http://127.0.0.1:${port}  (Ctrl+C để dừng)`));
}

module.exports = { createServer, SRC };
