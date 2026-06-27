// Shared FIFA World Cup 2026 data layer — used by BOTH the on-dashboard widget
// (widgets/sf-events.js, in its "World Cup" mode) and the full-screen /worldcup
// modal (app.js), so the card and the modal always agree on sourcing + parsing.
//
// Source: ESPN's free, keyless public scoreboard API for the FIFA World Cup
// (league "fifa.world"). Unlike TheSportsDB's free tier (which only carries the
// first 15 fixtures and no US TV data), ESPN publishes the WHOLE schedule AND the
// per-match US broadcasters — FOX vs FS1 (English linear), Telemundo/Universo
// (Spanish linear) and the FOX One / Peacock streams. The humans watch on
// "FOX ONE / FOX", so the channel is shown on every match.
//   scoreboard?dates=YYYYMMDD  → one day's matches (we page day-by-day and cache).

export const TZ = 'America/Los_Angeles';
export const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
export const WC_START = '2026-06-11';
export const WC_END = '2026-07-19';

const tidy = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

// "East Rutherford, New Jersey" → "East Rutherford". Drop the trailing region.
function cleanCity(raw) {
  const t = tidy(raw);
  const i = t.indexOf(',');
  return i > 0 ? t.slice(0, i).trim() : t;
}

// Per-day cache: 'YYYYMMDD' → Match[] (so repeat fetches are free).
const dayCache = new Map();

