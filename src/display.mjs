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
import { existsSync, appendFileSync } from 'node:fs';
import { config, paths, isNightNow, isEveningNow } from './config.mjs';
import { setNight } from './db.mjs';

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

export function goNight() {
  setNight(true); // layer 1 — always works (frontend overlay)
  run('xset', ['s', 'off']); // no screensaver interference
  run('xrandr', ['--output', config.output, '--brightness', '0']); // layer 3
  run('xset', ['dpms', 'force', 'off']); // layer 2 — real power-down
  log('night: overlay on, brightness 0, DPMS off');
}

export function goDay() {
  setNight(false);
  run('xrandr', ['--output', config.output, '--brightness', '1']);
  run('xset', ['s', 'off']);
  run('xset', ['dpms', 'force', 'on']);
  log('day: overlay off, brightness 1, DPMS on');
}

// Evening wind-down: screen stays ON and awake, but dimmed to ~50% (no overlay).
// Bookends the day cycle — full at 7AM, half at 9PM, off at midnight.
export function goEvening() {
  setNight(false);
  const b = String(config.eveningBrightness);
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

const mode = process.argv[2];
if (mode === 'night') goNight();
else if (mode === 'day') goDay();
else if (mode === 'evening' || mode === 'dim') goEvening();
else if (mode === 'sync') sync();
else { console.error('usage: node src/display.mjs day|night|evening|sync'); process.exit(2); }
