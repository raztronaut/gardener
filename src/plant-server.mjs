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

const PORT = parseInt(process.env.GARDENER_PLANT_PORT || '8788', 10);
const HOST = '127.0.0.1'; // cloudflared connects here; never bound to the LAN directly

function log(msg) {
  const line = `[${new Date().toISOString()}] [plant] ${msg}\n`;
  try { appendFileSync(join(paths.DATA, 'plant.log'), line); } catch { /* ignore */ }
}

const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

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

    // The note page (mobile).
    if (req.method === 'GET' && (p === '/' || p === '/plant.html')) {
      const html = await fs.readFile(join(paths.PUBLIC, 'plant.html'));
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
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
