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
  model: E.GARDENER_MODEL || 'claude-opus-4-8',
  tz: E.GARDENER_TZ || 'America/Los_Angeles',
  lat: num(E.GARDENER_LAT, 37.7577),
  lon: num(E.GARDENER_LON, -122.4727),
  location: E.GARDENER_LOCATION || 'San Francisco, CA',
  // Public base URL (e.g. an ngrok tunnel) the QR-notes widget encodes so phones
  // can plant notes remotely. Empty → the widget falls back to the page origin.
  publicUrl: (E.GARDENER_PUBLIC_URL || '').replace(/\/+$/, ''),
  port: num(E.GARDENER_PORT, 8787),
  host: E.GARDENER_HOST || '127.0.0.1',
  display: E.DISPLAY || ':0',
  output: E.GARDENER_OUTPUT || 'DP-0',
  width: num(E.GARDENER_WIDTH, 900),
  height: num(E.GARDENER_HEIGHT, 1600),
  chromium: E.GARDENER_CHROMIUM || '/snap/bin/chromium',
  // Night window (local PT hours): screen sleeps at NIGHT_START, wakes at DAY_START.
  nightStartHour: num(E.GARDENER_NIGHT_START, 0), // 00:00
  dayStartHour: num(E.GARDENER_DAY_START, 7), // 07:00
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
  CHROME_PROFILE: join(DATA, '.chrome-profile'),
  SERVER_LOG: join(DATA, 'server.log'),
  ITERATE_LOG: join(DATA, 'iterate.log'),
};

export function ensureDirs() {
  for (const d of [paths.DATA, paths.SCREENSHOTS, paths.ITERATIONS, paths.CHROME_PROFILE]) {
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
