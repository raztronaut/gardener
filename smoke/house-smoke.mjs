// Hearth (household app) — smoke test. Boots the PUBLIC plant-server on a test
// port + temp DB and exercises every household endpoint: create user, start
// session (+notification), log chores, rankings (day/week), notifications,
// status, and the read-only guard on the localhost server. Exits 0/1.
// A separate, hand-maintained side project (the daily tending must NOT touch it).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLANT_PORT = 8795;
const MAIN_PORT = 8796;
const PB = `http://127.0.0.1:${PLANT_PORT}`;  // public surface (read+write)
const MB = `http://127.0.0.1:${MAIN_PORT}`;   // localhost surface (read-only)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0; const failures = [];
const ok = (n) => { passed++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { failures.push(`${n}${d ? ' — ' + d : ''}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); };
const check = (n, c, d) => { c ? ok(n) : bad(n, d); return c; };
const jpost = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const jget = (base, path) => fetch(base + path);

async function waitUp(url, n = 40) { for (let i = 0; i < n; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); } return false; }

async function main() {
  const tmpData = mkdtempSync(join(tmpdir(), 'hearth-smoke-'));
  const env = { ...process.env, GARDENER_DATA: tmpData, GARDENER_HOST: '127.0.0.1', GARDENER_NO_RECOVER: '1' };
  // Boot the plant server first and let it create the fresh schema, THEN the
  // localhost server — so two processes don't race to CREATE TABLE on a brand-new
  // temp DB (which can transiently lock under WAL on a cold start).
  const plant = spawn(process.execPath, [join(ROOT, 'src', 'plant-server.mjs')], { env: { ...env, GARDENER_PLANT_PORT: String(PLANT_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let perr = ''; plant.stderr.on('data', (d) => { perr += d; }); plant.stdout.on('data', () => {});
  let main;
  let merr = '';

  try {
    console.log('\n[hearth] server boot');
    if (!check('plant server up', await waitUp(`${PB}/api/house/chores`), perr.split('\n').slice(-2).join(' ').slice(0, 200))) throw new Error('plant did not boot');
    main = spawn(process.execPath, [join(ROOT, 'src', 'server.mjs')], { env: { ...env, GARDENER_PORT: String(MAIN_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    main.stderr.on('data', (d) => { merr += d; }); main.stdout.on('data', () => {});
    check('main server up', await waitUp(`${MB}/api/health`), merr.split('\n').slice(-2).join(' ').slice(0, 200));

    console.log('\n[hearth] app + fallback serve');
    check('GET / serves Roots app', /Roots/.test(await (await jget(PB, '/')).text()));
    check('GET /plant.html still works (fallback)', (await jget(PB, '/plant.html')).ok);
    check('GET /house/app.js serves app js', (await jget(PB, '/house/app.js')).ok);
    check('GET /house/house.css serves css', (await jget(PB, '/house/house.css')).ok);
    check('blocks /house/ traversal', (await jget(PB, '/house/..%2f..%2fpackage.json')).status === 404);

    console.log('\n[hearth] chore catalog');
    const chores = (await (await jget(PB, '/api/house/chores')).json()).chores;
    check('chore catalog has 7 entries', Array.isArray(chores) && chores.length === 7, `got ${chores && chores.length}`);
    check('last chore is free-text "other"', chores.at(-1).key === 'other' && chores.at(-1).freeText === true);

    console.log('\n[hearth] users');
    const u1 = await (await jpost(PB, '/api/house/users', { name: 'Ada' })).json();
    check('create user Ada', u1.ok && u1.user && typeof u1.user.id === 'number');
    const u1b = await (await jpost(PB, '/api/house/users', { name: 'ada' })).json(); // case-insensitive dedupe
    check('user create is case-insensitive (no dup)', u1b.user.id === u1.user.id);
    const u2 = await (await jpost(PB, '/api/house/users', { name: 'Grace' })).json();
    check('create user Grace', u2.ok && u2.user.id !== u1.user.id);
    check('rejects empty name', (await jpost(PB, '/api/house/users', { name: '   ' })).status === 400);
    check('rejects bogus name', (await jpost(PB, '/api/house/users', { name: '<script>' })).status === 400);
    const users = (await (await jget(PB, '/api/house/users')).json()).users;
    check('lists both users', users.length === 2);

    console.log('\n[hearth] clean session + notification');
    const start = await (await jpost(PB, '/api/house/session/start', { userId: u1.user.id })).json();
    check('start session for Ada', start.ok && start.session && typeof start.session.id === 'number');
    const sid = start.session.id;
    const start2 = await (await jpost(PB, '/api/house/session/start', { userId: u1.user.id })).json();
    check('starting again reuses the open session (idempotent)', start2.session.id === sid);
    let notifs = (await (await jget(PB, '/api/house/notifications')).json()).notifications;
    check('session_start notification emitted', notifs.some((n) => n.kind === 'session_start' && /Ada started cleaning/.test(n.text)));

    console.log('\n[hearth] batch-log chores on Confirm (+points)');
    // The old per-tap auto-log endpoint is GONE — selection happens client-side and
    // NOTHING is logged until the batch Confirm hits POST /api/house/chores.
    check('old per-tap /api/house/chore is removed (404)', (await jpost(PB, '/api/house/chore', { userId: u1.user.id, sessionId: sid, chore: 'vacuum' })).status === 404);
    // Ada confirms a batch: vacuum(2) + counters(1) + curb(2) + other "windows"(1) = 6.
    const batch = await (await jpost(PB, '/api/house/chores', { userId: u1.user.id, sessionId: sid, chores: ['vacuum', 'counters', 'curb', { chore: 'other', note: 'cleaned the windows' }] })).json();
    check('batch-log returns ok + ids', batch.ok && Array.isArray(batch.ids) && batch.ids.length === 4, `got ${batch.ids && batch.ids.length}`);
    check('batch-log reports count', batch.count === 4, `got ${batch.count}`);
    let notifsB = (await (await jget(PB, '/api/house/notifications')).json()).notifications;
    const choreNotifs = notifsB.filter((n) => n.kind === 'chore');
    check('exactly one chore notification for the batch', choreNotifs.length === 1, `got ${choreNotifs.length}`);
    check('summary notification names the chores', /cleaned:/.test(choreNotifs[0].text) && /windows/.test(choreNotifs[0].text));
    check('batch rejects empty selection', (await jpost(PB, '/api/house/chores', { userId: u1.user.id, chores: [] })).status === 400);
    check('batch rejects unknown chore', (await jpost(PB, '/api/house/chores', { userId: u1.user.id, chores: ['nope'] })).status === 400);
    check('batch requires note for free-text "other"', (await jpost(PB, '/api/house/chores', { userId: u1.user.id, chores: ['other'] })).status === 400);
    // Grace confirms a single-chore batch.
    const graceBatch = await (await jpost(PB, '/api/house/chores', { userId: u2.user.id, chores: ['trash'] })).json();
    check('Grace batch-logs trash (worth 1)', graceBatch.ok && graceBatch.count === 1);

    console.log('\n[hearth] undo + clear-today');
    // Ada makes a throwaway batch, then undoes exactly that batch (the "decrease").
    const tmpBatch = await (await jpost(PB, '/api/house/chores', { userId: u1.user.id, chores: ['counters'] })).json();
    check('undo batch removes only those ids', (await (await jpost(PB, '/api/house/chores/undo', { userId: u1.user.id, scope: 'batch', ids: tmpBatch.ids })).json()).removed === 1);
    let adaAfterUndo = (await (await jget(PB, '/api/house/rankings')).json()).day.find((p) => p.name === 'Ada');
    check('Ada still has 6 points after undoing the throwaway batch', adaAfterUndo && adaAfterUndo.points === 6, `got ${adaAfterUndo && adaAfterUndo.points}`);
    check('undo with no ids 400s', (await jpost(PB, '/api/house/chores/undo', { userId: u1.user.id, scope: 'batch', ids: [] })).status === 400);
    // A user can only remove their OWN events: Grace cannot undo Ada's ids.
    check('cannot undo another user\'s ids (scoped)', (await (await jpost(PB, '/api/house/chores/undo', { userId: u2.user.id, scope: 'batch', ids: batch.ids })).json()).removed === 0);
    // DELETE is an accepted alias for the undo route.
    const tmp2 = await (await jpost(PB, '/api/house/chores', { userId: u2.user.id, chores: ['counters'] })).json();
    check('DELETE alias undoes a batch', (await (await fetch(PB + '/api/house/chores/undo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u2.user.id, scope: 'batch', ids: tmp2.ids }) })).json()).removed === 1);

    console.log('\n[hearth] web push (VAPID + subscribe/unsubscribe)');
    const vp = await (await jget(PB, '/api/house/vapid-public')).json();
    check('vapid-public returns a key', typeof vp.publicKey === 'string' && vp.publicKey.length > 80, `got ${vp.publicKey && vp.publicKey.length}`);
    // A plausible-looking subscription (https endpoint + both encryption keys).
    const goodSub = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/SMOKE-' + Date.now(), keys: { p256dh: 'BPexampleKeyMaterialAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', auth: 'YXV0aHNlY3JldEFB' } }, userId: u1.user.id };
    const sub1 = await jpost(PB, '/api/house/subscribe', goodSub);
    check('subscribe persists a valid subscription', sub1.ok);
    // Re-subscribing the same endpoint is an upsert (no error, no duplicate).
    check('re-subscribe same endpoint is idempotent', (await jpost(PB, '/api/house/subscribe', goodSub)).ok);
    check('subscribe rejects missing keys', (await jpost(PB, '/api/house/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/x' } })).status === 400);
    check('subscribe rejects non-https endpoint', (await jpost(PB, '/api/house/subscribe', { subscription: { endpoint: 'http://insecure/x', keys: { p256dh: 'a', auth: 'b' } } })).status === 400);
    check('subscribe rejects empty body', (await jpost(PB, '/api/house/subscribe', {})).status === 400);
    check('unsubscribe accepts the endpoint', (await jpost(PB, '/api/house/unsubscribe', { endpoint: goodSub.subscription.endpoint })).ok);
    check('unsubscribe rejects bad endpoint', (await jpost(PB, '/api/house/unsubscribe', { endpoint: 'nope' })).status === 400);
    check('main server also exposes vapid-public (read-only ok)', (await jget(MB, '/api/house/vapid-public')).ok);

    console.log('\n[hearth] PWA assets (service worker + manifest + icons)');
    const sw = await jget(PB, '/sw.js');
    check('GET /sw.js serves the service worker', sw.ok && /Service Worker|push|showNotification/i.test(await sw.clone().text()));
    check('/sw.js sets Service-Worker-Allowed: /', sw.headers.get('service-worker-allowed') === '/');
    const mani = await jget(PB, '/manifest.webmanifest');
    check('GET /manifest.webmanifest serves a manifest', mani.ok);
    const manijson = await mani.json();
    check('manifest is installable (name + icons + standalone)', manijson.name && manijson.display === 'standalone' && Array.isArray(manijson.icons) && manijson.icons.length >= 2);
    check('GET /assets/hearth-icon-192.png exists', (await jget(PB, '/assets/hearth-icon-192.png')).ok);
    check('GET /assets/hearth-icon-512.png exists', (await jget(PB, '/assets/hearth-icon-512.png')).ok);
    check('index.html links the manifest', /rel="manifest"/.test(await (await jget(PB, '/')).text()));

    console.log('\n[hearth] session view');
    const sv = await (await jget(PB, `/api/house/session?id=${sid}`)).json();
    check('session view lists Ada chores', sv.session && sv.session.name === 'Ada' && sv.chores.length === 4);

    console.log('\n[hearth] rankings (day/week)');
    const rk = await (await jget(PB, '/api/house/rankings')).json();
    // Ada: vacuum(2)+counters(1)+curb(2)+other(1)=6 ; Grace: trash(1)=1
    const adaDay = rk.day.find((p) => p.name === 'Ada');
    const graceDay = rk.day.find((p) => p.name === 'Grace');
    check('Ada has 6 points today', adaDay && adaDay.points === 6, `got ${adaDay && adaDay.points}`);
    check('Grace has 1 point today', graceDay && graceDay.points === 1, `got ${graceDay && graceDay.points}`);
    check('leaderboard sorted (Ada first)', rk.day[0].name === 'Ada');
    check('week ranking present', Array.isArray(rk.week) && rk.week.length === 2);

    console.log('\n[hearth] status snapshot');
    const st = await (await jget(PB, '/api/house/status')).json();
    check('status shows Ada cleaning', st.cleaning.some((c) => c.name === 'Ada'));
    check('status has day/week/activity/notifications', Array.isArray(st.day) && Array.isArray(st.week) && Array.isArray(st.activity) && Array.isArray(st.notifications));
    check('chore notification emitted', st.notifications.some((n) => n.kind === 'chore'));

    console.log('\n[hearth] end session');
    check('end session ok', (await jpost(PB, '/api/house/session/end', { sessionId: sid })).ok);
    const st2 = await (await jget(PB, '/api/house/status')).json();
    check('Ada no longer cleaning', !st2.cleaning.some((c) => c.name === 'Ada'));
    check('session_end notification emitted', st2.notifications.some((n) => n.kind === 'session_end'));

    console.log('\n[hearth] localhost server is READ-ONLY for house');
    check('main GET /api/house/status works', (await jget(MB, '/api/house/status')).ok);
    check('main rejects house writes (403)', (await jpost(MB, '/api/house/session/start', { userId: u1.user.id })).status === 403);
    check('main rejects batch chore-log (403)', (await jpost(MB, '/api/house/chores', { userId: u1.user.id, chores: ['trash'] })).status === 403);

    console.log('\n[hearth] clear my activity today (reset points)');
    // Wipe Ada's whole day — her points should drop to zero / she leaves the board.
    const cleared = await (await jpost(PB, '/api/house/chores/undo', { userId: u1.user.id, scope: 'today' })).json();
    check('clear-today removes Ada\'s 4 logged chores', cleared.removed === 4, `removed ${cleared.removed}`);
    const rkAfter = await (await jget(PB, '/api/house/rankings')).json();
    check('Ada is off the day leaderboard after clearing', !rkAfter.day.some((p) => p.name === 'Ada'));
    check('Grace still on the board (only own events cleared)', rkAfter.day.some((p) => p.name === 'Grace' && p.points === 1));

    console.log('\n[hearth] rate-limit guard exists');
    let limited = false;
    for (let i = 0; i < 80; i++) { if ((await jpost(PB, '/api/house/users', { name: 'X' })).status === 429) { limited = true; break; } }
    check('write rate limit returns 429 under flood', limited);

  } finally {
    for (const c of [plant, main]) { try { c && c.kill('SIGKILL'); } catch { /* ignore */ } }
    try { rmSync(tmpData, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n${'─'.repeat(46)}`);
  if (failures.length) { console.log(`HEARTH SMOKE FAILED — ${passed} passed, ${failures.length} failed:`); for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
  console.log(`HEARTH SMOKE PASSED — ${passed} checks green 🔥`);
  process.exit(0);
}
main().catch((e) => { console.error('hearth smoke crashed:', e); process.exit(1); });
