#!/usr/bin/env node
// Headless QA of the original battle menus (public/arcade/sb2/menu.js) on a TEST wall
// server: title -> SINGLE MATCH -> player table -> rules -> stage select (TALL / CLASSIC)
// -> match -> results -> back to SINGLE MATCH -> Select+Start to the shelf.
//
//   GARDENER_PORT=8791 GARDENER_FRACTAL=0 GARDENER_NO_RECOVER=1 node src/server.mjs &
//   /snap/bin/chromium --headless=new --remote-debugging-port=9341 \
//     --user-data-dir=$PWD/data/sb2-qa-profile2 --autoplay-policy=no-user-gesture-required \
//     --mute-audio "http://127.0.0.1:8791/?dash=arcade" &
//   node tools/sb2/qa/menus.mjs [--cdp 9341] [--fast]
//
// Saves the canvas pixels (native 256 x 455, data/sb2/qa/menus/<n>_<name>.png) and a few
// full-page screenshots. --fast pokes each round's clock to 0:30 (QA only).
// Never use the live kiosk (CDP 9223).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep } from './cdp.mjs';
import { padSender } from './pad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'data', 'sb2', 'qa', 'menus');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9341), PORT = +arg('port', 8791);
const FAST = process.argv.includes('--fast');
if (CDP === 9223 || PORT === 8787) { console.error('refusing to drive the live kiosk'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const c = await connect(CDP, String(PORT));
const pad = padSender(PORT);
const errs = [];
c.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value || a.description).join(' '));
});
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1600, deviceScaleFactor: 1, mobile: false });
const ev = (e) => c.evaluate(e);
const sb2 = (e) => ev(`(() => { const s = window.__SB2; return s ? (${e}) : null; })()`);
const waitFor = async (expr, ms, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); } return false; };
const idle = (ms = 8000) => waitFor(`window.__SB2 && !window.__SB2._menu.busy`, ms);
let n = 0;
async function grab(name) {
  const url = await ev(`(() => { const cv = document.querySelector('.sb2-scr.on canvas'); return cv ? cv.toDataURL('image/png') : null; })()`);
  if (!url) { console.log('  (no canvas for', name, ')'); return; }
  const f = path.join(OUT, `${String(++n).padStart(2, '0')}_${name}.png`);
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  console.log('  grab', path.basename(f), await sb2('s.screen'));
}
// the test server may be in night mode (the wall's dimmer): lift it for the page shots
const shot = async (name) => { await ev(`document.body.classList.remove('night', 'idle')`); await sleep(300); const f = path.join(OUT, `page_${name}.png`); await c.screenshot(f); console.log('  shot', path.basename(f)); };
const tap = async (b, wait = 250) => { await pad.tap(b, 70); await sleep(wait); };
const push = async (d, wait = 250) => { await pad.push(d, 70); await sleep(wait); };

console.log('1. boot from the shelf');
await ev(`localStorage.removeItem('garden.sb2.menu')`);
await c.send('Page.reload');
await waitFor(`!!document.querySelector('.ax-tile')`, 15000);
await sleep(1500);
await pad.post('ok');
if (!await waitFor(`!!(window.__SB2 && window.__SB2.screen === 'menu:title' && document.querySelector('.sb2.ready'))`, 30000)) throw new Error('title did not appear');
await sleep(1200);
await grab('title');
await shot('title');
await push('u', 300); await grab('title_normal');
await push('d', 300);

console.log('2. BATTLE GAME -> SINGLE MATCH');
await tap('A', 600);
await grab('title_confirm');
if (!await waitFor(`window.__SB2.screen === 'menu:mode'`, 8000)) throw new Error('no mode screen');
await idle(); await sleep(300);
await grab('mode');
await push('d'); await grab('mode_tag'); await push('u');

console.log('3. player table');
await tap('A', 400); await idle();
await grab('players');
await push('d'); await push('r'); await grab('players_2P_off_cursor2');
await push('r'); await push('r'); await grab('players_2P_com');
await push('u');

