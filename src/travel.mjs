// The Gardener™ — "how far is it?" for Out in SF: geocode an event's venue and get
// the drive time from home. Both lookups are free/keyless and cached on disk forever
// (data/travel-cache.json), so each venue costs one request ever:
//   geocode → OpenStreetMap Nominatim (1 req/s, identified UA, Bay Area viewbox)
//   drive   → OSRM public router (free-flow time; no live traffic)
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';

export const HOME = { label: '408 Quintara St', lat: 37.74838, lon: -122.47659 };
const FILE = join(paths.DATA, 'travel-cache.json');
const UA = 'TheGardener-wall/1.0 (personal kiosk; low volume)';
const BAY = '-123.1,38.6,-121.5,37.0'; // viewbox: left,top,right,bottom

let cache = null;
async function load() {
  if (cache) return cache;
  try { cache = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { cache = {}; }
  cache.geo ||= {}; cache.route ||= {};
  return cache;
}
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(cache)).catch(() => {}), 500); };

let lastNom = 0;
async function nominatim(q) {
  const c = await load();
  const k = q.toLowerCase();
  if (k in c.geo) return c.geo[k];
  const wait = lastNom + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNom = Date.now();
  let hit = null;
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=${BAY}&q=${encodeURIComponent(q)}`;
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; // transient — don't cache
    const j = await r.json();
    if (j[0]) hit = { lat: +j[0].lat, lon: +j[0].lon };
  } catch { return null; }
  c.geo[k] = hit; save(); // misses are cached too (null) so we never re-ask
  return hit;
}

// Candidate queries for one event, best first: its street address, an address in the
// description, then venues named in the title/description ("… at White Rabbit (SF)",
// "(Yerba Buena Gardens)", "held at the Brava Theater", "San Francisco Playhouse's …").
// The city comes from the text when it names one (Oakland, Mountain View, …), else SF.
const CITIES = ['San Francisco', 'Oakland', 'Berkeley', 'Alameda', 'Daly City', 'Sausalito', 'Emeryville', 'Mountain View',
  'Palo Alto', 'San Jose', 'San Mateo', 'Redwood City', 'Santa Rosa', 'Mill Valley', 'Richmond', 'Walnut Creek', 'South San Francisco'];
const CITY_RE = new RegExp(`\\b(${CITIES.join('|')})\\b`, 'i');
const ST = '(?:St|Street|Ave|Avenue|Blvd|Boulevard|Way|Rd|Road|Dr|Drive|Pl|Place|Ln|Lane|Ct|Terrace|Ter|Alley|Plaza|Embarcadero)';
const ADDR = new RegExp(`\\b\\d{2,5}\\s+(?:[A-Z0-9][\\w'.-]*\\s){0,3}${ST}\\b\\.?`);
const VENUE = /\b(?:at|held at|inside|@)\s+(?:the\s+)?([A-Z][\w'’&.-]*(?:\s+(?:of|the|de|[A-Z&][\w'’&.-]*)){0,5})/g;
const HOODS = /\b(Japantown|Chinatown|North Beach|Mission District|the Mission|Haight|Castro|Marina|Presidio|Golden Gate Park|Dogpatch|SoMa|Hayes Valley|Fisherman[’']s Wharf|Union Square|Embarcadero|Temescal|Jack London Square|Lake Merritt|Ocean Beach|Bernal Heights|Noe Valley|Potrero Hill|Tenderloin|Civic Center|Yerba Buena)\b/i;
const clean = (v) => v.replace(/\s+(?:in|on|for|with|and)$/i, '').replace(/[–—-]\s*$/, '').trim();
function queries(ev) {
  const name = String(ev.name || ''), desc = String(ev.description || '').replace(/\s+/g, ' '), pf = String(ev.placeFull || '').trim();
  const cm = (pf + ' ' + name + ' ' + desc.slice(0, 400)).match(CITY_RE);
  const city = cm ? CITIES.find((c) => c.toLowerCase() === cm[1].toLowerCase()) : 'San Francisco';
  const withCity = (q) => (CITY_RE.test(q) || /, ca\b/i.test(q) ? q : `${q}, ${city}`);
  const out = [];
  if (pf) {
    const m = pf.match(ADDR);
    if (m) out.push(withCity(m[0]));
    out.push(withCity(pf));
    const first = pf.split(',')[0].trim();
    if (first && first !== pf) out.push(withCity(first));
  }
  const d = desc.match(ADDR);
  if (d) out.push(withCity(d[0]));
  for (const txt of [name, desc.slice(0, 600)]) {
    for (const m of txt.matchAll(VENUE)) { const v = clean(m[1]); if (v.length > 3 && !CITY_RE.test(v) || v.split(' ').length > 2) out.push(withCity(v.replace(CITY_RE, '').trim() || v)); }
    const poss = txt.match(/((?:[A-Z][\w&.-]*\s){1,4}[A-Z][\w&.-]*)[’']s\s+[“"]/); // "San Francisco Playhouse’s “Peter Pan…”"
    if (poss) out.push(withCity(poss[1]));
  }
  for (const m of name.matchAll(/\(([^)]{3,40})\)/g)) if (!/^(sf|\d|free|\$|every|oct|sept?|nov|dec|jan)/i.test(m[1])) out.push(withCity(m[1]));
  const hood = (name + ' ' + desc.slice(0, 600)).match(HOODS);
  if (hood) out.push(withCity(hood[1]));
  return [...new Set(out)].slice(0, 6);
}

async function drive(to) {
  const c = await load();
  const k = `${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
  if (k in c.route) return c.route[k];
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${HOME.lon},${HOME.lat};${to.lon},${to.lat}?overview=false`;
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) return null;
    c.route[k] = { mins: Math.round(rt.duration / 60), km: +(rt.distance / 1000).toFixed(1) };
    save();
    return c.route[k];
  } catch { return null; }
}

// events: [{ key, name, placeFull, description }] → { home, results: { key: { lat, lon, mins, km } | null } }
export async function travelFor(events) {
  const results = {};
  for (const ev of events.slice(0, 40)) {
    let at = null;
    for (const q of queries(ev)) { at = await nominatim(q); if (at) break; }
    if (!at) { results[ev.key] = null; continue; }
    results[ev.key] = { ...at, ...(await drive(at)) };
  }
  return { home: HOME, results };
}
