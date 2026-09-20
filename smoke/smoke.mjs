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
    // Discussion-pulse marker — the 🗣 cue must fire only for genuinely contested
    // stories (a real crowd talking AND comments rivaling upvotes) and stay quiet
    // on ordinary ones, so the wall isn't peppered with meaningless glyphs.
    try {
      const { debateRate } = await import(join(PUBLIC, 'widgets', 'hacker-news.js'));
      check('HN discussion marker fires on a contested story',
        debateRate({ score: 120, descendants: 140 }) === 140, 'expected 140');
      const quiet = [
        debateRate({ score: 800, descendants: 40 }),  // busy but not a big thread
        debateRate({ score: 500, descendants: 90 }),  // crowd, but dwarfed by upvotes
        debateRate({ score: 0, descendants: 0 }),      // empty
      ];
      check('HN discussion marker stays quiet on ordinary stories',
        quiet.every((v) => v === 0), `got ${quiet.join(',')}`);
    } catch (e) { bad('HN discussion marker', e.message); }
    // Board-rank movement — the "living front page" cue must surface only RISERS
    // (a story climbing the shown board) and fresh ARRIVALS, and stay silent for a
    // story that held its place or slipped, so the feed stays calm.
    try {
      const { rankMovement } = await import(join(PUBLIC, 'widgets', 'hacker-news.js'));
      const up = rankMovement(3, 1);      // was #4, now #2 → climbed 2
      check('HN rank movement flags a riser',
        up && up.kind === 'up' && up.delta === 2, `got ${JSON.stringify(up)}`);
      const fresh = rankMovement(null, 0); // not on the board last time
      check('HN rank movement flags a fresh arrival',
        fresh && fresh.kind === 'new', `got ${JSON.stringify(fresh)}`);
      const quietMoves = [
        rankMovement(0, 0),   // held its spot
        rankMovement(0, 2),   // slipped down
      ];
      check('HN rank movement stays quiet on held/slipped stories',
        quietMoves.every((v) => v === null), `got ${JSON.stringify(quietMoves)}`);
    } catch (e) { bad('HN rank movement', e.message); }
    // APOD archival catalogue number: a whole-day count from the first Astronomy
    // Picture of the Day (1995-06-16 = № 1), inclusive, computed in UTC. The epoch
    // + inclusive semantics are the invariant behind the museum-placard chip; a
    // pre-launch or unparseable date must hide the placard (null).
    try {
      const { catalogNumber } = await import(join(PUBLIC, 'widgets', 'apod.js'));
      check('APOD catalogue: first picture is № 1', catalogNumber('1995-06-16') === 1,
        `got ${catalogNumber('1995-06-16')}`);
      check('APOD catalogue: counts days inclusively', catalogNumber('1995-06-17') === 2,
        `got ${catalogNumber('1995-06-17')}`);
      check('APOD catalogue: a fixed recent date computes exactly',
        catalogNumber('2026-09-10') === 11410, `got ${catalogNumber('2026-09-10')}`);
      check('APOD catalogue: pre-launch / bad dates hide the placard',
        catalogNumber('1995-06-15') === null && catalogNumber('') === null,
        `got ${catalogNumber('1995-06-15')},${catalogNumber('')}`);
    } catch (e) { bad('APOD catalogue number', e.message); }
    // Daily almanac "On This Day" round-anniversary marker: a historical moment
    // falling exactly a multiple of 25 years ago to the day (25th/50th/100th…) is
    // flagged; ordinary and this-year moments are not. The "multiple of 25, ≥ 25"
    // rule is the invariant behind the quiet gold ✦ occasion marker.
    try {
      const { milestoneOf } = await import(join(PUBLIC, 'widgets', 'daily.js'));
      check('almanac milestone: 25/50/100 years ago are flagged',
        milestoneOf(2001, 2026)?.years === 25 && milestoneOf(1976, 2026)?.years === 50
        && milestoneOf(1926, 2026)?.years === 100, 'expected 25/50/100');
      check('almanac milestone: off-round + this-year + bad years are quiet',
        milestoneOf(2000, 2026) === null && milestoneOf(2026, 2026) === null
        && milestoneOf(2030, 2026) === null && milestoneOf(NaN, 2026) === null,
        'expected null for non-milestone years');
    } catch (e) { bad('almanac milestone marker', e.message); }
    // SF events feed carries scraped HTML entities (&#8220;curly quotes&#8221;, &amp;,
    // &#39;, &eacute;…) that render as PLAIN TEXT on the wall — a literal "&#8221;"
    // must never leak onto the hero card. Exercise the shared cleanName() decoder.
    try {
      const { cleanName, cleanPlace } = await import(join(PUBLIC, 'lib', 'events.js'));
      const decoded = cleanName('9/18/26: $1 Drink Fridays: &#8220;Battle of the Decades&#8221; DJ Party - FREE');
      check('events feed decodes HTML entities in titles',
        decoded === '$1 Drink Fridays: “Battle of the Decades” DJ Party', `got: ${decoded}`);
      const amp = cleanName('Tom &amp; Jerry&#39;s Caf&eacute;');
      check('events feed decodes named + numeric entities',
        amp === "Tom & Jerry's Café", `got: ${amp}`);
      const venue = cleanPlace('R&amp;R Lounge, San Francisco, CA');
      check('events feed decodes entities in venue names', venue === 'R&R Lounge', `got: ${venue}`);
    } catch (e) { bad('events entity decode', e.message); }
    // SF events ORDERING. The upstream API can only sort by a row's scrape
    // timestamp, which has nothing to do with when the event happens (the real
    // calendar day lives in the title, "10/3/26: …"). Trusting that order put
    // plans WEEKS away at the head of a card whose whole job is "what's on
    // tonight", so fetchEvents must sort locally. Guard the three invariants with
    // a deliberately scrambled fixture; a fake fetchJSON keeps this offline.
    try {
      const { fetchEvents, localeRank, dedupKey } = await import(join(PUBLIC, 'lib', 'events.js'));
      const sfDate = (n) => new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', year: '2-digit', month: 'numeric', day: 'numeric',
      }).format(new Date(Date.now() + n * 864e5)); // "9/20/26"
      const row = (n, name) => ({ title: `${sfDate(n)}: ${name} - FREE`, available_from: '2026-01-01T12:00:00Z', location_address: '' });
      // Payload order is intentionally NOT chronological — mimicking the real feed.
      const fixture = [
        row(10, 'Faraway Fest (Oakland)'),
        row(0, 'Berkeley Old Time Music Festival in the Park'),
        row(3, 'Westbrae Pumpkin Patch 2026 in North Berkeley'),
        row(1, "Tomorrow Thing (SF)"),
        row(0, "SF's Chinatown Autumn Moon Festival"),
        row(2, 'Golden Gate Park Sunday Roller Disco Party (SF)'),
        row(1, 'Westbrae Pumpkin Patch 2026 in North Berkeley'),
        row(2, 'Golden Gate Park The Whales Tail Beer Garden (SF)'),
      ];
      const evs = await fetchEvents(async () => fixture);
      const names = evs.map((e) => e.name);
      let mono = true;
      for (let i = 1; i < evs.length; i++) if (evs[i - 1].when > evs[i].when) mono = false;
      check('events: sorted by real event date, not scrape order', mono, `got ${JSON.stringify(names)}`);
      check('events: soonest event leads the list', names[0] === "SF's Chinatown Autumn Moon Festival",
        `got ${names[0]}`);
      // Same-day ties break toward San Francisco — the card is headlined "Out in SF".
      check('events: same-day ties prefer San Francisco',
        names.indexOf("SF's Chinatown Autumn Moon Festival") < names.indexOf('Berkeley Old Time Music Festival in the Park'),
        `got ${JSON.stringify(names.slice(0, 2))}`);
      check('events: localeRank reads SF vs East Bay',
        localeRank({ name: 'Party (SF)' }) === 0 && localeRank({ name: 'Party (Oakland)' }) === 2
        && localeRank({ name: 'Mystery Party' }) === 1, 'locality classifier wrong');
      // A recurring series collapses to ONE row — and must keep its SOONEST date.
      const patches = evs.filter((e) => /Westbrae/.test(e.name));
      check('events: recurring series keeps its soonest occurrence',
        patches.length === 1 && patches[0].dayKey === evs.find((e) => e.name === 'Tomorrow Thing (SF)').dayKey,
        `kept ${patches.length} at ${patches[0] && patches[0].dayKey}`);
      // …while genuinely different events that merely share an opening phrase must
      // BOTH survive (a 12-char dedupe key used to silently eat one of them).
      check('events: distinct events sharing a name prefix both survive',
        names.some((n) => /Roller Disco/.test(n)) && names.some((n) => /Whales Tail/.test(n)),
        `got ${JSON.stringify(names)}`);
      check('events: dedupe key is long enough to separate them',
        dedupKey('Golden Gate Park Sunday Roller Disco Party') !== dedupKey('Golden Gate Park The Whales Tail Beer Garden'),
        'dedupe prefix too short');
    } catch (e) { bad('events ordering', e.message); }
    // Transit (BART) board: its data host must stay allowlisted or the widget can
    // never reach live/scheduled departures, and its feed parsers must normalise
    // BART's raw destination strings + the "Leaving" estimate to sane board labels.
    try {
      const allow = JSON.parse(readFileSync(join(ROOT, 'src', 'proxy-allowlist.json'), 'utf8')).allow || [];
      check('transit: api.bart.gov is allowlisted', allow.includes('api.bart.gov'), 'add api.bart.gov to proxy-allowlist.json');
      const { shortDest, schedDest, estMinutes, parseBsa, platformInfo } = await import(join(PUBLIC, 'widgets', 'transit.js'));
      check('transit: shortens long destinations', shortDest('Berryessa/North San Jose') === 'Berryessa',
        `got ${shortDest('Berryessa/North San Jose')}`);
      check('transit: scheduled head-station → final leg', schedDest('SF / OAK Airport / Berryessa') === 'Berryessa',
        `got ${schedDest('SF / OAK Airport / Berryessa')}`);
      check('transit: "Leaving" estimate reads as 0 min', estMinutes('Leaving') === 0 && estMinutes('7') === 7,
        `got ${estMinutes('Leaving')},${estMinutes('7')}`);
      // Service advisory: the "No delays reported." sentinel must read as CLEAR (so the
      // board stays calm), while a real advisory surfaces its text for the header clause.
      const bsaClear = parseBsa({ root: { bsa: [{ description: { '#cdata-section': 'No delays reported.' } }] } });
      // BART's live feed also returns "No advisories issued." on a clear day — it must
      // read as CLEAR too, not surface as a spurious ⚠ advisory (regression 2026-09-18).
      const bsaClear2 = parseBsa({ root: { bsa: [{ description: { '#cdata-section': 'No advisories issued.' } }] } });
      const bsaAlert = parseBsa({ root: { bsa: [{ description: { '#cdata-section': 'Major delay on the Yellow line.' } }] } });
      check('transit: clear BSA reads as no advisory', bsaClear.clear === true && bsaClear2.clear === true,
        `got ${JSON.stringify(bsaClear)} / ${JSON.stringify(bsaClear2)}`);
      check('transit: real BSA surfaces advisory text',
        bsaAlert.clear === false && /Yellow line/.test(bsaAlert.text || ''), `got ${JSON.stringify(bsaAlert)}`);
      // Platform pill: a live estimate with a numeric platform surfaces a "Plat N"
      // board tag (direction in the tooltip); a platform-less estimate returns null
      // so the pill hides on the scheduled fallback.
      const platS = platformInfo({ platform: '2', direction: 'South' });
      check('transit: platform pill reads platform + direction',
        platS && platS.tag === 'Plat 2' && /Southbound/.test(platS.title), `got ${JSON.stringify(platS)}`);
      check('transit: platform pill hides when absent',
        platformInfo({ direction: 'North' }) === null && platformInfo({ platform: '' }) === null,
        'expected null with no numeric platform');
    } catch (e) { bad('transit board guards', e.message); }
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
      // Guard against a null/undefined value coerced into a visible text node —
      // native Node.appendChild/replaceChildren turn a null arg into the literal
      // string "null" (ctx.h filters these, but direct DOM calls don't). Scope to
      // markup only (scripts/styles stripped) so code containing the words can't
      // false-positive. Two shapes are caught: (a) a node that is EXACTLY
      // "null"/"undefined" between two tags (">null<"); and (b) the coercion GLUED
      // onto a preceding sibling's text — the case that once printed
      // "August 26, 2026null" — which appears as null/undefined trailing a digit or
      // "> " right before a closing tag. Requiring a digit/">" prefix keeps this
      // free of false positives on real copy (e.g. an HN title ending in the word
      // "null" is preceded by a letter/space, never a digit).
      const markup = dom.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
      const strays = markup.match(/(?:>|\d)(?:null|undefined)</g) || [];
      check('no stray null/undefined text rendered', strays.length === 0, `found ${strays.length} stray value node(s)`);
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
  // The dump snapshots the DOM when the virtual-time budget elapses. app.js publishes
  // its readiness markers (data-gardener-ready) synchronously, right after the local
  // state/manifest/import fetches and BEFORE awaiting any widget's external data — but
  // on a cold/slow boot the snapshot can very occasionally land in the sliver before
  // those markers appear. That's a race in the CAPTURE, not a real boot failure, so
  // re-dump a few times until the markers show up. If boot genuinely never readies,
  // the last attempt still lacks the marker and the real assertions fail honestly —
  // this only heals the transient early-snapshot, it does not mask a broken boot.
  let stdout = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    ({ stdout } = await pExecFile(CHROMIUM, args, { timeout: 45000, maxBuffer: 16 * 1024 * 1024 }));
    if (/data-gardener-ready="true"/.test(stdout)) break;
    if (attempt < 3) await sleep(500);
  }
  return stdout;
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
