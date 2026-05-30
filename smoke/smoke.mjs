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
      ['/api/state', async (r) => { const s = await r.json(); return s.canvas.w === 900 && s.canvas.h === 1600; }],
      ['/api/iterations', async (r) => r.ok && Array.isArray((await r.json()).iterations)],
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
      check('fits 900×1600 (no clipping)', overflow == null || Number(overflow) <= 24, `garden overflows by ${overflow}px`);
    } catch (e) { bad('headless render', e.message); }

  } finally {
    if (server) { try { server.kill('SIGKILL'); } catch { /* ignore */ } }
    try { rmSync(tmpData, { recursive: true, force: true }); } catch { /* ignore */ }
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
