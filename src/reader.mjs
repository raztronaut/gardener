// The Gardener™ — the HN reader's article resolver (/api/readable, server.mjs).
//
// The wall's reader shows a clean text page. A plain fetch works for most
// articles, but some come back with no article in their HTML:
//   · JavaScript apps / SPAs (the HTML is an empty shell until scripts run)
//   · bot walls — DataDome / Cloudflare "Just a moment…" / "Client Challenge" pages
//     that refuse scripted fetches outright (e.g. meidasnews.com hard-blocks)
// For those, readerResolve() tries, in order, and keeps whichever yields the most text:
//   1. a short-lived, low-priority headless Chromium render of the page (it simply
//      loads the page like a browser — no disguise or stealth: walls that block it stay
//      blocked), then the same text extraction on the rendered DOM
//   2. the newest Internet Archive capture (Wayback Machine, raw `id_` copy)
// A page that is still text-less but loads fine is an APP (a synth, a demo…) — the
// caller shows the original page for those. Results are cached in data/reader-cache/
// (12 h; misses 30 min) so reopening a story is instant and the Jetson renders once.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';

const CACHE_DIR = join(paths.DATA, 'reader-cache');
const PROFILE = join(paths.DATA, 'reader-prof');
const CHROMIUM = process.env.GARDENER_READER_CHROMIUM || '/snap/bin/chromium';
const ENOUGH = 600;       // chars of article text that count as "a real article"
const APP_MAX = 300;      // below this after every fallback → it's an app, not an article
const UA = 'Mozilla/5.0 (X11; Linux aarch64) TheGardenerReader/1.0';

// ---- text extraction ---------------------------------------------------------
const clean = (body) => body
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
  .join('\n').replace(/\n{3,}/g, '\n\n');

// Crude-but-sturdy readable text: the RICHEST <article>/<main> (the first one is often
// a tiny widget — Hugging Face's model page read 43 chars that way), else the whole
// document when those are thin. Chrome (nav/header/footer/aside/forms) is dropped.
export function extractReadable(html) {
  const cands = [...String(html || '').matchAll(/<(article|main)\b[\s\S]*?<\/\1>/gi)].map((m) => clean(m[0]));
  let best = cands.sort((a, b) => b.length - a.length)[0] || '';
  if (best.length < ENOUGH) { const all = clean(String(html || '')); if (all.length > best.length) best = all; }
  return best.slice(0, 60000);
}

const WALL = /captcha-delivery\.com|datadome|cf-chl|challenge-platform|<title>\s*Just a moment|Client Challenge|Please enable JS and disable any ad ?blocker|Attention Required! \| Cloudflare|Access to this page has been denied/i;
export const isBotWall = (status, html) => status === 403 || status === 429 || WALL.test(String(html || '').slice(0, 30000));
const titleOf = (html) => (String(html || '').match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim() || '';
const ogDesc = (html) => (String(html || '').match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']{20,})["']/i) || [])[1] || '';

