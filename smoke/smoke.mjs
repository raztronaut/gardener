// The Gardener™ — smoke tests (the safety net).
// Fast, dependency-light, exits 0 (green) or 1 (broken). Run before every deploy.
//
// Covers: module syntax, manifest integrity, server boot, all API endpoints,
// feedback round-trip, proxy SSRF guards, and a real headless render proving
// every widget mounts with ZERO core/import/mount errors.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pExecFile = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const CHROMIUM = process.env.GARDENER_CHROMIUM || '/snap/bin/chromium';
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0; const failures = [];
function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function bad(name, detail) { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); return cond; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmpData = mkdtempSync(join(tmpdir(), 'gardener-smoke-'));
  let server;
  try {
    // 1) Syntax-check all backend ES modules (.mjs files are unambiguously ESM).
    console.log('\n[1] module syntax');
    const srcFiles = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.mjs')).map((f) => join('src', f));
    srcFiles.push('smoke/smoke.mjs');
    for (const f of srcFiles) {
      try { await pExecFile(process.execPath, ['--check', join(ROOT, f)]); ok(`syntax ${f}`); }
      catch (e) { bad(`syntax ${f}`, (e.stderr || e.message).toString().split('\n')[0]); }
    }

    // 2) Manifest integrity + widget files present and plausibly ESM.
    console.log('\n[2] widget manifest');
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(PUBLIC, 'widgets', 'manifest.json'), 'utf8')); ok('manifest.json parses'); }
    catch (e) { bad('manifest.json parses', e.message); manifest = { widgets: [] }; }
    check('manifest has widgets array', Array.isArray(manifest.widgets));
    for (const w of manifest.widgets || []) {
      const wf = join(PUBLIC, 'widgets', w.file);
      if (!check(`widget file exists: ${w.file}`, existsSync(wf))) continue;
      const src = readFileSync(wf, 'utf8');
      check(`widget exports default: ${w.file}`, /export\s+default/.test(src), 'no `export default`');
    }
    for (const f of ['index.html', 'app.js', 'styles.css']) {
      check(`core file exists: ${f}`, existsSync(join(PUBLIC, f)));
    }
    // Hacker News profanity guard — this is an unattended WALL display, so a crude
    // front-page title must never render. Exercise the widget's isClean() filter
    // against a battery of offensive (incl. obfuscated) and legitimate titles.
    try {
      const { isClean } = await import(join(PUBLIC, 'widgets', 'hacker-news.js'));
      const mustDrop = [
        'stop fucking in the couch — i can see you in the hidden camera bro',
        'F*ck this API', 'sh1t happens', 'a f u c k story', 'This is bullshit',
      ];
      const mustKeep = [
        'Show HN: A new Rust compiler', 'Cloudflare outage postmortem',
        'Why I quit my job', 'Analysis of assembly performance',
      ];
      const leaks = mustDrop.filter((t) => isClean(t));
      const wrongDrops = mustKeep.filter((t) => !isClean(t));
      check('HN filter drops profane/offensive titles', leaks.length === 0, `leaked: ${leaks.join(' | ')}`);
      check('HN filter keeps legitimate titles', wrongDrops.length === 0, `over-filtered: ${wrongDrops.join(' | ')}`);
    } catch (e) { bad('HN profanity guard', e.message); }
    // The Tuesday curb-trash takeover must fire early enough to be unmissable before
    // Wednesday's early-morning pickup — the humans asked for the big flashing red screen
    // from 5 PM onwards. Guard against it silently drifting later again (regression 2026-07-29).
    try {
      const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
      const m = appSrc.match(/TRASH_NIGHT_HOUR\s*=\s*(\d+)/);
      check('trash takeover fires by 5 PM (TRASH_NIGHT_HOUR ≤ 17)', m && Number(m[1]) <= 17, m ? `is ${m[1]}` : 'TRASH_NIGHT_HOUR not found');
    } catch (e) { bad('trash takeover threshold', e.message); }

    // 3) Boot the server with an isolated DB + port.
    console.log('\n[3] server boot');
    server = spawn(process.execPath, [join(ROOT, 'src', 'server.mjs')], {
      env: { ...process.env, GARDENER_PORT: String(PORT), GARDENER_DATA: tmpData, GARDENER_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverErr = '';
    server.stderr.on('data', (d) => { serverErr += d; });
    server.stdout.on('data', () => {});
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) { up = true; break; } } catch { /* not yet */ }
      await sleep(250);
    }
    if (!check('server responds on /api/health', up, serverErr.split('\n').slice(-3).join(' ').slice(0, 200))) {
      throw new Error('server did not come up');
    }

    // 4) Endpoints
    console.log('\n[4] endpoints');
    for (const [path, test] of [
      ['/', (r) => r.ok],
      ['/api/health', async (r) => r.ok && (await r.clone().json()).ok === true],
      ['/api/version', async (r) => typeof (await r.json()).version === 'number'],
      ['/api/state', async (r) => { const s = await r.json(); return s.canvas.w === 900 && s.canvas.h === 1600 && typeof s.publicUrl === 'string'; }],
      ['/plant.html', (r) => r.ok], // remote note-planting page (QR target)
      ['/api/iterations', async (r) => r.ok && Array.isArray((await r.json()).iterations)],
      ['/api/grow', async (r) => { const d = await r.json(); return r.ok && typeof d.running === 'boolean' && typeof d.pending === 'number'; }],
      ['/widgets/manifest.json', (r) => r.ok],
      ['/styles.css', (r) => r.ok],
      ['/app.js', (r) => r.ok],
    ]) {
      try { const r = await fetch(BASE + path); check(`GET ${path}`, await test(r)); }
      catch (e) { bad(`GET ${path}`, e.message); }
    }
    for (const w of manifest.widgets || []) {
      try { const r = await fetch(`${BASE}/widgets/${w.file}`); check(`GET /widgets/${w.file}`, r.ok); }
      catch (e) { bad(`GET /widgets/${w.file}`, e.message); }
    }
    // controller bridge: action relay accepts a valid action, rejects junk
    try {
      const r1 = await fetch(`${BASE}/api/pad/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"noop"}' });
      const r2 = await fetch(`${BASE}/api/pad/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"<bad!>"}' });
      check('pad action relay (accept + validate)', r1.ok && r2.status === 400);
    } catch (e) { bad('pad action relay', e.message); }

    // path traversal must be blocked
    try { const r = await fetch(`${BASE}/../package.json`); check('blocks path traversal', r.status === 403 || r.status === 404); }
    catch { ok('blocks path traversal'); }

    // 5) Feedback round-trip
    console.log('\n[5] feedback persistence');
    const probe = 'smoke-' + Date.now();
    try {
      const r = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: probe }) });
      const j = await r.json();
      check('POST /api/feedback ok', r.ok && j.ok && typeof j.id === 'number');
      const list = await (await fetch(`${BASE}/api/feedback?limit=5`)).json();
      check('feedback persisted & readable', list.feedback.some((f) => f.text === probe));
    } catch (e) { bad('feedback round-trip', e.message); }
    // empty feedback rejected
    try { const r = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"  "}' }); check('rejects empty feedback', r.status === 400); }
    catch (e) { bad('rejects empty feedback', e.message); }
    // a pending note can be deleted (pruned before tending), then it's gone
    try {
      const created = await (await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'smoke-del-' + Date.now() }) })).json();
      const del = await fetch(`${BASE}/api/feedback?id=${created.id}`, { method: 'DELETE' });
      check('DELETE /api/feedback removes a pending note', del.ok);
      const after = await (await fetch(`${BASE}/api/feedback?limit=50`)).json();
      check('deleted note no longer listed', !after.feedback.some((f) => f.id === created.id));
      const del404 = await fetch(`${BASE}/api/feedback?id=${created.id}`, { method: 'DELETE' });
      check('DELETE of unknown note 404s', del404.status === 404);
    } catch (e) { bad('feedback delete round-trip', e.message); }

    // 6) Proxy SSRF guards (no real network needed)
    console.log('\n[6] proxy SSRF guards');
    for (const [name, url, wantBlocked] of [
      ['blocks non-allowlisted host', 'https://evil.example.com/x', true],
      ['blocks private IP', 'http://169.254.169.254/latest/meta-data', true],
      ['blocks file scheme', 'file:///etc/passwd', true],
      ['blocks localhost', 'http://127.0.0.1:8793/api/health', true],
    ]) {
      try {
        const r = await fetch(`${BASE}/api/proxy?url=${encodeURIComponent(url)}`);
        check(name, wantBlocked ? r.status >= 400 : r.ok);
      } catch (e) { bad(name, e.message); }
    }

    // 7) Headless render: every widget mounts, zero core/import/mount errors.
    console.log('\n[7] headless render integrity');
    try {
      const dom = await dumpDom(`${BASE}/?screenshot=1`);
      check('page renders (gardener-ready)', /data-gardener-ready="true"/.test(dom), 'app.js never reached ready');
      const errAttr = (dom.match(/data-gardener-error="(\d+)"/) || [])[1];
      check('no core/import/mount JS errors', !errAttr || errAttr === '0', `error count=${errAttr}`);
      const importAttr = (dom.match(/data-gardener-import="(\d+)"/) || [])[1];
      check('all widgets imported cleanly', !importAttr || importAttr === '0', `import failures=${importAttr}`);
      const count = (dom.match(/data-gardener-widget-count="(\d+)"/) || [])[1];
      const expected = (manifest.widgets || []).filter((w) => w.enabled !== false).length;
      check('all enabled widgets mounted', count && Number(count) === expected, `mounted ${count} of ${expected}`);
      const overflow = (dom.match(/data-gardener-overflow="(\d+)"/) || [])[1];
      check('fits 900×1600 (garden not overflowing)', overflow == null || Number(overflow) <= 24, `garden overflows by ${overflow}px`);
      const cardClip = (dom.match(/data-gardener-card-clip="(\d+)"/) || [])[1];
      const clipped = (dom.match(/data-gardener-clipped="([^"]*)"/) || [])[1] || '';
      check('no content clipped inside any widget', !cardClip || Number(cardClip) <= 8, `clipped widgets: ${clipped || cardClip + 'px'}`);
    } catch (e) { bad('headless render', e.message); }

  } finally {
    if (server) { try { server.kill('SIGKILL'); } catch { /* ignore */ } }
    try { rmSync(tmpData, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // 8) Hearth (household side app) — run its dedicated smoke as a subprocess
  // (its own ports/temp DB). Folded in so `npm run smoke` covers it too.
  console.log('\n[8] Hearth household app');
  try {
    await pExecFile(process.execPath, [join(ROOT, 'smoke', 'house-smoke.mjs')], { timeout: 60000 });
    ok('hearth smoke passed (users/sessions/chores/rankings/notifications)');
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).toString();
    const fails = out.split('\n').filter((l) => /✗/.test(l)).slice(0, 8).join(' | ');
    bad('hearth smoke', fails || (e.message || '').split('\n')[0]);
  }

  console.log(`\n${'─'.repeat(46)}`);
  if (failures.length) {
    console.log(`SMOKE FAILED — ${passed} passed, ${failures.length} failed:`);
    for (const f of failures) console.log(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log(`SMOKE PASSED — ${passed} checks green 🌱`);
  process.exit(0);
}

async function dumpDom(url) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--user-data-dir=${join(ROOT, 'data', '.chrome-profile')}`,
    '--virtual-time-budget=8000', '--dump-dom', url,
  ];
  const { stdout } = await pExecFile(CHROMIUM, args, { timeout: 45000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
