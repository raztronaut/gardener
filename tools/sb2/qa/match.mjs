#!/usr/bin/env node
// Headless end-to-end QA of Super Bomberman 2 · Tall on a TEST wall server.
//
//   GARDENER_PORT=8791 GARDENER_FRACTAL=0 GARDENER_NO_RECOVER=1 node src/server.mjs &
//   /snap/bin/chromium --headless=new --remote-debugging-port=9340 \
//     --user-data-dir=$PWD/data/sb2-qa-profile --autoplay-policy=no-user-gesture-required \
//     --mute-audio "http://127.0.0.1:8791/?dash=arcade" &
//   node tools/sb2/qa/match.mjs [--stage 3] [--layout tall|original] [--wins 2] [--fast]
//
// Drives the real pad path (POST /api/pad/action -> SSE -> app.js -> __GARDEN_GAME.raw),
// takes screenshots into data/sb2/qa/, and plays a whole match: P1 (the pad) runs and
// bombs a little, the CPUs fight. --fast pokes each round's clock to 1:00 (QA only) so
// hurry / sudden death / the round end come sooner. Never use the live kiosk (CDP 9223).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep } from './cdp.mjs';
import { padSender } from './pad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'data', 'sb2', 'qa');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const STAGE = +arg('stage', 3), LAYOUT = arg('layout', 'tall'), WINS = +arg('wins', 2);
const FAST = process.argv.includes('--fast');
const CDP = +arg('cdp', 9340), PORT = +arg('port', 8791), TAG = arg('tag', `${LAYOUT}_s${STAGE}`);
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
const shot = async (name) => { const f = path.join(OUT, `${TAG}_${name}.png`); await c.screenshot(f); console.log('  shot', f); return f; };
const ev = (e) => c.evaluate(e);
const sb2 = (e) => ev(`(() => { const s = window.__SB2; return s ? (${e}) : null; })()`);
const waitFor = async (expr, ms, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); } return false; };

console.log('1. shelf');
await c.send('Page.reload');
await waitFor(`!!document.querySelector('.ax-tile')`, 15000);
await sleep(1500);
await shot('01_shelf');

console.log('2. boot the port from the shelf (A on the first tile)');
await pad.post('ok');
if (!await waitFor(`!!(window.__SB2 && window.__SB2.screen === 'picker' && document.querySelector('.sb2.ready'))`, 20000)) throw new Error('picker did not appear');
await sleep(800);
// set stage / layout / wins with the d-pad: go to stage 1 first
const cur = await sb2('s._set');
for (let k = 0; k < 12 && (await sb2('s._set.stage')) !== STAGE; k++) { await pad.push('r', 60); await sleep(90); }
await pad.push('d', 60); await sleep(90);              // -> arena row
if ((await sb2('s._set.layout')) !== LAYOUT) { await pad.push('r', 60); await sleep(120); }
await pad.push('d', 60); await sleep(90);              // -> CPU level
await pad.push('d', 60); await sleep(90);              // -> wins
for (let k = 0; k < 6 && (await sb2('s._set.wins')) !== WINS; k++) { await pad.push((await sb2('s._set.wins')) < WINS ? 'r' : 'l', 60); await sleep(90); }
await sleep(400);
console.log('  settings', JSON.stringify(await sb2('s._set')), 'was', JSON.stringify(cur));
await shot('02_picker');

console.log('3. play');
await pad.tap('A');
if (!await waitFor(`window.__SB2 && window.__SB2.screen === 'match'`, 8000)) throw new Error('match did not start');
await sleep(1500);
await shot('03_match_start');
// P1: a short run + a bomb, then idle (the CPUs do the rest)
await pad.dir('y', 'd'); await sleep(300); await pad.dir('y', 'c');
await pad.tap('A'); await pad.dir('x', 'r'); await sleep(350); await pad.dir('x', 'c');
await pad.dir('y', 'd'); await sleep(250); await pad.dir('y', 'c');
await sleep(2500);
await shot('04_match_play');

