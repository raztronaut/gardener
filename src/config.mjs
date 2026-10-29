// The Gardener™ — central configuration & paths.
// Loads .env (no external dependency) and exposes config + resolved paths.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');

function parseEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Load .env without clobbering values already present in the environment
// (lets smoke tests / callers override e.g. GARDENER_PORT, GARDENER_DATA).
const fileEnv = parseEnv(join(ROOT, '.env'));
for (const [k, v] of Object.entries(fileEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const E = process.env;
const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

export const config = {
  apiKey: E.ANTHROPIC_API_KEY || '',
  model: E.GARDENER_MODEL || 'claude-opus-5-5',
  // Reasoning effort for the model (low|medium|high|xhigh|max). Opus 5.5 supports
  // all levels; 'medium' balances quality against the daily tending's token cost.
  effort: E.GARDENER_EFFORT || 'medium',
  tz: E.GARDENER_TZ || 'America/Los_Angeles',
  lat: num(E.GARDENER_LAT, 37.7577),
  lon: num(E.GARDENER_LON, -122.4727),
  location: E.GARDENER_LOCATION || 'San Francisco, CA',
  // Public base URL (e.g. an ngrok tunnel) the QR-notes widget encodes so phones
  // can plant notes remotely. Empty → the widget falls back to the page origin.
  publicUrl: (E.GARDENER_PUBLIC_URL || '').replace(/\/+$/, ''),
  // Roots (household app): Google OAuth client id for optional Sign in with
  // Google. Empty (the default) = name-only login; everything degrades cleanly.
  googleClientId: E.GARDENER_GOOGLE_CLIENT_ID || '',
  port: num(E.GARDENER_PORT, 8787),
  host: E.GARDENER_HOST || '127.0.0.1',
  display: E.DISPLAY || ':0',
  output: E.GARDENER_OUTPUT || 'DP-0',
  width: num(E.GARDENER_WIDTH, 900),
  height: num(E.GARDENER_HEIGHT, 1600),
  chromium: E.GARDENER_CHROMIUM || '/snap/bin/chromium',
  // Night window (local PT hours): screen sleeps at NIGHT_START, wakes at DAY_START.
  nightStartHour: num(E.GARDENER_NIGHT_START, 0), // midnight (22:00 from 2026-09-28; back to midnight 2026-10-28)
  dayStartHour: num(E.GARDENER_DAY_START, 7), // 07:00
  // Evening wind-down: from EVENING_START the panel fades GRADUALLY from 100% to
  // EVENING_BRIGHTNESS, reaching it as NIGHT_START arrives (then it switches off).
  // 8PM → 10PM by default; the evening timer re-applies the level every 10 min.
  eveningStartHour: num(E.GARDENER_EVENING_START, 22), // 22:00 → fades to the floor by midnight
  eveningBrightness: num(E.GARDENER_EVENING_BRIGHTNESS, 0.3), // floor of the fade
  iterateHour: num(E.GARDENER_ITERATE_HOUR, 6), // 06:00
};

const DATA = E.GARDENER_DATA ? resolve(E.GARDENER_DATA) : join(ROOT, 'data');

export const paths = {
  ROOT,
  SRC: join(ROOT, 'src'),
  PUBLIC: join(ROOT, 'public'),
  WIDGETS: join(ROOT, 'public', 'widgets'),
  MANIFEST: join(ROOT, 'public', 'widgets', 'manifest.json'),
  PROXY_ALLOWLIST: join(ROOT, 'src', 'proxy-allowlist.json'),
  DATA,
  DB: join(DATA, 'gardener.db'),
  SCREENSHOTS: join(DATA, 'screenshots'),
  ITERATIONS: join(DATA, 'iterations'),
  // Roots (household app): uploaded profile photos live here, one file per user
  // (gitignored data dir; image bytes are NEVER stored in SQLite). Created below.
  AVATARS: join(DATA, 'avatars'),
  // Emulator widget: console ROMs the user drops in (gitignored — we never ship
  // ROMs). The Arcade widget lists these and EmulatorJS plays the selected one.
  ROMS: join(DATA, 'roms'),
  CHROME_PROFILE: join(DATA, '.chrome-profile'),
  SERVER_LOG: join(DATA, 'server.log'),
  ITERATE_LOG: join(DATA, 'iterate.log'),
};

export function ensureDirs() {
  for (const d of [paths.DATA, paths.SCREENSHOTS, paths.ITERATIONS, paths.CHROME_PROFILE, paths.AVATARS, paths.ROMS]) {
    mkdirSync(d, { recursive: true });
  }
}

ensureDirs();

// Hour (0-23) right now in the configured timezone, robust to system TZ.
export function ptHour(date = new Date()) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, hour: '2-digit', hour12: false }).format(date);
  return parseInt(s, 10) % 24;
}

// True when the screen should be asleep (night window).
export function isNightNow(date = new Date()) {
  const h = ptHour(date);
  const { nightStartHour: a, dayStartHour: b } = config;
  return a <= b ? h >= a && h < b : h >= a || h < b; // handles wrap-around
}

// Fractional hours (e.g. 20.5 = 8:30pm) now in the configured timezone.
export function ptHours(date = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(date).split(':').map((x) => parseInt(x, 10));
  return (h % 24) + m / 60;
}

// Evening fade level: 1 at EVENING_START, falling linearly to EVENING_BRIGHTNESS at
// NIGHT_START (clamped). Rounded to 2 decimals for xrandr.
export function eveningLevel(date = new Date()) {
  const { eveningStartHour: e, nightStartHour: n, eveningBrightness: floor } = config;
  if (!isEveningNow(date)) return isNightNow(date) ? 0 : 1;
  const span = ((n - e) + 24) % 24 || 24;
  const t = Math.min(1, Math.max(0, (((ptHours(date) - e) + 24) % 24) / span));
  return Math.round((1 - t * (1 - floor)) * 100) / 100;
}

// True during the evening dim window: from eveningStartHour until night begins
// (and not already night). E.g. 21:00 ≤ h < 24 with night starting at 00:00.
export function isEveningNow(date = new Date()) {
  if (isNightNow(date)) return false;
  const h = ptHour(date);
  const { eveningStartHour: e, nightStartHour: n } = config;
  return e <= n ? (h >= e && h < n) : (h >= e || h < n);
}
