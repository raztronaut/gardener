#!/usr/bin/env node
// Screenshot a running match on several stages (test wall server + own headless browser,
// see match.mjs): picker -> stage -> A -> wait -> shot -> Select+Start back to the picker.
//   node tools/sb2/qa/stages.mjs [--layout tall|original] [--stages 1,2,5,7,10] [--wait 7000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep } from './cdp.mjs';
import { padSender } from './pad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'data', 'sb2', 'qa');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const LAYOUT = arg('layout', 'tall'), STAGES = arg('stages', '1,2,5,7,10').split(',').map(Number), WAIT = +arg('wait', 7000);
const CDP = +arg('cdp', 9340), PORT = +arg('port', 8791);
if (CDP === 9223 || PORT === 8787) { console.error('refusing to drive the live kiosk'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const c = await connect(CDP, String(PORT));
const pad = padSender(PORT);
const errs = [];
c.on((m) => { if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); });
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1600, deviceScaleFactor: 1, mobile: false });
const ev = (e) => c.evaluate(e);
const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(200); } return false; };
await c.send('Page.reload');
await waitFor(`!!document.querySelector('.ax-tile')`, 15000);
await sleep(1000);
await pad.post('ok');
await waitFor(`!!(window.__SB2 && window.__SB2.screen === 'picker')`, 20000);
await sleep(800);
for (const st of STAGES) {
  // grid focus: left/right walk the stages; down x1 = arena row
  for (let k = 0; k < 12 && (await ev('window.__SB2._set.stage')) !== st; k++) { await pad.push('r', 60); await sleep(90); }
  if ((await ev('window.__SB2._set.layout')) !== LAYOUT) { await pad.push('d', 60); await sleep(90); await pad.push('r', 60); await sleep(90); await pad.push('u', 60); await sleep(90); }
  await pad.tap('A');
  await waitFor(`window.__SB2.screen === 'match'`, 8000);
  await sleep(WAIT);
  const f = path.join(OUT, `${LAYOUT}_stage${String(st).padStart(2, '0')}_running.png`);
  await c.screenshot(f);
  console.log('shot', f, await ev('JSON.stringify(window.__SB2.state.clock)'));
  await pad.down('SELECT'); await pad.down('START'); await sleep(80); await pad.up('START'); await pad.up('SELECT');
  await waitFor(`window.__SB2.screen === 'picker'`, 5000);
  await sleep(700);
}
console.log('errors:', errs.length ? errs : 'none');
c.close();
