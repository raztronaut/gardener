#!/usr/bin/env node
// Frame pacing in the browser: plays tall gardens (P1 wanders and drops bombs, 3 ★ CPUs,
// the clock poked so hurry and sudden death come inside the run) on a TEST wall server +
// your own headless Chromium (never the live kiosk) and reports, per stage and pacing mode:
//   raf   requestAnimationFrame deltas (the browser's own frame regularity)
//   gap   intervals between pictures (a picture held for 2+ frames = a visible hitch)
//   work  JS time per display frame (tick + draw)
//   long  long tasks (> 50 ms, PerformanceObserver) during the match
//
//   node tools/sb2/qa/smoothness.mjs [--cdp 9351] [--port 8791] [--stages 1,3,4,8]
//        [--pacing smooth|faithful] [--skin garden] [--secs 75]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep } from './cdp.mjs';
import { padSender } from './pad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9351), PORT = +arg('port', 8791), SKIN = arg('skin', 'garden'), PACING = arg('pacing', 'smooth');
const STAGES = arg('stages', '1,3,4,8').split(',').map(Number), SECS = +arg('secs', 75);
if (CDP === 9223 || PORT === 8787) { console.error('refusing to drive the live kiosk'); process.exit(2); }

const c = await connect(CDP, String(PORT));
const pad = padSender(PORT);
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1600, deviceScaleFactor: 1, mobile: false });
const ev = (e) => c.evaluate(e);
const sb2 = (e) => ev(`(() => { const s = window.__SB2; return s ? (${e}) : null; })()`);
const waitFor = async (expr, ms, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); } return false; };
const idle = (ms = 8000) => waitFor(`window.__SB2 && !window.__SB2._menu.busy`, ms);
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const FR = 1000 / 60;

const results = [];
for (const st of STAGES) {
  // a fresh page per stage (the stage select is set through the settings)
  await ev(`localStorage.setItem('garden.sb2.menu', JSON.stringify({ skin: '${SKIN}', wins: 1, stage: ${st}, layout: 'tall', pacing: '${PACING}', v: 2 }))`);
  await c.send('Page.reload');
  await waitFor(`!!document.querySelector('.ax-tile')`, 15000);
  await sleep(1500);
  await pad.post('ok');
  if (!await waitFor(`!!(window.__SB2 && window.__SB2.screen === 'menu:title' && document.querySelector('.sb2.ready'))`, 30000)) throw new Error('title did not appear');
  await ev(`(() => { window.__LONG = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LONG.push([e.startTime, e.duration]); }).observe({ type: 'longtask' }); } catch (e) {} return 1; })()`);
  await sleep(2500);                              // (the menus' idle warm-up runs here)
  await pad.tap('A'); await sleep(400);
  await waitFor(`window.__SB2.screen === 'menu:mode'`, 8000); await idle();
  const setStage = () => sb2(`(s._set.stage = ${st}, s._set.layout = 'tall', s._set.skin = '${SKIN}', s._set.pacing = '${PACING}', 1)`);
  for (let w = 0; w < 12 && (await sb2('s.screen')) !== 'menu:stage'; w++) { await setStage(); await idle(); await pad.tap('A'); await sleep(450); }
  await idle(5000); await setStage(); await sleep(200);
  const tStart = await ev('performance.now()');
  await pad.tap('A');
  if (!await waitFor(`window.__SB2.screen === 'match'`, 15000)) { results.push({ stage: st, error: 'no match' }); continue; }
  await sleep(300);
  const played = await sb2('s.state ? s.state.stage : null');
  await sb2(`(() => { const g = s._game(); g.mem[0x5E10] = 1; g.mem[0x5E11] = 0; g.mem[0x5E12] = 10; g.mem[0x5E13] = 0; s.perf.resetHist(); return 1; })()`);
  const p0 = await sb2('({ t: s.perf.ticks, l: s.perf.lagFrames })');
  const t0 = await ev('performance.now()');
  const moves = ['r', 'd', 'l', 'u'];
  let k = 0;
  const tw = Date.now();
  while (Date.now() - tw < SECS * 1000) {
    if ((await sb2('s.screen')) !== 'match') break;
    const ax = moves[k % 4] === 'l' || moves[k % 4] === 'r' ? 'x' : 'y';
    await pad.dir(ax, moves[k % 4]); await sleep(260); await pad.dir(ax, 'c');
    if (k % 3 === 0) await pad.tap('A', 60);
    k++;
  }
  const t1 = await ev('performance.now()');
  const H = await sb2(`(() => { const h = s.perf.hist, N = h.raf.length; const take = (a, n) => Array.from(a.subarray(0, Math.min(n, N))); return { raf: take(h.raf, h.nRaf), gap: take(h.gap, h.nGap), work: take(h.work, h.nWork), n: [h.nRaf, h.nGap, h.nWork], sd: !!(s.state && s.state.suddenDeath), t: s.perf.ticks, l: s.perf.lagFrames }; })()`);
  const long = (await ev('window.__LONG')) || [];
  const startLong = long.filter(([ts]) => ts >= tStart && ts < t0);
  const playLong = long.filter(([ts]) => ts >= t0 && ts <= t1);
  const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { p50: +pct(s, 0.5).toFixed(2), p95: +pct(s, 0.95).toFixed(2), p99: +pct(s, 0.99).toFixed(2), max: +(s[s.length - 1] || 0).toFixed(2) }; };
  const gapF = H.gap.map((g) => Math.round(g / FR));
  const held = (n) => gapF.filter((f) => f >= n).length;
  const secs = (t1 - t0) / 1000;
  const r = { stage: st, played, pacing: PACING, secs: +secs.toFixed(1), ticksPerSec: +((H.t - p0.t) / secs).toFixed(2),
    skipped: H.l - p0.l, suddenDeath: H.sd, raf: stat(H.raf), gap: stat(H.gap), work: stat(H.work),
    gapHeld2: held(2), gapHeld3: held(3), gapMaxFrames: Math.max(0, ...gapF),
    longTasksPlay: playLong.length, longTaskMaxPlay: +Math.max(0, ...playLong.map((x) => x[1])).toFixed(1),
    longTasksStart: startLong.length, longTaskMaxStart: +Math.max(0, ...startLong.map((x) => x[1])).toFixed(1) };
  results.push(r);
  console.log(JSON.stringify(r));
  // back to the menus
  await sb2(`(() => { const g = s._game(); g.mem[0x5E10] = 0; g.mem[0x5E12] = 1; return 1; })()`);
}
const out = path.join(ROOT, 'data', 'sb2', 'qa', `smooth_${PACING}_${SKIN}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 1));
c.close();
process.exit(0);
