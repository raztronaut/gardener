// Shared FIFA World Cup 2026 data layer — used by BOTH the on-dashboard widget
// (widgets/sf-events.js, in its "World Cup" mode) and the full-screen /worldcup
// modal (app.js), so the card and the modal always agree on sourcing + parsing.
//
// Source: TheSportsDB free tier (demo key "3"), FIFA World Cup = league 4429.
// The schedule lives in eventsday.php?d=<YYYY-MM-DD>&l=4429 (the season endpoint
// is hard-capped on the free key, the day endpoint is not). We page day-by-day
// across the tournament window and cache each day in-memory, so a full-schedule
// fetch only ever hits each day once per page load.

export const TZ = 'America/Los_Angeles';
export const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const API = 'https://www.thesportsdb.com/api/v1/json/3/eventsday.php';
const LEAGUE = '4429';
export const WC_START = '2026-06-11';
export const WC_END = '2026-07-19';

const tidy = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

// "Foxborough, MA" / "Mexico City, MX" → "Foxborough" / "Mexico City".
function cleanCity(raw) {
  const t = tidy(raw);
  return t.replace(/,\s*[A-Z]{2}$/i, '').trim();
}

// Per-day cache: 'YYYY-MM-DD' → Match[] (so repeat fetches are free).
const dayCache = new Map();

function parseScore(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// strTimestamp ("2026-06-26T19:00:00") is UTC but carries no Z — treat as UTC.
function parseWhen(e) {
  if (e.strTimestamp) {
    const d = new Date(e.strTimestamp.replace(' ', 'T') + 'Z');
    if (!isNaN(d)) return d;
  }
  if (e.dateEvent) {
    const t = e.strTime && e.strTime !== '00:00:00' ? e.strTime : '12:00:00';
    const d = new Date(`${e.dateEvent}T${t}Z`);
    if (!isNaN(d)) return d;
  }
  return null;
}

function parseEvent(e) {
  return {
    id: e.idEvent,
    home: tidy(e.strHomeTeam),
    away: tidy(e.strAwayTeam),
    venue: tidy(e.strVenue),
    city: cleanCity(e.strCity),
    country: tidy(e.strCountry),
    when: parseWhen(e),
    dateEvent: e.dateEvent,
    homeScore: parseScore(e.intHomeScore),
    awayScore: parseScore(e.intAwayScore),
    status: tidy(e.strStatus) || 'NS',
    postponed: /yes/i.test(e.strPostponed || ''),
  };
}

const FINISHED = new Set(['FT', 'AET', 'PEN', 'Match Finished']);
const NOT_STARTED = new Set(['NS', 'Not Started', '', 'TBD']);
export function isFinished(m) { return FINISHED.has(m.status); }
export function isLive(m) { return !isFinished(m) && !NOT_STARTED.has(m.status); }

// All days the tournament spans, oldest first.
export function tournamentDays() {
  const out = [];
  const end = new Date(WC_END + 'T00:00:00Z');
  for (let d = new Date(WC_START + 'T00:00:00Z'); d <= end; d = new Date(d.getTime() + 864e5)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// SF "today" as YYYY-MM-DD.
export function sfToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Fetch one day's matches (cached). Retries a couple of times on a transient
// failure / 429 before giving up on THAT day (other days still load).
export async function fetchDay(fetchJSON, date) {
  if (dayCache.has(date)) return dayCache.get(date);
  let data = null;
  for (let i = 0; i < 3 && !data; i++) {
    try { data = await fetchJSON(`${API}?d=${date}&l=${LEAGUE}`); }
    catch { if (i < 2) await new Promise((r) => setTimeout(r, 700 * (i + 1))); }
  }
  if (!data) throw new Error('day fetch failed');
  const list = Array.isArray(data.events) ? data.events.map(parseEvent) : [];
  list.sort((a, b) => (a.when?.getTime() || 0) - (b.when?.getTime() || 0));
  dayCache.set(date, list);
  return list;
}

// The next `count` matches from today onward (includes today's earlier results
// and any in-progress games). Walks forward day-by-day, stopping as soon as it
// has enough — so the card only makes a few requests.
export async function fetchUpcoming(fetchJSON, { count = 4 } = {}) {
  const today = sfToday();
  const days = tournamentDays().filter((d) => d >= today);
  const graceMs = 150 * 60 * 1000; // keep just-kicked-off games ~2.5h
  const now = Date.now();
  const out = [];
  let gotError = false;
  for (const d of days) {
    let matches;
    try { matches = await fetchDay(fetchJSON, d); }
    catch { gotError = true; continue; }
    for (const m of matches) {
      if (m.when && m.when.getTime() < now - graceMs && isFinished(m)) continue; // already over
      out.push(m);
    }
    if (out.length >= count) break;
  }
  if (!out.length && gotError) throw new Error('world cup unavailable');
  return out.slice(0, count);
}

// The WHOLE tournament schedule we can see, oldest first (for the full panel).
// Days whose fixtures aren't published yet (knockouts before pairings are set)
// simply return empty and are skipped. Fetches in small concurrent batches to
// stay friendly to the free-tier rate limit.
export async function fetchAll(fetchJSON) {
  const days = tournamentDays();
  const all = [];
  const BATCH = 4;
  for (let i = 0; i < days.length; i += BATCH) {
    const slice = days.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((d) => fetchDay(fetchJSON, d).catch(() => [])));
    for (const r of results) all.push(...r);
  }
  all.sort((a, b) => (a.when?.getTime() || 0) - (b.when?.getTime() || 0));
  return all;
}
