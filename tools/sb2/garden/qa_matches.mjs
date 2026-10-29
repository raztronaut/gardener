#!/usr/bin/env node
// Garden Edition QA: whole matches in the browser on every tall garden (a TEST wall server
// + your own headless Chromium; never the live kiosk). P1 = the pad (wanders and drops pods),
// the three ★ CPUs fight; the clock is poked so hurry and sudden death come inside the run.
// Per stage: a screenshot mid-round and in sudden death, the results, the frame costs.
//
//   GARDENER_PORT=8791 GARDENER_FRACTAL=0 GARDENER_NO_RECOVER=1 node src/server.mjs &
//   /snap/bin/chromium --headless=new --remote-debugging-port=9351 \
//     --user-data-dir=$PWD/data/sb2-garden-qa-profile --autoplay-policy=no-user-gesture-required \
//     --mute-audio "http://127.0.0.1:8791/?dash=arcade" &
//   node tools/sb2/garden/qa_matches.mjs [--cdp 9351] [--port 8791] [--stages 1,2,...] [--skin garden]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep } from '../qa/cdp.mjs';
import { padSender } from '../qa/pad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9351), PORT = +arg('port', 8791), SKIN = arg('skin', 'garden');
const STAGES = arg('stages', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
if (CDP === 9223 || PORT === 8787) { console.error('refusing to drive the live kiosk'); process.exit(2); }
const OUT = path.join(ROOT, 'data', 'sb2', 'garden', 'qa_' + SKIN);
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
async function grab(name) {
  const url = await ev(`(() => { const cv = document.querySelector('.sb2-scr.on canvas'); return cv ? cv.toDataURL('image/png') : null; })()`);
  if (!url) return;
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
}

// boot from the shelf with fresh settings (skin, 1 win per match for the QA)
await ev(`localStorage.setItem('garden.sb2.menu', JSON.stringify({ skin: '${SKIN}', wins: 1, v: 2 }))`);
await c.send('Page.reload');
await waitFor(`!!document.querySelector('.ax-tile')`, 15000);
await sleep(1500);
await pad.post('ok');
if (!await waitFor(`!!(window.__SB2 && window.__SB2.screen === 'menu:title' && document.querySelector('.sb2.ready'))`, 30000)) throw new Error('title did not appear');
await sleep(800);
await grab('00_title');
await pad.tap('A'); await sleep(400);
await waitFor(`window.__SB2.screen === 'menu:mode'`, 8000); await idle();

const report = [];
for (const st of STAGES) {
  // SINGLE MATCH -> players -> rules -> stage select, the stage set, START
  for (let w = 0; w < 12 && (await sb2('s.screen')) !== 'menu:stage'; w++) { await idle(); await pad.tap('A'); await sleep(450); }
  await idle(5000);
  await sb2(`(s._set.stage = ${st}, s._set.layout = 'tall', s._set.skin = '${SKIN}', 1)`);
  await sleep(200);
  await pad.tap('A');
  if (!await waitFor(`window.__SB2.screen === 'match'`, 15000)) { report.push({ stage: st, error: 'no match' }); continue; }
  await sleep(500);
  await sb2(`(() => { const g = s._game(); g.mem[0x5E10] = 0; g.mem[0x5E11] = 0; g.mem[0x5E12] = 48; g.mem[0x5E13] = 0; return 1; })()`);
  const p0 = await sb2('({ t: s.perf.ticks, tm: s.perf.tickMs, f: s.perf.frames, dm: s.perf.drawMs, lag: s.perf.lagFrames })');
  // P1 wanders and drops pods
  const moves = ['r', 'd', 'l', 'u'];
  let k = 0, shotPlay = false, shotSD = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const scr = await sb2('s.screen');
    if (scr !== 'match') break;
    const ax = moves[k % 4] === 'l' || moves[k % 4] === 'r' ? 'x' : 'y';
    await pad.dir(ax, moves[k % 4]); await sleep(260); await pad.dir(ax, 'c');
    if (k % 3 === 0) await pad.tap('A', 60);
    k++;
    const tk = await sb2('s.state ? s.state.tick : 0');
    if (!shotPlay && tk > 240) { await grab(`s${String(st).padStart(2, '0')}_play`); shotPlay = true; }
    if (!shotSD && await sb2('s.state && s.state.suddenDeath')) { await sleep(1500); await grab(`s${String(st).padStart(2, '0')}_sudden`); shotSD = true; }
  }
  const p1 = await sb2('({ t: s.perf.ticks, tm: s.perf.tickMs, f: s.perf.frames, dm: s.perf.drawMs, lag: s.perf.lagFrames })');
  // results -> back to the menus
  await waitFor(`window.__SB2.screen === 'results'`, 30000);
  await sleep(900);
  await grab(`s${String(st).padStart(2, '0')}_results`);
  for (let w = 0; w < 40 && (await sb2('s.screen')) !== 'menu:mode'; w++) { await pad.tap('A'); await sleep(700); }
  await idle();
  const r = { stage: st, ticks: p1.t - p0.t, msPerTick: +((p1.tm - p0.tm) / Math.max(1, p1.t - p0.t)).toFixed(3),
    msPerDraw: +((p1.dm - p0.dm) / Math.max(1, p1.f - p0.f)).toFixed(3), lagFrames: p1.lag - p0.lag, play: shotPlay, sudden: shotSD };
  report.push(r);
  console.log(JSON.stringify(r));
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ report, errors: errs }, null, 1));
console.log('errors:', errs.length ? errs : 'none');
process.exit(0);