// ---- 1 · headless render (one at a time, niced, time-boxed) --------------------
const NO_LOCAL_PAC = `function FindProxyForURL(url, host) {
  var BH = "PROXY 127.0.0.1:9";
  if (isPlainHostName(host) || host == "localhost" || dnsDomainIs(host, ".local") || dnsDomainIs(host, ".localhost") || shExpMatch(host, "*:*")) return BH;
  var ip = dnsResolve(host);
  if (!ip) return "DIRECT";
  if (isInNet(ip, "127.0.0.0", "255.0.0.0") || isInNet(ip, "10.0.0.0", "255.0.0.0") || isInNet(ip, "172.16.0.0", "255.240.0.0") ||
      isInNet(ip, "192.168.0.0", "255.255.0.0") || isInNet(ip, "169.254.0.0", "255.255.0.0") || isInNet(ip, "100.64.0.0", "255.192.0.0") ||
      isInNet(ip, "0.0.0.0", "255.0.0.0")) return BH;
  return "DIRECT";
}`;
let queue = Promise.resolve();
function headlessDom(url, ms = 20000) {
  const run = () => new Promise((resolve) => {
    let out = '', done = false;
    const ch = spawn('nice', ['-n', '12', CHROMIUM, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
      '--mute-audio', '--no-first-run', '--disable-background-networking', `--user-data-dir=${PROFILE}`,
      // the article's JS must not reach this house's own services: loopback, LAN and
      // link-local addresses are routed to a dead proxy (Chrome's Local Network Access
      // block does this too; this is the backstop). <-loopback> removes Chrome's
      // implicit "never proxy localhost" rule so the PAC sees those hosts as well.
      `--proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(NO_LOCAL_PAC).toString('base64')}`, '--proxy-bypass-list=<-loopback>',
      '--virtual-time-budget=8000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    const finish = () => { if (done) return; done = true; clearTimeout(t); try { process.kill(-ch.pid, 'SIGKILL'); } catch { /* gone */ } resolve(out); };
    const t = setTimeout(finish, ms);
    ch.stdout.on('data', (d) => { if (out.length < 6e6) out += d; });
    ch.on('error', finish);
    ch.on('close', finish);
  });
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---- 2 · newest Internet Archive capture -------------------------------------
async function waybackCopy(url) {
  try {
    const cdx = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=-1&filter=statuscode:200&fl=timestamp,original`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const row = Array.isArray(cdx) && cdx.length > 1 ? cdx[cdx.length - 1] : null;
    if (!row) return null;
    const [ts, orig] = row;
    const r = await fetch(`https://web.archive.org/web/${ts}id_/${orig}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 3 * 1024 * 1024);
    const d = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    return { html, ts, date: new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
  } catch { return null; }
}

// ---- resolver ---------------------------------------------------------------
const inflight = new Map();
const cacheFile = (url) => join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.json');
async function readCache(url) {
  try {
    const c = JSON.parse(await fs.readFile(cacheFile(url), 'utf8'));
    if (Date.now() - c.at < (c.text.length >= ENOUGH || c.app ? 12 * 3600e3 : 30 * 60e3)) return c;
  } catch { /* none */ }
  return null;
}

// page: { target, status, html, finalUrl, title } from the server's static fetch.
// → { title, text, url, source, app, desc }
export async function readerResolve(page) {
  const { target, status, html, finalUrl } = page;
  const staticText = extractReadable(html);
  const wall = isBotWall(status, html);
  if (!wall && staticText.length >= ENOUGH) return { title: page.title, text: staticText, url: finalUrl, source: null, app: false };
  const hit = await readCache(target);
  if (hit) return hit;
  if (inflight.has(target)) return inflight.get(target);
  const job = (async () => {
    let best = { title: wall ? '' : page.title, text: wall ? '' : staticText, source: null };
    const consider = (h, source) => {
      const t = extractReadable(h);
      if (t.length > best.text.length) best = { title: titleOf(h) || best.title, text: t, source };
    };
    const tryRender = async () => { const dom = await headlessDom(finalUrl || target); if (dom && !isBotWall(200, dom)) consider(dom, 'rendered'); };
    const tryArchive = async () => { const wb = await waybackCopy(target); if (wb) consider(wb.html, `Internet Archive · ${wb.date}`); };
    // bot walls: the archive is the likelier (and faster) source; apps/SPAs: render first
    for (const step of wall ? [tryArchive, tryRender] : [tryRender, tryArchive]) {
      if (best.text.length >= ENOUGH) break;
      await step();
    }
    const res = {
      at: Date.now(), url: finalUrl || target, title: best.title, text: best.text, source: best.source,
      desc: best.text.length < 40 ? ogDesc(html) : '',
      app: !wall && status >= 200 && status < 300 && best.text.length < APP_MAX,
    };
    try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(cacheFile(target), JSON.stringify(res)); } catch { /* cache is optional */ }
    return res;
  })().finally(() => inflight.delete(target));
  inflight.set(target, job);
  return job;
}
