'use strict';
// PromptGate Video collector: fetches the web pages the user lists and keeps their readable
// text, so the writer has material to work from. Runs only in the local server. Pages are
// data, never instructions: the text is handed to the writer as quoted source material.
const LIMITS = { urls: 8, bytes: 2 * 1024 * 1024, chars: 20000, timeoutMs: 15000 };
const TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', deg: '°' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
const strip = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [])[0];
  const content = tag && tag.match(/content=["']([^"']*)["']/i);
  return content ? strip(content[1]) : '';
}
// HTML → { title, description, text }. Prefers <article> / <main>; drops scripts, styles,
// navigation and lines too short to be prose (menus, buttons, footers).
function htmlToText(html) {
  let h = String(html || '');
  const title = strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || meta(h, 'og:title');
  const description = meta(h, 'description') || meta(h, 'og:description');
  h = h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|header|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = (h.match(/<article\b[\s\S]*?<\/article>/i) || h.match(/<main\b[\s\S]*?<\/main>/i) || [h])[0];
  const lines = main.replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/section|\/tr|\/blockquote|\/figcaption)\b[^>]*>/gi, '\n')
    .split('\n').map(strip).filter((l) => l.split(' ').length >= 6);
  const text = lines.join('\n').slice(0, LIMITS.chars);
  return { title: title.slice(0, 200), description: description.slice(0, 400), text };
}

async function readCapped(res, max) {
  if (!res.body || !res.body.getReader) { const buf = Buffer.from(await res.arrayBuffer()); return buf.length > max ? null : buf; }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { try { await reader.cancel(); } catch (_) { /* gone */ } return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
function charsetOf(type) {
  const m = /charset=["']?([\w-]+)/i.exec(type || '');
  try { return m ? new TextDecoder(m[1].toLowerCase()).encoding : 'utf-8'; } catch (_) { return 'utf-8'; }
}

// One URL → { url, title, description, text } or { url, error } with a short error code.
async function collectUrl(raw, opts) {
  const o = opts || {};
  let url;
  try { url = new URL(String(raw).trim()); } catch (_) { return { url: String(raw).slice(0, 300), error: 'url' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { url: url.href.slice(0, 300), error: 'scheme' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || LIMITS.timeoutMs);
  try {
    const res = await (o.fetch || fetch)(url.href, { signal: ctrl.signal, redirect: 'follow', headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', 'user-agent': 'Mozilla/5.0 (compatible; PromptGateVideo/0.4)' } });
    const final = new URL(res.url || url.href);
    if (final.protocol !== 'http:' && final.protocol !== 'https:') return { url: url.href, error: 'scheme' };
    if (!res.ok) return { url: url.href, error: 'http', status: res.status };
    const type = res.headers.get('content-type') || '';
    if (type && !TYPES.test(type)) return { url: url.href, error: 'type' };
    const buf = await readCapped(res, o.maxBytes || LIMITS.bytes);
    if (!buf) return { url: url.href, error: 'tooBig' };
    const body = new TextDecoder(charsetOf(type)).decode(buf);
    const page = /text\/plain/i.test(type) ? { title: '', description: '', text: body.replace(/[ \t]+/g, ' ').slice(0, LIMITS.chars) } : htmlToText(body);
    if (!page.text && !page.description) return { url: url.href, error: 'empty' };
    return { url: url.href, ...page };
  } catch (e) {
    return { url: url.href, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}

// Many URLs in parallel → { sources: [...], failed: [{ url, error }] }. Duplicates and blank
// lines are dropped; at most LIMITS.urls are fetched.
async function collect(urls, opts) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter(Boolean))].slice(0, LIMITS.urls);
  const out = await Promise.all(list.map((u) => collectUrl(u, opts)));
  return { sources: out.filter((x) => !x.error), failed: out.filter((x) => x.error).map((x) => ({ url: x.url, error: x.error, status: x.status })) };
}

module.exports = { collect, collectUrl, htmlToText, decode, LIMITS };
