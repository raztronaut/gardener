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
    // Every external host a main-wall widget fetches through the proxy (literal
    // `fetchJSON('https://host…` / fetchText) must be allowlisted, or that data
    // silently never arrives (e.g. daily.js's Wikidata notability ranking).
    try {
      const allow = JSON.parse(readFileSync(join(ROOT, 'src', 'proxy-allowlist.json'), 'utf8')).allow || [];
      const okHost = (h) => allow.some((a) => h === a || h.endsWith('.' + a));
      const missing = [];
      for (const w of (manifest.widgets || []).filter((x) => x.enabled)) {
        const wf = join(PUBLIC, 'widgets', w.file);
        if (!existsSync(wf)) continue;
        for (const m of readFileSync(wf, 'utf8').matchAll(/fetch(?:JSON|Text)\(\s*[`'"]https:\/\/([a-z0-9.-]+)/gi)) {
          if (!okHost(m[1].toLowerCase())) missing.push(`${w.file}→${m[1]}`);
        }
      }
      check('widget fetch hosts are proxy-allowlisted', missing.length === 0, missing.join(', '));
    } catch (e) { bad('widget fetch hosts are proxy-allowlisted', e.message); }
    // Dashboards: registry parses, every combo is unique and 3+ shoulders, every
    // dashboard manifest lists real widget files with a default export.
    try {
      const dj = JSON.parse(readFileSync(join(PUBLIC, 'dashboards.json'), 'utf8'));
      const ds = dj.dashboards || [];
      check('dashboards.json has main', ds.some((d) => d.id === 'main'));
      const combos = ds.filter((d) => d.combo).map((d) => d.combo.split('+').map((x) => x.trim()).sort().join('+'));
      check('dashboard combos unique + 3+ shoulder buttons', new Set(combos).size === combos.length
        && combos.every((c) => c.split('+').length >= 3 && c.split('+').every((b) => ['L1', 'R1', 'L2', 'R2'].includes(b))), combos.join(' | '));
      for (const d of ds.filter((x) => x.id !== 'main')) {
        const mf = join(PUBLIC, d.manifest.replace(/^\//, ''));
        if (!check(`dashboard ${d.id}: manifest exists`, existsSync(mf))) continue;
        for (const w of JSON.parse(readFileSync(mf, 'utf8')).widgets || []) {
          const wf = join(PUBLIC, w.file.replace(/^\//, ''));
          check(`dashboard ${d.id}: ${w.file} exports default`, existsSync(wf) && /export\s+default/.test(readFileSync(wf, 'utf8')));
        }
      }
    } catch (e) { bad('dashboards.json', e.message); }
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
    // Layout-stability rule: the runtime must reserve each card's settled size
    // before its data arrives (see GARDEN_RULES.md) and must not animate cards.
    try {
      const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
      const css = readFileSync(join(PUBLIC, 'styles.css'), 'utf8');
      check('layout stability: cards reserve their loaded size before data arrives',
        /reserveCardSize\(card, entry\.id\)[\s\S]{0,1500}await w\.mount/.test(appSrc) && /function settleCardSize/.test(appSrc));
      check('layout stability: no card entrance motion', !/\.card\s*\{[^}]*animation:\s*rise/.test(css) && !/@keyframes rise/.test(css));
    } catch (e) { bad('layout stability', e.message); }
    // House rule: no wind anywhere on the Weather card (removed twice by the humans).
    try {
      const wx = readFileSync(join(PUBLIC, 'widgets', 'weather.js'), 'utf8');
      check('weather: no wind fetched or rendered (house rule)', !/wind_speed|wind_direction|wind_gusts|windArrow|\bmph\b/.test(wx));
    } catch (e) { bad('weather wind rule', e.message); }
    // Fractal art (replaced APOD): deterministic per 3-hour slot, cycles through the
    // families, and the tiny PNG encoder emits a valid signature + IHDR.
    try {
      const fr = await import(join(ROOT, 'src', 'fractal.mjs'));
      const fams = new Set(Array.from({ length: 5 }, (_, k) => fr.sceneInfo(1000 + k).family));
      check('fractal: same slot → same scene', JSON.stringify(fr.sceneInfo(4242)) === JSON.stringify(fr.sceneInfo(4242)));
      check('fractal: slots cycle the families', ['bulb', 'julia', 'box', 'menger'].every((f) => fams.has(f)), [...fams].join(','));
      { // camera must sit outside a positive-scale Mandelbox (inside = a flat wall of colour)
        const inside = [];
        for (let k = 0; k < 400; k++) { const p = fr.sceneParams(k); if (p.fam === 'box' && p.scale > 0 && p.dist < 2 * (2 * (p.scale + 1) / (p.scale - 1))) inside.push(k); }
        check('fractal: Mandelbox camera frames the whole box (outside its bounds)', inside.length === 0, inside.slice(0, 5).join(','));
      }
      check('fractal: slot is 3 hours', fr.SLOT_MS === 3 * 3600 * 1000 && fr.slotOf(fr.SLOT_MS * 7 + 5) === 7);
      const png = fr.encodePNG(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]));
      check('fractal: PNG encoder writes a valid header',
        png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === 2 && png.readUInt32BE(20) === 1);
    } catch (e) { bad('fractal renderer', e.message); }
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
      const { fetchEvents, localeRank, dedupKey, sameEvent } = await import(join(PUBLIC, 'lib', 'events.js'));
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
      // splitTitle tidies trailing title tags for the wall card.
      const { splitTitle } = await import(join(PUBLIC, 'lib', 'events.js'));
      const s1 = splitTitle('Desi Comedy Night Live in SF (7p + 9p)');
      const s2 = splitTitle('Latine Makers Pop-Up (SF’s Ferry Building)');
      const s3 = splitTitle('Whale’s Tail Beer Garden (Summer 2026)');
      const s4 = splitTitle('Terror Vault Haunt (Oct. 1-Nov. 1)');
      check('events: splitTitle moves time/venue/date tags out of the name',
        s1.name === 'Desi Comedy Night Live in SF' && s1.time === '7P + 9P'
        && s2.where === 'Ferry Building' && s3.name === 'Whale’s Tail Beer Garden' && !s3.note
        && s4.note === 'thru Nov 1' && splitTitle('Party (SF)').name === 'Party (SF)',
        JSON.stringify([s1, s2, s3, s4]));
      const s5 = splitTitle('Arcade Karaoke: SF s Wild New Thursday Night Party + $3 Shots (SF)');
      check('events: scraper-dropped apostrophe is restored ("SF s" → "SF’s")',
        s5.name === 'Arcade Karaoke: SF’s Wild New Thursday Night Party + $3 Shots', s5.name);
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
      // Same-day reworded listings of ONE event collapse (the wall once showed the
      // "World of Dumplings" festival twice), but distinct events stay distinct.
      check('events: reworded same-day duplicates are recognised',
        sameEvent('SF’s Free “World of Dumplings” Festival at the Ferry Building', '2026 “World of Dumplings” Festival at SF’s Ferry Building')
        && sameEvent('SF’s “World of Dumplings” 2026: Free Community Food Fest (Ferry Building)', 'SF’s Free “World of Dumplings” Festival at the Ferry Building'),
        'near-duplicate titles not matched');
      check('events: distinct events are not merged as duplicates',
        !sameEvent('Golden Gate Park Sunday Roller Disco Party (SF)', '“Lindy in the Park” Swing Dance Party (Golden Gate Park)')
        && !sameEvent('Oakland Chinatown’s “Trick Or Treat” Trail', 'Free “Trick-Or-Treat” Around Historic Aircraft at Hiller Aviation Museum')
        && !sameEvent('Oakland’s Free POC Comedy Night (Temescal)', 'Oakland’s “Mezcal & Mole” Comedy Night (Mondays & Tuesdays)'),
        'distinct events wrongly matched');
    } catch (e) { bad('events ordering', e.message); }
    // Gardyn plant tracker: all 16 pods of the Budding Florist kit are mapped to a
    // unique layout position, and the trajectory logic reads sensibly at key days.
    try {
      const g = await import(join(PUBLIC, 'widgets', 'gardyn.js'));
      const pods = g.PLANTS.flatMap((p) => p.pos);
      check('gardyn: 16 pods, each position used once', pods.length === 16 && new Set(pods).size === 16,
        `got ${pods.length} pods / ${new Set(pods).size} unique`);
      const pet = g.PLANTS.find((p) => /Petunia/.test(p.n));
      check('gardyn: petunia germinating on day 4, blooming on day 35',
        g.plantStatus(pet, 4).phase === 'seed' && g.plantStatus(pet, 35).phase === 'ready',
        `got ${g.plantStatus(pet, 4).phase} / ${g.plantStatus(pet, 35).phase}`);
      // Sprout dose was given Sep 28 (day 8): weekly waterings anchor on it, with the
      // food strength stepping up as plants grow; thinning follows 5–7 days after.
      const wp = g.waterPlan(10, 3);
      check('gardyn: water plan anchors on the sprout dose (top-off day 15, ¼ tsp/gal)',
        wp[0].d === 15 && wp[0].kind === 'top' && /¼ tsp/.test(wp[0].amt) && wp[2].kind === 'refresh',
        `got ${JSON.stringify(wp.map((w) => [w.d, w.kind, w.amt]))}`);
      check('gardyn: next task after the sprout dose is thinning (day 13–15)',
        g.nextTask(10)?.id === 'thin' && g.nextTask(10).d === 13 && g.doneLog().some((c) => c.t === 'Sprout dose'),
        `got ${JSON.stringify(g.nextTask(10))}`);
      check('gardyn: stages progress', g.gardenStage(3) === 'Germinating' && g.gardenStage(90) === 'Blooming',
        `got ${g.gardenStage(3)} / ${g.gardenStage(90)}`);
      // Sown Sep 20 at 14 h, 16 h from Sep 23 (day 3): a 30-baseline-day milestone
      // (15 h) lands ~1 day early; an 80-day one ~5 days early.
      check('gardyn: light-scaled timeline (14 h → 16 h)', g.calDay(30) === 29 && g.calDay(80) === 75 && g.calDay(0) === 0,
        `calDay(30)=${g.calDay(30)} calDay(80)=${g.calDay(80)}`);
    } catch (e) { bad('gardyn tracker', e.message); }
    // The plant-watering reminder is fortnightly (every 14 days) with generic wording —
    // the humans asked for it to stop being weekly and to drop the personal note.
    try {
      const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
      check('plant reminder: fortnightly cadence', /PLANT_EVERY_DAYS\s*=\s*14\b/.test(appSrc), 'PLANT_EVERY_DAYS must be 14');
      check('plant reminder: no personal note', !/PLANT_NOTE/.test(appSrc), 'PLANT_NOTE should be gone');
    } catch (e) { bad('plant reminder guards', e.message); }
    // The Tuesday curb-trash takeover must fire early enough to be unmissable before
    // Wednesday's early-morning pickup — the humans asked for the big flashing red screen
    // from 5 PM onwards. Guard against it silently drifting later again (regression 2026-07-29).
    try {
      const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
      const m = appSrc.match(/TRASH_NIGHT_HOUR\s*=\s*(\d+)/);
      check('trash takeover fires by 5 PM (TRASH_NIGHT_HOUR ≤ 17)', m && Number(m[1]) <= 17, m ? `is ${m[1]}` : 'TRASH_NIGHT_HOUR not found');
    } catch (e) { bad('trash takeover threshold', e.message); }
    // Clock holiday heads-up: the movable-date maths must land on the right days.
    try {
      const ckSrc = readFileSync(join(PUBLIC, 'widgets', 'clock.js'), 'utf8');
      const mod = await import('data:text/javascript,' + encodeURIComponent(ckSrc.split('export default')[0] + 'export { holidaysOf, nextHoliday };'));
      const day = (y, n) => { const x = mod.holidaysOf(y).find((r) => r[0] === n); return x ? `${x[1]}/${x[2]}` : null; };
      const nh = mod.nextHoliday(2026, 10, 26);
      check('clock holidays: Thanksgiving/Easter/Memorial Day dates', day(2026, 'Thanksgiving') === '11/26' && day(2027, 'Easter') === '3/28'
        && day(2026, 'Memorial Day') === '5/25' && day(2027, 'Thanksgiving') === '11/25', `${day(2026, 'Thanksgiving')} ${day(2027, 'Easter')} ${day(2026, 'Memorial Day')}`);
      check('clock holidays: nearest occasion within a week', nh && nh.name === 'Halloween' && nh.days === 5 && mod.nextHoliday(2026, 11, 1) === null
        && mod.nextHoliday(2026, 12, 29)?.name === "New Year's Eve" && mod.nextHoliday(2026, 12, 31)?.days === 0, JSON.stringify(nh));
    } catch (e) { bad('clock holiday maths', e.message); }
    // Weather forecast days must carry °C as well as °F (feedback 2026-09-23).
    try {
      const wxSrc = readFileSync(join(PUBLIC, 'widgets', 'weather.js'), 'utf8');
      check('weather: forecast days show °C too', /const tempCell[^\n]*\n[^\n]*fToC\(f\)\}°C/.test(wxSrc), 'tempCell must render °F and °C');
    } catch (e) { bad('weather °C guard', e.message); }

    // 3) Boot the server with an isolated DB + port.
    console.log('\n[3] server boot');
    server = spawn(process.execPath, [join(ROOT, 'src', 'server.mjs')], {
      env: { ...process.env, GARDENER_PORT: String(PORT), GARDENER_DATA: tmpData, GARDENER_HOST: '127.0.0.1', GARDENER_FRACTAL: '0' },
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
    // Fractal API answers even before the first render (smoke disables rendering).
    try {
      const fm = await (await fetch(`${BASE}/api/fractal`)).json();
      const fp = await fetch(`${BASE}/api/fractal.png`);
      check('fractal: /api/fractal meta endpoint + png placeholder', 'meta' in fm && fm.slotMs === 3 * 3600 * 1000 && (fp.status === 503 || fp.ok), JSON.stringify({ fm, png: fp.status }));
    } catch (e) { bad('fractal API', e.message); }
    // Care log API (✓ Done buttons): record a top-off, see it, undo it; junk is refused.
    try {
      const post = (b) => fetch(`${BASE}/api/gardyn/log`, { method: 'POST', body: JSON.stringify(b) });
      const r1 = await (await post({ id: 'water', kind: 'top', action: 'done', date: '2026-10-05' })).json();
      const r2 = await (await fetch(`${BASE}/api/gardyn`)).json();
      const r3 = await (await post({ id: 'water', action: 'undo', date: '2026-10-05' })).json();
      const junk = await post({ id: '../etc', action: 'done' });
      check('gardyn: care log records, persists and undoes',
        r1.ok && r2.log.water.some((w) => w.date === '2026-10-05') && !r3.log.water.length && r2.log.tasks.sprout === '2026-09-28' && junk.status === 400,
        JSON.stringify({ r1, r2, r3, junk: junk.status }));
    } catch (e) { bad('gardyn care log', e.message); }
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
