// The Gardener™ — HTTP server.
// Serves the live frontend (public/) and a small JSON API. Binds to localhost
// only. Includes an SSRF-hardened, allowlisted proxy so widgets can reach
// keyless public APIs without CORS headaches.
import http from 'node:http';
import { promises as fs, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { join, normalize, extname, resolve } from 'node:path';
import { config, paths } from './config.mjs';
import {
  addFeedback, getRecentFeedback, countPendingFeedback, deletePendingFeedback,
  getUiVersion, getNight, setNight, latestIteration,
  recentIterations, latestCommitted,
} from './db.mjs';
import { recover } from './recover.mjs';
import { handleHouseApi } from './house-api.mjs';

const START = Date.now();

function log(msg) {
  const line = `[${new Date().toISOString()}] [server] ${msg}\n`;
  try { appendFileSync(paths.SERVER_LOG, line); } catch { /* ignore */ }
}

// ---- crash recovery on boot ------------------------------------------------
// Skipped when this is a child render-harness (e.g. the iteration's review
// server), so it can never revert the live iteration's in-flight work.
if (!process.env.GARDENER_NO_RECOVER) {
  try { recover(); } catch (e) { log(`recover() failed: ${e.stack || e}`); }
}

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
// Reserved/private ranges (SSRF). net.BlockList handles all IPv4-mapped/hex
// IPv6 forms correctly, unlike hand-rolled string checks.
const BLOCK = new BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, n, 'ipv6');
function isPrivateIp(ip) {
  let v = isIP(ip);
  if (v === 6) { const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); if (m) { ip = m[1]; v = 4; } }
  if (!v) return true; // not a parseable IP → refuse
  return BLOCK.check(ip, v === 6 ? 'ipv6' : 'ipv4');
}
async function validateTarget(rawUrl, allow) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('invalid url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol not allowed');
  if (!hostAllowed(u.hostname, allow)) throw new Error(`host not in allowlist: ${u.hostname}`);
  // Reject if ANY resolved address is private (closes the "one private among
  // many A-records" gap). Residual DNS-rebind TOCTOU is accepted: the server is
  // localhost-only and the allowlist is reputable public hosts.
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('resolves to private address');
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
      // Referer = the target's own origin (most innocuous value; some keyless
      // endpoints reject requests lacking a same-origin Referer). Safe + generic.
      const HDRS = {
        'User-Agent': 'TheGardener/2.0 (+local ambient dashboard)',
        'Accept': 'application/json, text/*;q=0.9, */*;q=0.5',
        'Referer': `${valid.origin}/`,
      };
      // One 11s attempt + a retry on a transient blip (abort/connection reset).
      // Public APIs from this Jetson occasionally stall past a tight timeout,
      // which would otherwise blank a widget for a whole refresh cycle.
      const tryFetch = async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 11000);
        try { return await fetch(valid.toString(), { redirect: 'manual', signal: ac.signal, headers: HDRS }); }
        finally { clearTimeout(timer); }
      };
      let r;
      try { r = await tryFetch(); }
      catch (e1) { await new Promise((res) => setTimeout(res, 500)); r = await tryFetch(); }
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