console.log('4. rules');
await tap('A', 400); await idle();
await grab('rules');
await push('r'); await push('l');
await push('d'); await push('d'); await push('r'); await grab('rules_time_3min');
await push('l'); await push('u'); await push('u');
await tap('B', 400); await grab('back_to_players');
await tap('A', 400); await idle();

console.log('5. stage select');
await tap('A', 200);
await sleep(250); await grab('stage_enter_mosaic');
await idle(4000); await sleep(200);
await grab('stage01_tall');
await shot('stage01_tall');
await push('r', 350); await grab('stage_change_mosaic');
await idle(4000); await sleep(100); await grab('stage02_tall');
for (const k of [3, 4, 5, 6, 7, 8, 9, 10]) { await push('r', 100); await idle(4000); await sleep(60); await grab(`stage${String(k).padStart(2, '0')}_tall`); }
await push('r', 100); await idle(4000);                       // back to 1 (wraps)
await push('d', 300); await grab('stage_layout_row');
await push('r', 100); await idle(4000); await sleep(100); await grab('stage01_classic');
await push('r', 100); await idle(4000); await grab('stage02_classic');
await push('l', 100); await idle(4000);
await push('l', 100); await idle(4000);                       // TALL again
await push('u', 300);
await push('l', 100); await idle(4000);                       // stage 1 (wrap from 2? no: 2 -> 1)
console.log('  settings', JSON.stringify(await sb2('s._set')));

await sb2('(s._set.wins = 2, 1)');                       // a short match for the QA
if (process.argv.includes('--classic')) await sb2(`(s._set.layout = 'classic', 1)`);
console.log('6. START -> match');
await tap('A', 600); await grab('stage_go');
if (!await waitFor(`window.__SB2.screen === 'match'`, 12000)) throw new Error('match did not start');
await sleep(1200);
await grab('match_start');
await shot('match_start');
// --fast: the three CPUs are flagged dying after a few seconds (round over, P1 wins)
const killCpus = () => sb2(`(() => { const g = s._game(); if (!g) return 0; const m = g.mem; for (let i = 1; i < 4; i++) m[0x8000 + 0x100 * i + 1] |= 0x08; return 1; })()`);
await pad.dir('y', 'd'); await sleep(300); await pad.dir('y', 'c');
await pad.tap('A'); await pad.dir('x', 'r'); await sleep(350); await pad.dir('x', 'c');
await sleep(2500);
await grab('match_play');
const p0 = await sb2('({ ticks: s.perf.ticks, lag: s.perf.lagFrames })');
await sleep(5000);
const p1 = await sb2('({ ticks: s.perf.ticks, lag: s.perf.lagFrames })');
if (FAST) await killCpus();
console.log('  5 s of play:', p1.ticks - p0.ticks, 'ticks,', p1.lag - p0.lag, 'lag frames');

console.log('7. rounds -> results -> menus');
let rounds = 0, sawResults = false;
for (let k = 0; k < 200; k++) {
  const scr = await sb2('s.screen');
  if (scr === 'results') {
    if (!sawResults || rounds < 3) { await sleep(700); await grab(`results_${++rounds}`); }
    sawResults = true;
    await sleep(800); await tap('A', 600);
    if (FAST) { for (let w = 0; w < 30 && (await sb2('s.screen')) !== 'match'; w++) await sleep(300); await sleep(4000); await killCpus(); }
    continue;
  }
  if (scr === 'menu:mode') break;
  await sleep(500);
}
await idle(); await sleep(300);
await grab('after_match_mode');
console.log('  results seen:', sawResults, 'rounds', rounds);

console.log('8. Select+Start -> shelf');
await pad.down('SELECT'); await sleep(60); await pad.tap('START'); await pad.up('SELECT');
await sleep(1500);
console.log('  shelf:', await ev(`!document.querySelector('.sb2')`));
console.log('errors:', errs.length ? errs : 'none');
process.exit(0);
