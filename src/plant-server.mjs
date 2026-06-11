// The Gardener™ — PUBLIC "plant a note" server (the only thing exposed via the
// cloudflared tunnel). Deliberately minimal: it serves the mobile note page, the
// logo, and accepts a feedback POST — and nothing else. The full dashboard,
// the proxy, state, and iteration endpoints stay on the localhost-only main
// server (8787) and are never reachable from the internet.
import http from 'node:http';
import { promises as fs, appendFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { config, paths } from './config.mjs';
import { addFeedback } from './db.mjs';
import { handleHouseApi } from './house-api.mjs';

const PORT = parseInt(process.env.GARDENER_PLANT_PORT || '8788', 10);
const HOST = '127.0.0.1'; // cloudflared connects here; never bound to the LAN directly

function log(msg) {
  const line = `[${new Date().toISOString()}] [plant] ${msg}\n`;
  try { appendFileSync(join(paths.DATA, 'plant.log'), line); } catch { /* ignore */ }
}

const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
// Static MIME for the Hearth app's own files (served only from public/house/).
const HOUSE_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// Simple global rate limit so a stranger with the URL can't flood the gardener.
const hits = [];
function rateOk(max = 30, windowMs = 60000) {
  const now = Date.now();
  while (hits.length && now - hits[0] > windowMs) hits.shift();
  if (hits.length >= max) return false;
  hits.push(now);
  return true;
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

// ---- "Wall" view: read-only passthrough to the localhost dashboard ----------
// Lets Roots embed the REAL live wall page (which self-polls + uses SSE) through
// the tunnel. STRICT allowlist, GET only, streamed: /wall renders the dashboard
// in screenshot mode (no input bar / cursor — view-only), plus exactly the
// assets/data the page needs. POSTs are never forwarded, and sensitive routes
// (/api/feedback GET, /api/night, /api/pad/action, …) are NOT exposed.
const WALL_EXACT = new Set([
  '/app.js', '/styles.css',
  '/api/state', '/api/version', '/api/iterations', '/api/proxy',
  '/api/house/status', '/api/pad/stream',
]);
function wallPathAllowed(p) {
  if (WALL_EXACT.has(p)) return true;
  if (p.includes('..') || p.includes('//')) return false;
  if (p.startsWith('/widgets/')) return p.endsWith('.js') || p === '/widgets/manifest.json';
  if (p.startsWith('/lib/')) return p.endsWith('.js');
  return false;
}
// Generous read budget for the wall view (a page load is ~25 requests) that
// still bounds a flood from a stranger with the URL.
const wallHits = [];
function wallRateOk(max = 600, windowMs = 60000) {
  const now = Date.now();
  while (wallHits.length && now - wallHits[0] > windowMs) wallHits.shift();
  if (wallHits.length >= max) return false;
  wallHits.push(now);
  return true;
}
// Static assets (js/css/widgets/lib) get a SHORT browser cache through the
// tunnel: each request costs ~300-500ms of tunnel RTT, and a wall-page boot is
// ~25 of them. 60s staleness only affects the phone MIRROR right after a
// tending (the wall itself reads localhost and stays no-store). Data/API
// passthroughs stay uncached.
const WALL_CACHEABLE = (p) => p === '/app.js' || p === '/styles.css' || p.startsWith('/widgets/') || p.startsWith('/lib/');
function proxyWall(req, res, path) {
  if (!wallRateOk()) return send(res, 429, 'text/plain', 'too many requests');
  const preq = http.request({
    host: '127.0.0.1', port: config.port, path, method: 'GET',
    headers: { accept: req.headers.accept || '*/*' },
  }, (pres) => {
    res.writeHead(pres.statusCode || 502, {
      'Content-Type': pres.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': WALL_CACHEABLE(path.split('?')[0]) ? 'public, max-age=60' : 'no-store',
    });
    pres.pipe(res); // stream (also keeps the /api/pad/stream SSE flowing)
  });
  preq.on('error', () => { try { send(res, 502, 'text/plain', 'wall unavailable'); } catch { /* ignore */ } });
  req.on('close', () => preq.destroy());
  preq.end();
}

async function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;

    // Hearth — the household app is the new front door. `/` serves it; the
    // standalone note page stays reachable at /plant.html as a fallback.
    if (req.method === 'GET' && (p === '/' || p === '/house' || p === '/house/')) {
      const html = await fs.readFile(join(paths.PUBLIC, 'house', 'index.html'));
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    if (req.method === 'GET' && p === '/plant.html') {
      const html = await fs.readFile(join(paths.PUBLIC, 'plant.html'));
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    // PWA service worker — served at the ROOT so its scope can cover the whole
    // app (Web Push needs a SW; iOS only delivers push to INSTALLED PWAs). The
    // Service-Worker-Allowed header lets it claim scope '/'.
    if (req.method === 'GET' && p === '/sw.js') {
      try {
        const data = await fs.readFile(join(paths.PUBLIC, 'house', 'sw.js'));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
        return res.end(data);
      } catch { return send(res, 404, 'text/plain', 'not found'); }
    }
    // Web app manifest (Add to Home Screen / installable PWA).
    if (req.method === 'GET' && (p === '/manifest.webmanifest' || p === '/house/manifest.webmanifest')) {
      try {
        const data = await fs.readFile(join(paths.PUBLIC, 'house', 'manifest.webmanifest'));
        return send(res, 200, 'application/manifest+json; charset=utf-8', data);
      } catch { return send(res, 404, 'text/plain', 'not found'); }
    }
    // Hearth static assets (app.js / house.css), confined to public/house/.
    if (req.method === 'GET' && p.startsWith('/house/')) {
      const name = p.slice('/house/'.length);
      const ext = extname(name).toLowerCase();
      if (name.includes('..') || name.startsWith('/') || !HOUSE_MIME[ext]) return send(res, 404, 'text/plain', 'not found');
      try {
        const data = await fs.readFile(join(paths.PUBLIC, 'house', name));
        return send(res, 200, HOUSE_MIME[ext], data);
      } catch { return send(res, 404, 'text/plain', 'not found'); }
    }
    // Hearth household JSON API (full read+write — this is the public surface).
    if (p.startsWith('/api/house')) {
      if (!rateOk(120, 60000)) return send(res, 429, 'application/json', JSON.stringify({ error: 'too many requests — try again shortly' }));
      const handled = await handleHouseApi(req, res, u, { log });
      if (handled) return;
    }
    // Wall view: the live dashboard page (screenshot mode = view-only) + its
    // allowlisted assets/data, proxied read-only from the localhost server.
    if (req.method === 'GET' && p === '/wall') return proxyWall(req, res, '/?screenshot=1');
    if (req.method === 'GET' && wallPathAllowed(p)) return proxyWall(req, res, p + (u.search || ''));
    // The logo only (and only image files under /assets, traversal-guarded).
    if (req.method === 'GET' && p.startsWith('/assets/')) {
      const name = p.slice('/assets/'.length);
      const ext = extname(name).toLowerCase();
      if (name.includes('/') || name.includes('..') || !IMG[ext]) return send(res, 404, 'text/plain', 'not found');
      try {
        const data = await fs.readFile(join(paths.PUBLIC, 'assets', name));
        return send(res, 200, IMG[ext], data);
      } catch { return send(res, 404, 'text/plain', 'not found'); }
    }
    // Accept a planted note.
    if (req.method === 'POST' && p === '/api/feedback') {
      if (!rateOk()) return send(res, 429, 'application/json', JSON.stringify({ error: 'too many notes — try again shortly' }));
      let text = '';
      try { text = (JSON.parse(await readBody(req)).text || '').toString(); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      text = text.trim().slice(0, 500); // shorter cap for public notes
      if (!text) return send(res, 400, 'application/json', JSON.stringify({ error: 'empty note' }));
      const id = addFeedback(text, 'remote');
      log(`remote note #${id}: ${text.slice(0, 100)}`);
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, id }));
    }
    // Everything else is intentionally not exposed.
    return send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    log(`error: ${e.stack || e}`);
    try { send(res, 500, 'text/plain', 'error'); } catch { /* ignore */ }
  }
});

server.on('error', (e) => { log(`server error: ${e.stack || e}`); if (e.code === 'EADDRINUSE') process.exit(1); });
process.on('uncaughtException', (e) => log(`uncaught: ${e.stack || e}`));
server.listen(PORT, HOST, () => { const m = `plant server (public surface) on http://${HOST}:${PORT}`; log(m); console.log(m); });
