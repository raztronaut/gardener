// The Gardener™ — SN30 Pro controller bridge.
// Reads the kernel joystick API (/dev/input/js0 — world-readable, no sudo) and
// forwards mapped actions to the localhost server, which fans them out to the
// kiosk page over SSE (/api/pad/stream). Survives the controller sleeping:
// retries the device every few seconds and logs raw events to data/pad.log so
// the button mapping can be corrected empirically.
import { createReadStream, appendFileSync } from 'node:fs';
import { config, paths } from './config.mjs';

// (player 1's device is found by name — see p1Dev(); GARDENER_PAD_DEV overrides)
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
    12: 'arcadetoggle', // the heart (Home) button: open / close the Arcade, from anywhere
    13: 'fopen', 14: 'fopen', // stick clicks (L3/R3) → open focused widget
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
// Volume chord: hold R2 + L1 (only those two) and push the RIGHT stick up / down →
// system volume (pactl, like the MX thumb wheel). While the chord is held the stick
// never moves the widget focus, R2's map peek is closed and L1 doesn't zoom.
const VOL_REPEAT_MS = 90;
const volChord = () => shoulders.size === 2 && shoulders.has(6) && shoulders.has(9);
let volHold = null;
function setVolHold(dir) {
  if (volHold && volHold.dir === dir) return;
  if (volHold) clearInterval(volHold.t);
  volHold = null;
  if (!dir) return;
  volumeStep(dir);
  volHold = { dir, t: setInterval(() => volumeStep(dir), VOL_REPEAT_MS) };
}
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
      if (value === 1) {
        const l1First = shoulders.size === 1 && shoulders.has(6) && number === 9;
        shoulders.add(number); comboMax.add(number);
        if (volChord()) {                          // R2 + L1 just closed: the volume chord
          if (l1First) send('zoomin');             // undo the zoom-out L1 made on its own
          else send('padmapend');                  // close the map R2 peeked
          send('volshow');
          return;
        }
      } else {
        if (volChord()) setVolHold(null);
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
    if ((MAP.rvert || []).includes(number) && volChord()) { setVolHold(value <= -THRESH ? +1 : value >= THRESH ? -1 : null); return; }
    if ((MAP.rhoriz || []).includes(number) && volChord()) return;
    if (MAP.vert.includes(number)) setHeld('v' + number, value <= -THRESH ? 'up' : value >= THRESH ? 'down' : null);
    else if (MAP.horiz.includes(number)) setHeld('h' + number, value <= -THRESH ? 'left' : value >= THRESH ? 'right' : null);
    else if ((MAP.rvert || []).includes(number)) setHeld('rv' + number, value <= -THRESH ? 'fup' : value >= THRESH ? 'fdown' : null);
    else if ((MAP.rhoriz || []).includes(number)) setHeld('rh' + number, value <= -THRESH ? 'fleft' : value >= THRESH ? 'fright' : null);
  }
}

// Which /dev/input/js* is which pad, by name (the numbers shuffle as pads come and go):
// the SN30 Pro is player 1 (the wall + games); an Xbox controller is player 2 (games only).
import { readdirSync as lsDir, readFileSync as readF } from 'node:fs';
function jsByName(re) {
  try {
    for (const n of lsDir('/sys/class/input').filter((x) => /^js\d+$/.test(x)).sort()) {
      const name = readF(`/sys/class/input/${n}/device/name`, 'utf8').trim();
      if (re.test(name)) return `/dev/input/${n}`;
    }
  } catch { /* none */ }
  return null;
}
const P2_RE = /xbox|x-box|microsoft/i;
const p1Dev = () => process.env.GARDENER_PAD_DEV || jsByName(/8bitdo|sn30|sf30/i) || (() => { const d = jsByName(/./); return d && d !== jsByName(P2_RE) ? d : null; })();

let padAway = false;
function attach() {
  const DEV = p1Dev();
  if (!DEV) { if (!padAway) log('controller away — retrying every 3s quietly until it\'s back'); padAway = true; setTimeout(attach, 3000); return; }
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
    // log once when the controller goes away, then retry quietly (every 3 s while it
    // sleeps was ~29k syslog lines a day)
    if (!padAway) log(`${why} — retrying every 3s quietly until it's back (controller asleep/unpaired?)`);
    padAway = true;
    setTimeout(attach, 3000);
  };
  s.on('error', (e) => retry(`device error: ${e.code || e.message}`));
  s.on('end', () => retry('device closed'));
  s.on('open', () => { log(`listening on ${DEV}${padAway ? ' (controller back)' : ''}`); padAway = false; });
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
      else if (m && (m[1] === '6' || m[1] === '7')) volumeStep(m[1] === '6' ? +1 : -1); // thumb wheel: towards the palm (6) = louder
    }
  });
  p.on('exit', () => { log('mouse: xinput exited — retrying in 5s'); setTimeout(attachMouse, 5000); });
}

