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
  getUiVersion, getNight, setNight, latestIteration, setKV, getKV,
  recentIterations, latestCommitted, getEdits, setEdit,
} from './db.mjs';
import { recover } from './recover.mjs';
import { changelogPhrase } from './changelog.mjs';
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

// ---- retro-console ROMs (the Arcade / emulator widget) ----------------------
// ROM files live in the gitignored <GARDENER_DATA>/roms/ dir (the user drops
// them in). We never ship ROMs. The extension maps to an EmulatorJS system; the
// widget infers the core from it. Unknown/dotfiles are ignored.
const ROM_SYSTEMS = {
  '.nes': 'nes', '.fds': 'nes',
  '.smc': 'snes', '.sfc': 'snes',
  '.gb': 'gb', '.gbc': 'gbc', '.gba': 'gba',
  '.n64': 'n64', '.z64': 'n64',
  '.md': 'segaMD', '.gen': 'segaMD',
  '.sms': 'segaMS', '.pce': 'pce',
};
async function listRoms() {
  let names = [];
  try { names = await fs.readdir(paths.ROMS); } catch { return []; }
  const out = [];
  for (const file of names) {
    if (file.startsWith('.')) continue; // ignore dotfiles
    const system = ROM_SYSTEMS[extname(file).toLowerCase()];
    if (!system) continue; // unknown extension
    let sizeBytes = 0;
    try { sizeBytes = (await fs.stat(join(paths.ROMS, file))).size; } catch { /* default 0 */ }
    out.push({ name: file.replace(/\.[^.]+$/, ''), file, system, sizeBytes });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
async function serveRom(req, res, urlPath) {
  // Stream a single ROM, read-only, basename-guarded (no path traversal). Only
  // files that live directly in data/roms/ with a known extension are served.
  const raw = decodeURIComponent(urlPath.split('?')[0].replace(/^\/roms\//, ''));
  const base = raw.split('/').pop() || '';
  if (!base || base.startsWith('.') || !ROM_SYSTEMS[extname(base).toLowerCase()]) {
    return send(res, 404, 'text/plain', 'not found');
  }
  const full = normalize(join(paths.ROMS, base));
  if (!full.startsWith(resolve(paths.ROMS))) return send(res, 403, 'text/plain', 'forbidden');
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
}
// Arcade — emit the EmulatorJS bootstrap as a REAL same-origin page. The widget
// points an iframe at /emu-frame.html?core=<id>&rom=<file>&name=<label>. We emit
// the EJS_* globals + the loader so EmulatorJS runs in a proper document (not a
// srcdoc): RetroArch can read screen dimensions and the WebGL canvas presents.
// All params are validated/escaped; the ROM must be a real file in data/roms/.
const EMU_CORES = new Set(['nes', 'snes', 'gb', 'gba', 'n64', 'segaMD', 'segaMS', 'pce']);
function htmlEsc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---- HN reader text extraction (shared by /api/readable text + raw modes) ----
// Crude-but-sturdy readable-text pull: prefer <article>, drop chrome, keep block
// text. Also a proxy for "will the original render?" — a content-rich page yields
// lots of text (so its HTML is server-rendered and renders fine in the iframe);
// a sparse result means an SPA/JS-only page that would render BLANK.
function readerExtractText(html) {
  let body = (html.match(/<article[\s\S]*?<\/article>/i) || [html])[0];
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(nav|header|footer|aside|form|svg|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(h[1-3])[^>]*>/gi, '\n\n## ').replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|section|blockquote|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m_, n) => String.fromCharCode(n)).replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'")
    .split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l.length > 1)
    .join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 60000);
}
// A self-contained, on-brand dark "reader text" page (the fallback when the
// original would render blank). Includes the same postMessage scroll bridge.
function readerTextPage(title, text, url) {
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  // Treat near-empty results (SPAs, Cloudflare "Just a moment…" walls, paywalls)
  // as "no content" → show the open-on-phone message rather than a useless stub.
  const usable = String(text || '').replace(/just a moment\W*/i, '').trim();
  const paras = usable.length >= 40 ? String(text).split(/\n+/).filter((s) => s.trim())
    .map((s) => (s.startsWith('## ') ? `<h2>${htmlEsc(s.slice(3))}</h2>` : `<p>${htmlEsc(s)}</p>`)).join('') : '';
  const bodyHtml = paras || `<p class="empty">No readable text here — this page is a JavaScript app, paywalled, or bot-protected, so it can’t be rendered on the wall. Open it on your phone:</p><p class="empty" style="color:#74f7b0;word-break:break-all">${htmlEsc(url)}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html{scrollbar-width:thin;scrollbar-color:#43e6c6 transparent}
    ::-webkit-scrollbar{width:12px}::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#74f7b0,#43e6c6);border-radius:999px;border:3px solid transparent;background-clip:padding-box;min-height:48px}
    body{margin:0;background:#04110d;color:#cfeede;font:17px/1.62 Inter,system-ui,-apple-system,sans-serif;padding:26px 30px 70px}
    h1{font:700 27px/1.25 "Space Grotesk",Inter,sans-serif;color:#eafff4;margin:0 0 18px}
    h2{font:600 19px/1.3 "Space Grotesk",Inter,sans-serif;color:#eafff4;margin:26px 0 8px}
    p{margin:0 0 14px;max-width:62ch}.empty{color:#6f9388}
    .src{font:600 11px/1 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#6f9388;margin:0 0 16px}
  </style></head><body>
    <div class="src">reader${host ? ' · ' + htmlEsc(host) : ''}</div>
    <h1>${htmlEsc(title)}</h1>${bodyHtml}
    <script>addEventListener('message',function(e){var d=e&&e.data;if(d&&typeof d.__readerScroll==='number'){try{scrollBy({top:d.__readerScroll,behavior:'smooth'})}catch(_){scrollBy(0,d.__readerScroll)}}});<\/script>
  </body></html>`;
}
async function serveEmuFrame(req, res, u) {
  const core = u.searchParams.get('core') || '';
  const romFile = u.searchParams.get('rom') || '';
  const name = (u.searchParams.get('name') || 'Game').slice(0, 80);
  const base = romFile.split('/').pop() || '';
  // Validate: known core + a real ROM file (same guard as serveRom).
  if (!EMU_CORES.has(core) || !base || base.startsWith('.') || !ROM_SYSTEMS[extname(base).toLowerCase()]) {
    return send(res, 400, 'text/plain', 'bad emu params');
  }
  const full = normalize(join(paths.ROMS, base));
  if (!full.startsWith(resolve(paths.ROMS))) return send(res, 403, 'text/plain', 'forbidden');
  try { await fs.access(full); } catch { return send(res, 404, 'text/plain', 'rom not found'); }

  const EJS_DATA = 'https://cdn.emulatorjs.org/stable/data/';
  const J = (v) => JSON.stringify(String(v));
  const romUrl = '/roms/' + encodeURIComponent(base);
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
  /* The Jetson kiosk has NO hardware GL — EmulatorJS renders via software
     SwiftShader, whose per-pixel cost scales with the canvas size. So #game is
     rendered at HALF size and scaled 2x by a cheap CSS transform. It keeps a 4:3
     aspect (the CRT shape), sized to the FULL panel width and CENTERED, with the
     rest of the tube black — a real game picture, not stretched to portrait. */
  #wrap{position:fixed;inset:0;overflow:hidden;background:#000;
        display:flex;align-items:center;justify-content:center}
  #game{position:absolute;top:50%;left:50%;width:50vw;height:37.5vw;
        transform:translate(-50%,-50%) scale(2);transform-origin:center center}
  #game canvas{image-rendering:pixelated;width:100%!important;height:100%!important;}
  /* ---- CRT "tube TV" overlay: scanlines + slanted-shadow-mask + a curved-glass
     vignette/bulge. Pure CSS (the software GPU can't afford a per-frame warp
     shader), tuned to read as a warped tube without touching the render loop. */
  #crt{position:absolute;top:50%;left:50%;width:100vw;height:75vw;
       transform:translate(-50%,-50%);pointer-events:none;z-index:5;
       border-radius:6% / 8%;overflow:hidden;
       box-shadow:inset 0 0 60px 12px rgba(0,0,0,.55), inset 0 0 160px 40px rgba(0,0,0,.4);}
  #crt::before{content:"";position:absolute;inset:0;
       background:repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px);
       mix-blend-mode:multiply;}
  #crt::after{content:"";position:absolute;inset:0;
       background:radial-gradient(120% 120% at 50% 50%, transparent 58%, rgba(0,0,0,.55) 100%),
                  radial-gradient(80% 60% at 50% 18%, rgba(255,255,255,.10), transparent 60%);}
