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
    8: 'back',      // L2 — back / Esc
    10: 'changelog',// Select
    11: 'help',     // Start
    12: 'fopen', 13: 'fopen', 14: 'fopen', // stick clicks (L3/R3 vary by firmware) → open focused widget
  },
  // Hold-to-peek buttons: action fires the INSTANT the button goes down, and the
  // end action on release. 9 = R2: hold to peek the controller map.
  peeks: { 9: { down: 'padmap', up: 'padmapend' } },
  // Zoom chord pair: L1(6) = zoom out, R1(7) = zoom in, BOTH together = 100%.
  zoomPair: { 6: 'zoomout', 7: 'zoomin' },
  // Axes: 0/1 left stick, 6/7 d-pad hat, 2/3 RIGHT stick (widget focus).
  // DO NOT add 4/5 — those are the analog trigger channels and REST at -32767,
  // which reads as a permanently-held direction (the "drift" we debugged).
  vert: [1, 7],
  horiz: [0, 6],
  rvert: [3],   // right stick → widget-focus navigation
  rhoriz: [2],
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
const rawAxis = {}; // last raw direction per axis (only transitions are sent)
const zoomDown = new Set(); // which of the zoom-pair buttons are currently held
// Dashboard combos: hold 3+ shoulder buttons together; on release of the LAST one
// the full set held is sent as 'dash<code>' (L1=a R1=b L2=c R2=d, sorted), e.g.
// L1+R1+L2+R2 → 'dashabcd' (Arcade), L1+R1+L2 → 'dashabc'. The wall maps codes to
// dashboards (public/dashboards.json); the same combo toggles back to main.
const SHOULDERS = [6, 7, 8, 9];
const SH_CODE = { 6: 'a', 7: 'b', 8: 'c', 9: 'd' };
const shoulders = new Set();
let comboMax = new Set();
function onEvent(value, type, number) {
  const t = type & 0x7f, init = !!(type & 0x80);
  if (init) return; // synthetic state dump on connect
  if (rawLogged < 300) { rawLogged++; log(`raw ${t === 1 ? 'button' : 'axis'} #${number} = ${value}`); }
  // Raw edges for games (the Arcade): every button press/release → 'jb<idx a..p><d|u>',
  // every d-pad/stick direction change → 'jx<l|c|r>' / 'jy<u|c|d>'. The wall ignores
  // these unless a game is running; the normal actions below are sent as before.
  if (t === 1 && number < 16) send(`jb${String.fromCharCode(97 + number)}${value === 1 ? 'd' : 'u'}`);
  if (t === 2 && (MAP.vert.includes(number) || MAP.horiz.includes(number))) {
    const isY = MAP.vert.includes(number);
    const st = value <= -THRESH ? (isY ? 'u' : 'l') : value >= THRESH ? (isY ? 'd' : 'r') : 'c';
    const key = `${isY ? 'y' : 'x'}${number}`;
    if (rawAxis[key] !== st) { rawAxis[key] = st; send(`j${isY ? 'y' : 'x'}${st}`); }
  }
  if (t === 1) { // button: value 1=down 0=up
    if (SHOULDERS.includes(number)) {
      if (value === 1) { shoulders.add(number); comboMax.add(number); }
      else {
        shoulders.delete(number);
        if (!shoulders.size) {
          const set = comboMax; comboMax = new Set();
          if (set.size >= 3) { send('zoomreset').then(() => send('dash' + [...set].map((b) => SH_CODE[b]).sort().join(''))); return; }
          if (number === 8 && set.size === 1) { send('back'); return; } // L2 alone, on release
        }
      }
      if (number === 8) return;                    // L2 never acts on press (combo-safe)
      // R2 (map peek) is swallowed while a combo is being assembled
      if (number === 9 && comboMax.size >= 2) { if (value === 0) send('padmapend'); return; }
    }
    const peek = (MAP.peeks || {})[number];
    if (peek) { send(value === 1 ? peek.down : peek.up); return; } // both edges
    const zoom = (MAP.zoomPair || {})[number];
    if (zoom) { // L1/R1: chord (both down) = reset to 100%
      if (value === 1) {
        zoomDown.add(number);
        send(zoomDown.size >= 2 ? 'zoomreset' : zoom);
      } else zoomDown.delete(number);
      return;
    }
    if (value !== 1) return; // plain buttons act on press
    const action = MAP.buttons[number];
    if (action && action !== 'noop') send(action);
  } else if (t === 2) { // axis
    if (MAP.vert.includes(number)) setHeld('v' + number, value <= -THRESH ? 'up' : value >= THRESH ? 'down' : null);
    else if (MAP.horiz.includes(number)) setHeld('h' + number, value <= -THRESH ? 'left' : value >= THRESH ? 'right' : null);
    else if ((MAP.rvert || []).includes(number)) setHeld('rv' + number, value <= -THRESH ? 'fup' : value >= THRESH ? 'fdown' : null);
    else if ((MAP.rhoriz || []).includes(number)) setHeld('rh' + number, value <= -THRESH ? 'fleft' : value >= THRESH ? 'fright' : null);
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

// ---- MX Master 3 thumb buttons --------------------------------------------
// The kiosk browser swallows mouse buttons 8/9 (it treats them as history
// back/forward), so the page never sees them. Read them from X instead with
// `xinput test` on the Logitech receiver and forward them like pad actions:
// X button 9 (top / forward) → 'mxup', 8 (bottom / back) → 'mxdown'.
import { spawn as spawnProc, execFileSync } from 'node:child_process';
const MOUSE_NAME = process.env.GARDENER_MOUSE || 'Logitech USB Receiver Mouse';
function attachMouse() {
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || config.display };
  let id = '';
  try { id = execFileSync('xinput', ['list', '--id-only', MOUSE_NAME], { env, timeout: 5000 }).toString().trim(); } catch { /* not connected */ }
  if (!/^\d+$/.test(id)) { setTimeout(attachMouse, 15000); return; }
  log(`mouse: listening on "${MOUSE_NAME}" (xinput id ${id})`);
  const p = spawnProc('xinput', ['test', id], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      const m = /^button press\s+(\d+)/.exec(l.trim());
      if (m && m[1] === '9') send('mxup');
      else if (m && m[1] === '8') send('mxdown');
    }
  });
  p.on('exit', () => { log('mouse: xinput exited — retrying in 5s'); setTimeout(attachMouse, 5000); });
}

log('SN30 Pro bridge starting');
attach();
attachMouse();