// MX Master 3 thumb wheel (horizontal scroll = X buttons 6 left / 7 right) → system
// volume, 2 % per notch, 0–100 %. Notches are coalesced so a fast swipe is one pactl call
// per ~60 ms; the wall is told after each change ('volup'/'voldown' → it shows the level).
let volPending = 0, volBusy = false;
function volumeStep(dir) {
  volPending += dir;
  if (volBusy) return;
  volBusy = true;
  setTimeout(() => {
    const n = volPending; volPending = 0;
    const env = { ...process.env };
    let cur = 50;
    try { cur = parseInt(/(\d+)%/.exec(execFileSync('pactl', ['get-sink-volume', '@DEFAULT_SINK@'], { env, timeout: 3000 }).toString())[1], 10); } catch { /* keep 50 */ }
    const next = Math.max(0, Math.min(100, cur + n * 2));
    try { execFileSync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${next}%`], { env, timeout: 3000 }); } catch (e) { log(`volume: ${e.message}`); }
    send(n > 0 ? 'volup' : 'voldown');
    volBusy = false;
    if (volPending) volumeStep(0);
  }, 60);
}

// MX Master 3 square button (under the wheel) = push-to-talk for "Hey Garden": hold to talk,
// release to send (src/hidpp.mjs diverts it from the mouse; src/voice.mjs /ptt)
const VOICE_URL = `http://127.0.0.1:${process.env.GARDENER_VOICE_PORT || 8797}/ptt`;
const ptt = (down) => fetch(VOICE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ down }), signal: AbortSignal.timeout(1500) }).catch(() => {});
import('./hidpp.mjs').then(({ divertButton }) => {
  const start = () => { if (!divertButton({ cid: 0x00c4, onDown: () => ptt(true), onUp: () => ptt(false), log })) setTimeout(start, 60000); };
  start();
}).catch((e) => log(`hid++: ${e.message}`));

// ---- player 2: an Xbox controller → games only ----------------------------------------
// Its edges go out as 'qb<idx><d|u>' / 'qx…' / 'qy…' (P1's are 'jb…'), with the face
// buttons mapped by POSITION onto the SN30 numbering the games already use (Xbox A, the
// bottom button = SNES B …). 'ptwoon' / 'ptwooff' tell the wall when it comes and goes.
const P2_FACE = { 0: 1, 1: 0, 3: 4, 4: 3 }; // Xbox bottom/right/left/top → SN30 B/A/Y/X
let p2Logged = 0, p2On = false;
const p2Axis = {};
function onEventP2(value, type, number) {
  const t = type & 0x7f; if (type & 0x80) return;
  if (p2Logged < 120) { p2Logged++; log(`p2 raw ${t === 1 ? 'button' : 'axis'} #${number} = ${value}`); }
  if (t === 1 && number < 16) { const i = P2_FACE[number] ?? number; send(`qb${String.fromCharCode(97 + i)}${value === 1 ? 'd' : 'u'}`); return; }
  if (t === 2 && (MAP.vert.includes(number) || MAP.horiz.includes(number))) {
    const isY = MAP.vert.includes(number);
    const st = value <= -THRESH ? (isY ? 'u' : 'l') : value >= THRESH ? (isY ? 'd' : 'r') : 'c';
    const key = `${isY ? 'y' : 'x'}${number}`;
    if (p2Axis[key] !== st) { p2Axis[key] = st; send(`q${isY ? 'y' : 'x'}${st}`); }
  }
}
function attachP2() {
  const dev = jsByName(P2_RE);
  if (!dev) { if (p2On) { p2On = false; send('ptwooff'); log('player 2 controller gone'); } setTimeout(attachP2, 3000); return; }
  const s = createReadStream(dev, { highWaterMark: 512 });
  let buf = Buffer.alloc(0);
  s.on('open', () => { p2On = true; send('ptwoon'); log(`player 2 (Xbox) on ${dev}`); });
  s.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) { onEventP2(buf.readInt16LE(4), buf.readUInt8(6), buf.readUInt8(7)); buf = buf.subarray(8); }
  });
  const again = () => { if (p2On) { p2On = false; send('ptwooff'); log('player 2 controller gone'); } setTimeout(attachP2, 3000); };
  s.on('error', again); s.on('end', again);
}
setInterval(() => { if (p2On) send('ptwoon'); }, 30000); // (a reloaded wall learns it again)

log('SN30 Pro bridge starting');
attach();
attachP2();
attachMouse();
