// The Gardener™ — SN30 Pro controller bridge.
// Reads the kernel joystick API (/dev/input/js0 — world-readable, no sudo) and
// forwards mapped actions to the localhost server, which fans them out to the
// kiosk page over SSE (/api/pad/stream). Survives the controller sleeping:
// retries the device every few seconds and logs raw events to data/pad.log so
// the button mapping can be corrected empirically.
import { createReadStream, appendFileSync } from 'node:fs';
import { config, paths } from './config.mjs';

const DEV = process.env.GARDENER_PAD_DEV || '/dev/input/js0';
const API = `http://${config.host}:${config.port}/api/pad/action`;

function log(msg) {
  const line = `[${new Date().toISOString()}] [pad] ${msg}\n`;
  try { appendFileSync(`${paths.DATA}/pad.log`, line); } catch { /* ignore */ }
  console.log(line.trim());
}

// ---- button/axis mapping (8BitDo SN30 Pro, Bluetooth d-input) ---------------
// js-API event: { value:int16, type: 1=button 2=axis (|0x80 init), number }
// Override via .env GARDENER_PAD_MAP='{"buttons":{"7":"palette",...}}' if a
// firmware variant numbers differently — raw presses are logged to pad.log.
// Mapping verified EMPIRICALLY from this controller's pad.log (8BitDo "gap"
// layout: face = 0,1,3,4 with 2/5 unused; shoulders 6-9; Select/Start 10/11).
const DEFAULT_MAP = {
  buttons: {
    0: 'ok',        // A — run selected (selection only)
    1: 'events',    // B — SF events panel
    3: 'palette',   // X — palette shortcut
    4: 'hn',        // Y — Hacker News panel
    6: 'pageup',    // L1
    7: 'pagedown',  // R1
    8: 'back',      // L2 — back / Esc
    10: 'changelog',// Select
    11: 'help',     // Start
  },
  // Tap-vs-hold buttons: 9 = R2 (tap → palette, hold ≥600ms → controller map).
  holds: { 9: { tap: 'palette', hold: 'padmap', ms: 600 } },
  // Axes: 0/1 left stick, 6/7 d-pad hat. DO NOT add 4/5 — those are the analog
  // trigger channels and REST at -32767, which reads as a permanently-held
  // direction (the "drift" we debugged). 2/3 (right stick) left unmapped.
  vert: [1, 7],
  horiz: [0, 6],
};
let MAP = DEFAULT_MAP;
try { if (process.env.GARDENER_PAD_MAP) MAP = { ...DEFAULT_MAP, ...JSON.parse(process.env.GARDENER_PAD_MAP) }; }
catch { log('bad GARDENER_PAD_MAP — using defaults'); }

const THRESH = 18000; // stick deflection that counts as a press
const REPEAT_MS = 190; // held-stick repeat for scrolling

async function send(action) {
  try {
    await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }), signal: AbortSignal.timeout(1500),
    });
  } catch { /* server briefly down — drop the press */ }
}

// Held-direction auto-repeat (for scrolling lists with the stick).
const held = new Map(); // axisKey -> interval
function setHeld(key, dir) {
  const cur = held.get(key);
  if (cur && cur.dir === dir) return;
  if (cur) clearInterval(cur.t);
  held.delete(key);
  if (!dir) return;
  send(dir);
  const t = setInterval(() => send(dir), REPEAT_MS);
  held.set(key, { dir, t });
}

let rawLogged = 0;
const holdTimers = new Map(); // button number -> {t, fired}
function onEvent(value, type, number) {
  const t = type & 0x7f, init = !!(type & 0x80);
  if (init) return; // synthetic state dump on connect
  if (rawLogged < 300) { rawLogged++; log(`raw ${t === 1 ? 'button' : 'axis'} #${number} = ${value}`); }
  if (t === 1) { // button: value 1=down 0=up
    const hold = (MAP.holds || {})[number];
    if (hold) { // tap-vs-hold: decide on release (or when the hold timer fires)
      if (value === 1) {
        const st = { fired: false };
        st.t = setTimeout(() => { st.fired = true; send(hold.hold); }, hold.ms || 600);
        holdTimers.set(number, st);
      } else {
        const st = holdTimers.get(number);
        holdTimers.delete(number);
        if (st) { clearTimeout(st.t); if (!st.fired) send(hold.tap); }
      }
      return;
    }
    if (value !== 1) return; // plain buttons act on press
    const action = MAP.buttons[number];
    if (action && action !== 'noop') send(action);
  } else if (t === 2) { // axis
    if (MAP.vert.includes(number)) setHeld('v' + number, value <= -THRESH ? 'up' : value >= THRESH ? 'down' : null);
    else if (MAP.horiz.includes(number)) setHeld('h' + number, value <= -THRESH ? 'left' : value >= THRESH ? 'right' : null);
  }
}

function attach() {
  const s = createReadStream(DEV, { highWaterMark: 512 });
  let buf = Buffer.alloc(0);
  s.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) { // struct js_event: u32 time, s16 value, u8 type, u8 number
      onEvent(buf.readInt16LE(4), buf.readUInt8(6), buf.readUInt8(7));
      buf = buf.subarray(8);
    }
  });
  const retry = (why) => {
    for (const v of held.values()) clearInterval(v.t);
    held.clear();
    log(`${why} — retrying in 3s (controller asleep/unpaired?)`);
    setTimeout(attach, 3000);
  };
  s.on('error', (e) => retry(`device error: ${e.code || e.message}`));
  s.on('end', () => retry('device closed'));
  s.on('open', () => log(`listening on ${DEV}`));
}

log('SN30 Pro bridge starting');
attach();
