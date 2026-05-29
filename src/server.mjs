// The Gardener™ — HTTP server.
// Serves the live frontend (public/) and a small JSON API. Binds to localhost
// only. Includes an SSRF-hardened, allowlisted proxy so widgets can reach
// keyless public APIs without CORS headaches.
import http from 'node:http';
import { promises as fs, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { config, paths } from './config.mjs';
import {
  addFeedback, getRecentFeedback, countPendingFeedback,
  getUiVersion, getNight, setNight, latestIteration,
} from './db.mjs';
import { recover } from './recover.mjs';

const START = Date.now();

function log(msg) {
  const line = `[${new Date().toISOString()}] [server] ${msg}\n`;
  try { appendFileSync(paths.SERVER_LOG, line); } catch { /* ignore */ }
}

// ---- crash recovery on boot ------------------------------------------------
try { recover(); } catch (e) { log(`recover() failed: ${e.stack || e}`); }

// ---- static file serving ---------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  // Resolve and confine to PUBLIC (path-traversal guard).
  const full = normalize(join(paths.PUBLIC, rel));
  if (!full.startsWith(resolve(paths.PUBLIC))) { return send(res, 403, 'text/plain', 'forbidden'); }
  try {
    const data = await fs.readFile(full);
    const ext = extname(full).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    // HTML/JS/CSS/JSON must always be fresh (the agent rewrites them); media may cache.
    const volatile = ['.html', '.js', '.mjs', '.css', '.json'].includes(ext);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': volatile ? 'no-store' : 'public, max-age=3600',
    });
    res.end(data);
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function json(res, code, obj) { send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj)); }

async function readBody(req, limit = 64 * 1024) {
  return new Promise((res, rej) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { rej(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

// ---- SSRF-hardened proxy ----------------------------------------------------
function loadAllowlist() {
  try { return new Set(JSON.parse(readFileSync(paths.PROXY_ALLOWLIST, 'utf8')).allow || []); }
  catch { return new Set(); }
}
function hostAllowed(hostname, allow) {
  const h = hostname.toLowerCase();
  for (const a of allow) { if (h === a || h.endsWith('.' + a)) return true; }
  return false;
}
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || ip === '::') return true;
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); if (m) ip = m[1];
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n))) return /^[0-9a-f:]+$/i.test(ip) ? false : true;
  const [a, b] = p;
  return a === 0 || a === 127 || a === 10 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
async function validateTarget(rawUrl, allow) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('invalid url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol not allowed');
  if (!hostAllowed(u.hostname, allow)) throw new Error(`host not in allowlist: ${u.hostname}`);
  const { address } = await lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error('resolves to private address');
  return u;
}
async function handleProxy(req, res, u) {
  const allow = loadAllowlist();
  const target = u.searchParams.get('url');
  if (!target) return json(res, 400, { error: 'missing url' });
  let current = target;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const valid = await validateTarget(current, allow);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 9000);
      let r;
      try {
        r = await fetch(valid.toString(), {
          redirect: 'manual', signal: ac.signal,
          headers: { 'User-Agent': 'TheGardener/2.0 (+local ambient dashboard)', 'Accept': 'application/json, text/*;q=0.9, */*;q=0.5' },
        });
      } finally { clearTimeout(timer); }
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        current = new URL(r.headers.get('location'), valid).toString();
        continue; // re-validate next hop against allowlist
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4 * 1024 * 1024) return json(res, 502, { error: 'response too large' });
      res.writeHead(r.status, {
        'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(buf);
    }
    return json(res, 502, { error: 'too many redirects' });
  } catch (e) {
    log(`proxy error for ${target}: ${e.message}`);
    return json(res, 502, { error: 'proxy failed', detail: e.message });
  }
}

// ---- API --------------------------------------------------------------------
function stateObject() {
  const it = latestIteration();
  return {
    version: getUiVersion(),
    night: getNight(),
    location: config.location,
    canvas: { w: config.width, h: config.height },
    now: new Date().toISOString(),
    tz: config.tz,
    pendingFeedback: countPendingFeedback(),
    lastIteration: it ? {
      id: it.id, status: it.status, trigger: it.trigger,
      finished_at: it.finished_at, summary: it.summary,
      feedback_count: it.feedback_count, review_ok: it.review_ok, review_score: it.review_score,
    } : null,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;

    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, version: getUiVersion(), night: getNight(), uptime: Math.round((Date.now() - START) / 1000) });
    if (req.method === 'GET' && p === '/api/version') return json(res, 200, { version: getUiVersion() });
    if (req.method === 'GET' && p === '/api/state') return json(res, 200, stateObject());
    if (req.method === 'GET' && p === '/api/feedback') {
      const limit = Math.min(parseInt(u.searchParams.get('limit') || '25', 10) || 25, 200);
      return json(res, 200, { feedback: getRecentFeedback(limit) });
    }
    if (req.method === 'POST' && p === '/api/feedback') {
      const raw = await readBody(req);
      let text = '';
      try { text = (JSON.parse(raw).text || '').toString(); } catch { return json(res, 400, { error: 'bad json' }); }
      text = text.trim().slice(0, 2000);
      if (!text) return json(res, 400, { error: 'empty feedback' });
      const id = addFeedback(text, 'ui');
      log(`feedback #${id}: ${text.slice(0, 120)}`);
      return json(res, 200, { ok: true, id });
    }
    if (req.method === 'GET' && p === '/api/night') return json(res, 200, { night: getNight() });
    if (req.method === 'POST' && p === '/api/night') {
      const raw = await readBody(req);
      let on = false; try { on = !!JSON.parse(raw).on; } catch { return json(res, 400, { error: 'bad json' }); }
      setNight(on);
      return json(res, 200, { ok: true, night: on });
    }
    if (req.method === 'GET' && p === '/api/proxy') return handleProxy(req, res, u);

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p + (u.search || ''));
    return send(res, 405, 'text/plain', 'method not allowed');
  } catch (e) {
    log(`request error: ${e.stack || e}`);
    try { json(res, 500, { error: 'internal error' }); } catch { /* ignore */ }
  }
});

server.on('error', (e) => { log(`server error: ${e.stack || e}`); });
// Never let an unexpected throw take the dashboard down.
process.on('uncaughtException', (e) => log(`uncaughtException: ${e.stack || e}`));
process.on('unhandledRejection', (e) => log(`unhandledRejection: ${e}`));

server.listen(config.port, config.host, () => {
  const line = `The Gardener server listening on http://${config.host}:${config.port}  (ui v${getUiVersion()}, night=${getNight()})`;
  log(line); console.log(line);
});