console.log('4. pause on hidden page');
const t0 = await sb2('s.state.tick');
await ev(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))`);
await sleep(1000);
const t1 = await sb2('s.state.tick');
await ev(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
await sleep(700);
const t2 = await sb2('s.state.tick');
console.log(`  ticks: before ${t0}, after 1 s hidden ${t1}, 0.7 s visible again ${t2} -> ${t1 - t0 <= 1 && t2 > t1 ? 'paused OK' : 'NOT PAUSED'}`);

console.log('5. the match');
let rounds = 0, sawHurry = false, sawSD = false, sawTally = false, sawVictory = false;
const perf0 = await sb2('JSON.parse(JSON.stringify(s.perf))');
const tEnd = Date.now() + 30 * 60 * 1000;
let lastRoundTick = -1;
while (Date.now() < tEnd) {
  const st = await sb2(`(() => { const g = s.state; return { scr: s.screen, tick: g && g.tick, hurry: g && g.hurry, sd: g && g.suddenDeath, over: g && g.roundOver, clock: g && g.clock, wins: g && g.wins }; })()`);
  if (!st) throw new Error('port gone');
  if (st.scr === 'match' && FAST && st.tick != null && st.tick > 20 && st.tick < lastRoundTick) lastRoundTick = -1;
  if (st.scr === 'match' && FAST && st.tick > 20 && lastRoundTick < 0 && st.clock && st.clock.min > 0) {
    await sb2(`(() => { const m = s._game().mem; m[0x5E10] = 1; m[0x5E11] = 0; m[0x5E12] = 0; m[0x5E13] = 0; return 1; })()`);
    lastRoundTick = st.tick;
  }
  if (st.scr === 'match' && st.hurry && !sawHurry) { sawHurry = true; await sleep(1200); await shot(`05_hurry_r${rounds + 1}`); }
  if (st.scr === 'match' && st.sd && !sawSD) { sawSD = true; await sleep(6000); await shot(`06_sudden_death_r${rounds + 1}`); }
  if (st.scr === 'match' && st.over && !st._shotOver) { await shot(`07_round_over_r${rounds + 1}`); await waitFor(`!(window.__SB2 && window.__SB2.screen === 'match')`, 15000); }
  if (st.scr === 'tally') {
    rounds++;
    sawTally = true;
    await sleep(700);
    await shot(`08_tally_r${rounds}`);
    await waitFor(`window.__SB2 && window.__SB2.screen !== 'tally'`, 12000);
    sawHurry = false; sawSD = false; lastRoundTick = -1;
  }
  if (st.scr === 'victory') { sawVictory = true; await sleep(900); await shot('09_victory'); break; }
  await sleep(250);
}
const perf1 = await sb2('JSON.parse(JSON.stringify(s.perf))');
const dTicks = perf1.ticks - perf0.ticks, dFrames = perf1.frames - perf0.frames;
console.log(`  rounds ${rounds}, tally ${sawTally}, victory ${sawVictory}`);
console.log(`  browser perf: tick ${(perf1.tickMs - perf0.tickMs) / Math.max(1, dTicks)} ms/tick (core + display logic), draw ${(perf1.drawMs - perf0.drawMs) / Math.max(1, dFrames)} ms/frame (render + putImageData) over ${dTicks} ticks`);

console.log('6. back to the picker, then Select+Start / B to the shelf');
await waitFor(`window.__SB2 && window.__SB2.screen === 'picker'`, 20000);
await sleep(800);
await shot('10_picker_again');
await pad.tap('A');
await waitFor(`window.__SB2 && window.__SB2.screen === 'match'`, 8000);
await sleep(1500);
await pad.down('SELECT'); await pad.down('START'); await sleep(80); await pad.up('START'); await pad.up('SELECT');
const backToPicker = await waitFor(`window.__SB2 && window.__SB2.screen === 'picker'`, 4000);
console.log('  Select+Start in a match -> picker:', backToPicker);
await sleep(600);
await pad.tap('B');
const backToShelf = await waitFor(`!window.__SB2 && !!document.querySelector('.ax-tile') && !document.body.classList.contains('arcade-full')`, 5000);
console.log('  B in the picker -> Arcade shelf:', backToShelf);
await shot('11_shelf_again');
console.log('errors:', errs.length ? errs : 'none');
c.close();