function parseScore(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ESPN `broadcasts[0].names` is e.g. ['FOX','Tele','FOX One'] or
// ['FS1','Universo','FOX One']. Split into the English linear channel (what the
// humans asked for), the Spanish linear channel, and the streaming services.
function parseBroadcast(comp) {
  const names = [];
  const bs = Array.isArray(comp.broadcasts) ? comp.broadcasts : [];
  for (const b of bs) for (const n of (b.names || [])) names.push(tidy(n));
  // geoBroadcasts is a richer fallback when broadcasts[] is sparse.
  const geo = Array.isArray(comp.geoBroadcasts) ? comp.geoBroadcasts : [];
  for (const g of geo) { const n = tidy(g.media && g.media.shortName); if (n) names.push(n); }
  const has = (re) => names.find((n) => re.test(n));
  const tv = has(/^fox$/i) ? 'FOX' : (has(/fs1/i) ? 'FS1' : null);
  const esRaw = has(/universo/i) ? 'Universo' : (has(/tele/i) ? 'Telemundo' : null);
  const streams = [];
  if (has(/fox\s*one/i)) streams.push('FOX One');
  if (has(/peacock/i)) streams.push('Peacock');
  return { tv, es: esRaw, streams };
}

function parseWhen(e) {
  if (e.date) { const d = new Date(e.date); if (!isNaN(d)) return d; }
  return null;
}

function parseEvent(e) {
  const comp = (e.competitions && e.competitions[0]) || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
  const st = (comp.status && comp.status.type) || (e.status && e.status.type) || {};
  const when = parseWhen(e);
  return {
    id: e.id,
    home: tidy((home.team && home.team.displayName) || ''),
    away: tidy((away.team && away.team.displayName) || ''),
    homeAbbr: tidy((home.team && home.team.abbreviation) || ''),
    awayAbbr: tidy((away.team && away.team.abbreviation) || ''),
    venue: tidy((comp.venue && comp.venue.fullName) || ''),
    city: cleanCity((comp.venue && comp.venue.address && comp.venue.address.city) || ''),
    when,
    dateEvent: when ? when.toISOString().slice(0, 10) : '',
    homeScore: parseScore(home.score),
    awayScore: parseScore(away.score),
    state: st.state || 'pre',           // 'pre' | 'in' | 'post'
    detail: tidy(st.shortDetail || ''),
    broadcast: parseBroadcast(comp),
  };
}

export function isFinished(m) { return m.state === 'post'; }
export function isLive(m) { return m.state === 'in'; }

// Short channel label for a match, e.g. "FOX · FOX One" or "FS1 · Telemundo".
// English linear first (the humans' main ask), then a stream, then Spanish.
export function broadcastLabel(m) {
  const b = m.broadcast || {};
  const parts = [];
  if (b.tv) parts.push(b.tv);
  if (b.streams && b.streams.length) parts.push(b.streams[0]);
  else if (b.es) parts.push(b.es);
  return parts.join(' · ');
}

// Full broadcaster string for the detail modal (everything we know).
export function broadcastFull(m) {
  const b = m.broadcast || {};
  const parts = [];
  if (b.tv) parts.push(b.tv);
  if (b.es) parts.push(b.es);
  if (b.streams) parts.push(...b.streams);
  return parts.join(' · ');
}

// All days the tournament spans, oldest first, as 'YYYYMMDD' for the ESPN param.
export function tournamentDays() {
  const out = [];
  const end = new Date(WC_END + 'T00:00:00Z');
  for (let d = new Date(WC_START + 'T00:00:00Z'); d <= end; d = new Date(d.getTime() + 864e5)) {
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
}

// SF "today" as YYYYMMDD (matches the ESPN param + tournamentDays() shape).
export function sfToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replace(/-/g, '');
}

// Fetch one day's matches (cached). Retries a couple of times on a transient
// failure / 429 before giving up on THAT day (other days still load).
export async function fetchDay(fetchJSON, ymd) {
  if (dayCache.has(ymd)) return dayCache.get(ymd);
  let data = null;
  for (let i = 0; i < 3 && !data; i++) {
    try { data = await fetchJSON(`${API}?dates=${ymd}`); }
    catch { if (i < 2) await new Promise((r) => setTimeout(r, 700 * (i + 1))); }
  }
  if (!data) throw new Error('day fetch failed');
  const list = Array.isArray(data.events) ? data.events.map(parseEvent) : [];
  list.sort((a, b) => (a.when?.getTime() || 0) - (b.when?.getTime() || 0));
  dayCache.set(ymd, list);
  return list;
}

// Matches kicking off today (in SF time) — ALL of them, including ones already
// played earlier today and any in progress. This is what the card leads with so
// the humans never "miss" a game that's on later today.
export async function fetchToday(fetchJSON) {
  return fetchDay(fetchJSON, sfToday());
}

// The next `count` matches from today onward (includes today's earlier results
// and any in-progress games). Walks forward day-by-day, stopping as soon as it
// has enough — so the card only makes a few requests.
export async function fetchUpcoming(fetchJSON, { count = 6 } = {}) {
  const today = sfToday();
  const days = tournamentDays().filter((d) => d >= today);
  const graceMs = 150 * 60 * 1000; // keep just-kicked-off games ~2.5h
  const now = Date.now();
  const out = [];
  const seen = new Set();
  let gotError = false;
  for (const d of days) {
    let matches;
    try { matches = await fetchDay(fetchJSON, d); }
    catch { gotError = true; continue; }
    for (const m of matches) {
      if (seen.has(m.id)) continue;
      if (m.when && m.when.getTime() < now - graceMs && isFinished(m)) continue; // already over
      seen.add(m.id);
      out.push(m);
    }
    if (out.length >= count) break;
  }
  if (!out.length && gotError) throw new Error('world cup unavailable');
  out.sort((a, b) => (a.when?.getTime() || 0) - (b.when?.getTime() || 0));
  return out.slice(0, count);
}

// The WHOLE tournament schedule we can see, oldest first (for the full panel).
// Days whose fixtures aren't published yet (knockouts before pairings are set)
// simply return empty and are skipped. Fetches in small concurrent batches to
// stay friendly to the rate limit, and dedupes by id (a UTC-midnight kickoff can
// surface under two adjacent day queries).
export async function fetchAll(fetchJSON) {
  const days = tournamentDays();
  const all = [];
  const seen = new Set();
  const BATCH = 4;
  for (let i = 0; i < days.length; i += BATCH) {
    const slice = days.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((d) => fetchDay(fetchJSON, d).catch(() => [])));
    for (const r of results) for (const m of r) { if (!seen.has(m.id)) { seen.add(m.id); all.push(m); } }
  }
  all.sort((a, b) => (a.when?.getTime() || 0) - (b.when?.getTime() || 0));
  return all;
}