</style>
</head><body><div id="wrap"><div id="game"></div><div id="crt"></div></div>
<script>
  window.EJS_player='#game';
  window.EJS_pathtodata=${J(EJS_DATA)};
  window.EJS_core=${J(core)};
  window.EJS_gameUrl=${J(romUrl)};
  window.EJS_gameName=${J(htmlEsc(name))};
  window.EJS_startOnLoaded=true;
  window.EJS_threads=false;  /* non-threaded core: needs NO SharedArrayBuffer, so
                                the wall doesn't need COOP/COEP (which broke the HN
                                reader). The earlier abort was WebGL, not SAB. */
  /* Force the WebGL2 video path: under software SwiftShader (the Jetson GPU is
     blocklisted; --enable-unsafe-swiftshader gives WebGL via ANGLE/SwiftShader),
     RetroArch's WebGL1 path renders a black frame, but WebGL2 presents. */
  window.EJS_defaultOptions={ webgl2Enabled: 'enabled' };
  window.EJS_color='#74f7b0';
  window.EJS_backgroundColor='#071a14';
  /* AUDIO GESTURE GATE — the real reason games "freeze" on a black screen here:
     RetroArch's audio-synced main loop blocks until its Web Audio context is
     running, but the context is created inside THIS iframe, which never receives
     a user gesture (the picker click lands in the parent document), so autoplay
     policy keeps it 'suspended' and the loop stalls after a few frames. We hook
     AudioContext so every context RetroArch makes is tracked, then resume them
     (a) immediately, (b) on a short poll until they're 'running', and (c) on the
     'emu-kick' message the parent posts from within its real boot gesture and on
     any local input — Chromium honours resume() once the frame tree is activated. */
  (function(){
    var ctxs=[];
    function resumeAll(){ for(var i=0;i<ctxs.length;i++){ try{ if(ctxs[i].state!=='running') ctxs[i].resume(); }catch(e){} } }
    ['AudioContext','webkitAudioContext'].forEach(function(n){
      var Orig=window[n]; if(!Orig) return;
      function Hooked(){ var c=new Orig(arguments[0]); ctxs.push(c); try{ c.resume(); }catch(e){} return c; }
      Hooked.prototype=Orig.prototype; window[n]=Hooked;
    });
    var t=setInterval(function(){ resumeAll(); if(ctxs.length && ctxs.every(function(c){return c.state==='running';})) clearInterval(t); }, 250);
    setTimeout(function(){ clearInterval(t); }, 20000);
    addEventListener('message', function(e){ if(e&&e.data==='emu-kick'){ resumeAll(); try{ window.focus(); }catch(_){} } }, false);
    ['pointerdown','keydown','gamepadconnected'].forEach(function(ev){ addEventListener(ev, resumeAll, true); });
  })();
  /* Keyboard reaches EmulatorJS only when THIS iframe has focus — the picker
     click landed in the parent, so grab focus on load and keep it. */
  addEventListener('load', function(){ try{ window.focus(); document.body && document.body.focus && document.body.focus(); }catch(e){} });
  document.documentElement.tabIndex=-1;
  var s=document.createElement('script');s.src=${J(EJS_DATA + 'loader.js')};document.body.appendChild(s);