// ---- ngrok tunnel auto-detection -------------------------------------------
// The "Plant a Note" QR must encode a PUBLIC url so phones off the LAN can reach
// it — a localhost/LAN address is useless on a phone. If GARDENER_PUBLIC_URL is
// set it always wins; otherwise we auto-discover a running ngrok tunnel via its
// local agent API (127.0.0.1:4040) and use that https public_url. So the human
// just runs `ngrok http 8787` and the QR starts working — no config edits, and it
// keeps up with ngrok's rotating free-tier URLs. Detection is best-effort: any
// failure leaves the url empty and the widget falls back gracefully.
let ngrokUrl = '';
async function detectNgrok() {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1500);
    let data;
    try {
      const r = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } finally { clearTimeout(timer); }
    const tunnels = (data && data.tunnels) || [];
    // Prefer an https tunnel; fall back to any public_url present.
    const https = tunnels.find((t) => /^https:/.test(t.public_url || ''));
    const next = (https || tunnels[0] || {}).public_url || '';
    if (next !== ngrokUrl) { ngrokUrl = next; if (next) log(`ngrok tunnel detected: ${next}`); }
  } catch { /* no agent running / unreachable → leave ngrokUrl as-is unless it was set */ }
}
// Poll only when no explicit public URL is configured (env override is static).
if (!config.publicUrl && !process.env.GARDENER_NO_RECOVER) {
  detectNgrok();
  setInterval(detectNgrok, 30000).unref?.();
}
function publicUrlNow() {
  if (config.publicUrl) return config.publicUrl;      // explicit env override wins
  if (ngrokUrl) return ngrokUrl;                      // ngrok agent, if running
  try {                                               // cloudflared quick-tunnel URL (written by gardener.sh tunnel)
    const u = readFileSync(join(paths.DATA, 'public-url.txt'), 'utf8').trim();
    if (/^https?:\/\//.test(u)) return u;
  } catch { /* no tunnel file → none */ }
  return '';
}

// ---- API --------------------------------------------------------------------
function stateObject() {
  const it = latestIteration();
  return {
    version: getUiVersion(),
    night: getNight(),
    location: config.location,
    publicUrl: publicUrlNow(),
    canvas: { w: config.width, h: config.height },
    now: new Date().toISOString(),
    tz: config.tz,
    pendingFeedback: countPendingFeedback(),
    iteration: (latestCommitted() || {}).id ?? 0, // the "growth number" shown on the header
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
    if (req.method === 'GET' && p === '/api/iterations') {
      // One concise phrase per committed tending — powers the /iterations changelog.
      const oneline = (s) => (s ? (s.split('\n').map((x) => x.trim()).find(Boolean) || '').replace(/\s+/g, ' ').slice(0, 160) : '');
      const iterations = recentIterations(80)
        .filter((x) => x.status === 'committed')
        .map((x) => ({ id: x.id, at: x.finished_at, feedback: x.feedback_count, phrase: oneline(x.summary) || 'self-directed improvement' }));
      return json(res, 200, { iterations });
    }
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
    if (req.method === 'DELETE' && p === '/api/feedback') {
      const id = parseInt(u.searchParams.get('id') || '', 10);
      if (!id) return json(res, 400, { error: 'missing id' });
      const removed = deletePendingFeedback(id);
      if (!removed) return json(res, 404, { error: 'not found or already grown in' });
      log(`feedback #${id} deleted (pruned before tending)`);
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

    // Hearth (household app) — READ-ONLY status for the wall cleaning widget.
    // This localhost-only server never accepts house writes (those live solely
    // on the public plant-server); readOnly:true rejects any non-GET house route.
    if (p.startsWith('/api/house')) {
      const handled = await handleHouseApi(req, res, u, { readOnly: true, log });
      if (handled) return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p + (u.search || ''));
    return send(res, 405, 'text/plain', 'method not allowed');
  } catch (e) {
    log(`request error: ${e.stack || e}`);
    try { json(res, 500, { error: 'internal error' }); } catch { /* ignore */ }
  }
});

server.on('error', (e) => {
  log(`server error: ${e.stack || e}`);
  // Don't linger as a non-listening zombie (this caused a stale review server to
  // squat the port for hours and break later visual reviews). Exit so systemd /
  // the iteration can react.
  if (e.code === 'EADDRINUSE') { console.error(`port in use — exiting`); process.exit(1); }
});
// Never let an unexpected throw take the dashboard down.
process.on('uncaughtException', (e) => log(`uncaughtException: ${e.stack || e}`));
process.on('unhandledRejection', (e) => log(`unhandledRejection: ${e}`));

server.listen(config.port, config.host, () => {
  const line = `The Gardener server listening on http://${config.host}:${config.port}  (ui v${getUiVersion()}, night=${getNight()})`;
  log(line); console.log(line);
});
