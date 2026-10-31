// The Gardener™ — small pictures for "Out in SF" events (GET /api/event-image).
//
// The SF RATS listing almost never carries an image (its `images` column is filled for
// a handful of workshop rows), so the server reads the event PAGE once and remembers the
// picture it advertises: og:image / twitter:image, else FunCheap's featured image
// (`img.wp-post-image` — FunCheap pages have no og:image), else a JSON-LD "image". The
// picture is fetched once, cropped to a small JPEG with ffmpeg, and kept on disk:
//   data/event-images.json   page url → { img, at }   (misses retried after a day)
//   data/event-images/       <hash>-<size>.jpg        (size-capped, oldest pruned)
// Read-only and localhost-only like the rest of the wall server; private addresses are
// refused (the same guard as the proxy). Work is serialised two at a time and niced so a
// card full of new events never spikes the Jetson.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { paths } from './config.mjs';

const FILE = join(paths.DATA, 'event-images.json');
const DIR = join(paths.DATA, 'event-images');
const UA = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const SIZES = { s: [120, 80], l: [360, 240] }; // card thumbnail · detail view (3:2)
const MISS_TTL = 24 * 3600 * 1000;
const KEEP_MS = 45 * 24 * 3600 * 1000;   // re-read a page's picture after this long
const CAP_BYTES = 40 * 1024 * 1024;      // data/event-images/ size cap
const MAX_PAGE = 3 * 1024 * 1024, MAX_IMG = 8 * 1024 * 1024;

let cache = null, loading = null, saveT = null;
function load() { // one read, shared by every early caller (no lost entries)
  loading ||= fs.readFile(FILE, 'utf8').then(JSON.parse).catch(() => ({})).then((c) => { c.pages ||= {}; return (cache = c); });
  return loading;
}
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const now = Date.now();
    for (const [k, v] of Object.entries(cache.pages)) if (now - (v.at || 0) > KEEP_MS) delete cache.pages[k];
    fs.writeFile(FILE + '.tmp', JSON.stringify(cache)).then(() => fs.rename(FILE + '.tmp', FILE)).catch(() => {});
  }, 1000);
};

// two jobs at a time (page fetch + crop), the rest wait their turn
let active = 0; const waiters = [];
async function slot(fn) {
  if (active >= 2) await new Promise((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; const w = waiters.shift(); if (w) w(); }
}

// reserved/private ranges — the same list as the proxy's guard in server.mjs
const BLOCK = new BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, n, 'ipv6');
function isPrivateIp(ip) {
  let v = isIP(ip);
  if (v === 6) { const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); if (m) { ip = m[1]; v = 4; } }
  if (!v) return true;
  return BLOCK.check(ip, v === 6 ? 'ipv6' : 'ipv4');
}
async function publicUrl(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  try {
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
  } catch { return null; }
  return u;
}
async function get(url, accept, max) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = await publicUrl(cur);
    if (!u) return null;
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), u).toString(); continue; }
    if (!r.ok) return { status: r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > max ? null : { status: r.status, buf, url: u.toString(), type: r.headers.get('content-type') || '' };
  }
  return null;
}

// The page's own picture, best first. Pure; exported for smoke.
const GENERIC = /logo|favicon|share[_-]?image|default[_-]?(og|share|image)|placeholder|\.svg(\?|$)/i;
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i')) || [])[1] || '';
const unent = (s) => s.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&').replace(/\\\//g, '/');
export function pageImage(html, base) {
  const s = String(html || '').slice(0, MAX_PAGE);
  const abs = (v) => { try { const u = new URL(unent(v.trim()), base); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; } };
  const ok = (v) => v && !GENERIC.test(v);
  for (const m of s.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') || attr(m[0], 'name')).toLowerCase();
    if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/.test(key)) { const v = abs(attr(m[0], 'content')); if (ok(v)) return v; }
  }
  for (const m of s.matchAll(/<img\b[^>]*\bwp-post-image\b[^>]*>/gi)) {
    const cands = [attr(m[0], 'src'), attr(m[0], 'data-src'), (attr(m[0], 'srcset').split(',')[0] || '').trim().split(/\s+/)[0]];
    for (const c of cands) { if (c && !/^data:/i.test(c)) { const v = abs(c); if (ok(v)) return v; } }
  }
  const ld = s.match(/"image"\s*:\s*"(https?:[^"]+)"/i) || s.match(/"image"\s*:\s*\{[^}]*"url"\s*:\s*"(https?:[^"]+)"/i);
  if (ld) { const v = abs(ld[1]); if (ok(v)) return v; }
  return '';
}