<\/script>
</body></html>`;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(doc);
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
    edits: getEdits(), // hand-pruned text overrides (right-click editing)
    iteration: (latestCommitted() || {}).id ?? 0, // the "growth number" shown on the header
    lastIteration: it ? {
      id: it.id, status: it.status, trigger: it.trigger,
      finished_at: it.finished_at, summary: it.summary,
      feedback_count: it.feedback_count, review_ok: it.review_ok, review_score: it.review_score,
    } : null,
  };
}

// Kiosk pages currently listening for controller actions (SSE).
const padClients = new Set();
setInterval(() => { for (const c of padClients) { try { c.write(': ping\n\n'); } catch { padClients.delete(c); } } }, 30000).unref?.();

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;

    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, version: getUiVersion(), night: getNight(), uptime: Math.round((Date.now() - START) / 1000) });
    if (req.method === 'GET' && p === '/api/version') return json(res, 200, { version: getUiVersion() });
    if (req.method === 'GET' && p === '/api/state') return json(res, 200, stateObject());
    if (req.method === 'GET' && p === '/api/iterations') {
      // One concise "what changed" phrase per committed tending — powers the
      // /iterations changelog. changelogPhrase() prefers the agent's CHANGELOG:
      // line and skips test-status boilerplate ("all checks green") otherwise.
      const iterations = recentIterations(80)
        .filter((x) => x.status === 'committed')
        .map((x) => ({ id: x.id, at: x.finished_at, feedback: x.feedback_count, phrase: changelogPhrase(x.summary) || 'self-directed improvement' }));
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
    // ---- hand edits ("pruning"): persist a right-click text override.
    // Localhost-only server — only the wall itself can write these.
    if (req.method === 'POST' && p === '/api/edits') {
      let slot = '', value = '';
      try { const b = JSON.parse(await readBody(req)); slot = String(b.slot || ''); value = String(b.value ?? ''); }
      catch { return json(res, 400, { error: 'bad json' }); }
      if (!/^[a-z][a-z0-9-]*(:[a-z0-9_-]+)?$/i.test(slot) || slot.length > 64) return json(res, 400, { error: 'bad slot' });
      value = value.trim().slice(0, 120);
      setEdit(slot, value);
      log(`edit ${slot} = ${JSON.stringify(value)}`);
      return json(res, 200, { ok: true, slot, value });
    }

    // ---- readable-article extractor (the wall's "browser in a browser") -----
    // Fetches an arbitrary PUBLIC http(s) page and returns readable text for the
    // HN reader panel. Localhost-only server; private-IP ranges still blocked
    // (same guard as the proxy) but NO allowlist — articles live anywhere.
    if (req.method === 'GET' && p === '/api/readable') {
      const target = u.searchParams.get('url');
      if (!target) return json(res, 400, { error: 'missing url' });
      try {
        let t;
        try { t = new URL(target); } catch { return json(res, 400, { error: 'bad url' }); }
        if (t.protocol !== 'http:' && t.protocol !== 'https:') return json(res, 400, { error: 'bad scheme' });
        const addrs = await lookup(t.hostname, { all: true });
        if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return json(res, 400, { error: 'blocked address' });
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        let r;
        try {
          r = await fetch(t.toString(), {
            signal: ac.signal, redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) TheGardenerReader/1.0', Accept: 'text/html,*/*;q=0.5' },
          });
        } finally { clearTimeout(timer); }
        const html = (await r.text()).slice(0, 3 * 1024 * 1024);
        const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim() || t.hostname;

        // raw=1 → serve the page's ORIGINAL HTML, scripts INCLUDED, rendered in a
        // null-origin sandboxed iframe (the client uses sandbox="allow-scripts"
        // WITHOUT allow-same-origin, so the page's JS runs but in an opaque origin
        // — it can't read our cookies/localStorage/DOM or call our APIs). We keep
        // the page's <script> tags (JS-rendered articles now work), inject a
        // <base> so relative assets resolve, our mint scrollbar skin, and a tiny
        // postMessage scroll bridge so the controller can still scroll it (the
        // parent can't reach a cross-origin iframe's scrollBy directly).
        if (u.searchParams.get('raw') === '1') {
          // AUTO mode: if the page is content-rich, render the ORIGINAL; if it's a
          // sparse SPA/JS-only shell (would render blank), serve our clean text
          // page instead so the reader is NEVER blank.
          const extracted = readerExtractText(html);
          if (extracted.length < 900) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(readerTextPage(title, extracted, r.url || target));
          }
          const origin = (r.url || t.toString());
          let doc = html; // scripts preserved on purpose (safe: null-origin sandbox)
          const baseTag = `<base href="${origin.replace(/"/g, '&quot;')}">`;
          const skin = `<style id="gardener-reader-skin">
            html{scrollbar-width:thin;scrollbar-color:#43e6c6 transparent;}
            ::-webkit-scrollbar{width:12px;height:12px;}
            ::-webkit-scrollbar-track{background:transparent;}
            ::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#74f7b0,#43e6c6);border-radius:999px;border:3px solid rgba(255,255,255,.0);background-clip:padding-box;min-height:48px;}
          </style>`;
          // Trusted (first-party) scroll bridge: the controller/keyboard scroll
          // posts {__readerScroll: dy}; we scroll. Runs in the null-origin frame.
          const bridge = '<script>(function(){addEventListener("message",function(e){var d=e&&e.data;if(d&&typeof d.__readerScroll==="number"){try{scrollBy({top:d.__readerScroll,behavior:"smooth"})}catch(_){scrollBy(0,d.__readerScroll)}}},false)})();<\/script>';
          const inject = baseTag + skin + bridge;
          if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => m + inject);
          else doc = inject + doc;
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          return res.end(doc);
        }
        return json(res, 200, { title, text: readerExtractText(html), url: r.url || target });
      } catch (e) {
        return json(res, 502, { error: 'could not fetch the page', detail: String(e.message || e).slice(0, 120) });
      }
    }

    // ---- FPS test results from the live kiosk (read back via kv / logs).
    if (req.method === 'POST' && p === '/api/fps-result') {
      let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
      const compact = JSON.stringify(b).slice(0, 1500);
      setKV('fps_last', JSON.stringify({ at: Date.now(), r: JSON.parse(compact) }));
      log(`fps result: ${compact}`);
      return json(res, 200, { ok: true });
    }

    // ---- controller (SN30 Pro) bridge: pad service POSTs, kiosk listens (SSE).
    if (req.method === 'GET' && p === '/api/pad/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': pad stream open\n\n');
      padClients.add(res);
      req.on('close', () => padClients.delete(res));
      return; // held open
    }
    if (req.method === 'POST' && p === '/api/pad/action') {
      let action = '';
      try { action = String(JSON.parse(await readBody(req)).action || ''); } catch { return json(res, 400, { error: 'bad json' }); }
      if (!/^[a-z]{1,16}$/.test(action)) return json(res, 400, { error: 'bad action' });
      for (const c of padClients) { try { c.write(`data: ${JSON.stringify({ action })}\n\n`); } catch { padClients.delete(c); } }
      return json(res, 200, { ok: true, listeners: padClients.size });
    }

    if (req.method === 'GET' && p === '/api/proxy') return handleProxy(req, res, u);

    // ---- retro-console emulator (the Arcade widget) -------------------------
    // Arcade emulator bootstrap page (served, NOT srcdoc): a real same-origin
    // document so EmulatorJS/RetroArch can query screen dimensions, use storage,
    // and resolve cdn.emulatorjs.org relative paths normally — a srcdoc iframe
    // (about:srcdoc base URL, no screen) makes RetroArch render a black frame.
    // Inherits the cross-origin-isolation headers via serveEmuFrame.
    if (req.method === 'GET' && p === '/emu-frame.html') return serveEmuFrame(req, res, u);
    // List the ROMs the user dropped in data/roms/ (localhost-only server).
    if (req.method === 'GET' && p === '/api/roms') return json(res, 200, { roms: await listRoms() });
    // Stream one ROM's bytes (read-only, basename-guarded path traversal).
    if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/roms/')) return serveRom(req, res, p);

    // Hearth (household app) — READ-ONLY status for the wall cleaning widget.
    // Localhost wall surface: reads, PLUS the chore-logging write so the Roots
    // widget can log a chore right from the wall (this server is localhost-only,
    // so only the kiosk can reach it). Every OTHER house write stays exclusive to
    // the public plant-server.
    if (p.startsWith('/api/house')) {
      const isChoreWrite = req.method === 'POST' && (p === '/api/house/chores' || p === '/api/house/chores/undo');
      const handled = await handleHouseApi(req, res, u, { readOnly: !isChoreWrite, log });
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
