// The Gardener™ — display energy control (day / night / sync).
//   night : screen sleeps (DPMS off) + brightness 0 + opaque overlay flag → ~0 W
//   day   : screen wakes (DPMS on) + brightness 1 + overlay cleared
//   sync  : apply the correct state for the current Pacific-time hour (boot use)
//
// Three independent layers, so darkness is guaranteed even on hardware that
// ignores one of them:
//   1. DB `night` flag  → frontend paints a full-screen OPAQUE black overlay.
//   2. `xset dpms force off` → real panel power-down (the actual energy saving).
//   3. `xrandr --brightness 0` → gamma dim as extra insurance.
// The overlay (layer 1) needs no X access at all, so it always works.
import { execFileSync } from 'node:child_process';
import { existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths, isNightNow, isEveningNow, eveningLevel } from './config.mjs';
import { setNight, getSnoozeUntil, setSnoozeUntil } from './db.mjs';
import { pathToFileURL } from 'node:url';

function log(msg) {
  const line = `[${new Date().toISOString()}] [display] ${msg}\n`;
  try { appendFileSync(paths.ITERATE_LOG, line); } catch { /* ignore */ }
  console.log(line.trim());
}

function findXAuthority() {
  const cands = [
    process.env.GARDENER_XAUTHORITY, process.env.XAUTHORITY,
    `/run/user/${process.getuid?.() ?? 1000}/gdm/Xauthority`,
    `${process.env.HOME}/.Xauthority`,
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

function xenv() {
  const env = { ...process.env, DISPLAY: config.display };
  const xa = findXAuthority();
  if (xa) env.XAUTHORITY = xa;
  return env;
}

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { env: xenv(), stdio: ['ignore', 'ignore', 'pipe'], timeout: 8000 });
    return true;
  } catch (e) {
    log(`'${cmd} ${args.join(' ')}' failed: ${(e.stderr || e.message || '').toString().trim().slice(0, 160)}`);
    return false;
  }
}

// gnome-shell leaks on this kiosk (found at 5.2 GB RAM+swap after 77 days, swap
// 100% full → system-wide freezes, unplayable Arcade). While the screen is off,
// restart it in place if it's grown past 1.5 GB (X11: SIGHUP = restart, windows stay).
function trimShell() {
  try {
    const pid = execFileSync('pgrep', ['-x', 'gnome-shell']).toString().trim().split('\n')[0];
    if (!pid) return;
    const st = readFileSync(`/proc/${pid}/status`, 'utf8');
    const kb = (k) => parseInt((st.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1] || '0', 10);
    const mb = Math.round((kb('VmRSS') + kb('VmSwap')) / 1024);
    if (mb > 1500) { process.kill(Number(pid), 'SIGHUP'); log(`night: gnome-shell at ${mb} MB — restarted it`); }
  } catch (e) { log(`night: shell trim skipped: ${e.message}`); }
}

export function goNight() {
  if (getSnoozeUntil() > Date.now()) { goDay(); return; }
  setNight(true); // layer 1 — always works (frontend overlay)
  trimShell();
  run('xset', ['s', 'off']); // no screensaver interference
  run('xrandr', ['--output', config.output, '--brightness', '0']); // layer 3
  run('xset', ['dpms', 'force', 'off']); // layer 2 — real power-down
  log('night: overlay on, brightness 0, DPMS off');
}

// Night keeper (timer every 5 min, 00:00–06:55): X wakes the panel on ANY input event (a
// mouse twitch; the webcam / USB sound card also register as keyboards), so one stray
// event left the monitor on all night. If it's night, the panel is on and nobody has
// touched the mouse/keyboard for NIGHT_IDLE_MIN minutes → put it back to sleep.
const NIGHT_IDLE_MIN = 10;
export function nightKeep() {
  if (!isNightNow() || getSnoozeUntil() > Date.now()) return;
  let on = true, idleMs = 0;
  try { on = /Monitor is On/.test(execFileSync('xset', ['q'], { env: xenv(), timeout: 5000 }).toString()); } catch { /* assume on */ }
  if (!on) return;
  try { idleMs = parseInt(execFileSync(join(paths.ROOT, 'scripts', 'xidle.py'), { env: xenv(), timeout: 5000 }).toString(), 10) || 0; } catch { return; }
  if (idleMs < NIGHT_IDLE_MIN * 60000) { log(`nightkeep: panel on but in use (idle ${Math.round(idleMs / 1000)} s) — leaving it`); return; }
  log(`nightkeep: panel woke up (idle ${Math.round(idleMs / 60000)} min) — back to sleep`);
  goNight();
}

export function goDay() {
  setNight(false);
  run('xrandr', ['--output', config.output, '--brightness', '1']);
  run('xset', ['s', 'off']);
  run('xset', ['dpms', 'force', 'on']);
  log('day: overlay off, brightness 1, DPMS on');
}

// Evening wind-down: screen stays ON and awake, fading gradually (no overlay).
// Full at 7AM; from 8PM it steps down every 10 min (evening timer) to ~30% by
// 10PM, when night switches it off.
export function goEvening() {
  if (getSnoozeUntil() > Date.now()) { goDay(); return; }
  setNight(false);
  const b = String(eveningLevel());
  run('xrandr', ['--output', config.output, '--brightness', b]);
  run('xset', ['s', 'off']);
  run('xset', ['dpms', 'force', 'on']);
  log(`evening: overlay off, brightness ${b}, DPMS on`);
}

export function sync() {
  if (isNightNow()) { log('sync → night'); goNight(); }
  else if (isEveningNow()) { log('sync → evening'); goEvening(); }
  else { log('sync → day'); goDay(); }
}

export function snoozeDisplay(now = Date.now()) {
  const until = now + 60 * 60 * 1000;
  setSnoozeUntil(until);
  goDay();
  return until;
}

export function expireSnooze(now = Date.now()) {
  const until = getSnoozeUntil();
  if (!until || until > now) return false;
  setSnoozeUntil(0);
  sync();
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const mode = process.argv[2];
if (mode === 'night') goNight();
else if (mode === 'day') goDay();
else if (mode === 'evening' || mode === 'dim') goEvening();
else if (mode === 'nightkeep') nightKeep();
else if (mode === 'sync') sync();
else { console.error('usage: node src/display.mjs day|night|evening|sync'); process.exit(2); }

}