function crop(src, out, [w, h]) {
  return new Promise((resolve) => {
    const ch = spawn('nice', ['-n', '12', 'ffmpeg', '-v', 'error', '-y', '-i', src, '-frames:v', '1',
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-q:v', '4', '-f', 'mjpeg', out],
    { stdio: 'ignore' });
    const t = setTimeout(() => ch.kill('SIGKILL'), 15000);
    ch.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
    ch.on('error', () => { clearTimeout(t); resolve(false); });
  });
}

let pruning = false;
async function prune() {
  if (pruning) return; pruning = true;
  try {
    const files = await Promise.all((await fs.readdir(DIR)).map(async (f) => {
      try { const st = await fs.stat(join(DIR, f)); return { f, size: st.size, t: st.mtimeMs }; } catch { return null; }
    }));
    const list = files.filter(Boolean).sort((a, b) => a.t - b.t);
    let total = list.reduce((n, x) => n + x.size, 0);
    for (const x of list) { if (total <= CAP_BYTES * 0.8) break; await fs.unlink(join(DIR, x.f)).catch(() => {}); total -= x.size; }
  } catch { /* nothing cached yet */ } finally { pruning = false; }
}

const inflight = new Map();
// → JPEG bytes for the event at `pageUrl` (its listed `hint` image first), or null.
export async function eventImage(pageUrl, hint = '', size = 's') {
  const dims = SIZES[size] || SIZES.s;
  const key = createHash('sha1').update(String(hint || pageUrl)).digest('hex').slice(0, 20);
  const file = join(DIR, `${key}-${size in SIZES ? size : 's'}.jpg`);
  try {
    const buf = await fs.readFile(file);
    // keep the cap's "oldest first" pruning honest: a picture still in use stays young
    fs.stat(file).then((st) => { if (Date.now() - st.mtimeMs > 864e5) fs.utimes(file, new Date(), new Date()).catch(() => {}); }).catch(() => {});
    return buf;
  } catch { /* not cropped yet */ }
  const c = await load();
  const ent = c.pages[pageUrl];
  if (ent && !ent.img && Date.now() - ent.at < MISS_TTL) return null; // a known miss
  if (inflight.has(file)) return inflight.get(file);
  const job = slot(async () => {
    let img = hint || (ent && ent.img) || '';
    if (!img) {
      let page;
      try { page = await get(pageUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', MAX_PAGE); }
      catch { return null; } // network blip — try again next time
      if (!page || !page.buf) { c.pages[pageUrl] = { img: '', at: Date.now() }; save(); return null; }
      img = pageImage(page.buf.toString('utf8'), page.url);
      c.pages[pageUrl] = { img, at: Date.now() }; save();
      if (!img) return null;
    }
    let pic;
    try { pic = await get(img, 'image/webp,image/png,image/jpeg,image/*;q=0.8', MAX_IMG); } catch { return null; }
    if (!pic || !pic.buf || /svg|html/i.test(pic.type)) { c.pages[pageUrl] = { img: '', at: Date.now() }; save(); return null; }
    await fs.mkdir(DIR, { recursive: true });
    const tmp = join(tmpdir(), `gardener-evimg-${key}-${process.pid}`);
    try {
      await fs.writeFile(tmp, pic.buf);
      if (!(await crop(tmp, file + '.tmp', dims))) { c.pages[pageUrl] = { img: '', at: Date.now() }; save(); return null; }
      await fs.rename(file + '.tmp', file);
    } finally { fs.unlink(tmp).catch(() => {}); fs.unlink(file + '.tmp').catch(() => {}); }
    prune();
    return fs.readFile(file).catch(() => null);
  }).finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}
