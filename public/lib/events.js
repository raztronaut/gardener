// Shared SF events data layer — used by BOTH the on-dashboard widget
// (widgets/sf-events.js) and the full-screen /events modal (app.js), so the two
// always agree on sourcing, cleaning, de-duping and time-pruning.
//
// Source: SF RATS (sfrats.com) — "a working field guide to free events around the
// Bay Area." Supabase-backed; its anon PostgREST endpoint is keyless (the anon key
// ships in the site's own JS bundle) and CORS-open. We fetch the "Events" category
// upcoming-only, soonest-first, through the SSRF-safe proxy.

export const SUPA = 'https://uflkltmvzvhziysheccd.supabase.co/rest/v1/items';
// Public anon key, role "anon" — published in sfrats.com's client bundle. Not a secret.
export const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmbGtsdG12enZoeml5c2hlY2NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMTEzNTYsImV4cCI6MjA5Mzg4NzM1Nn0.4rnQa5rCJNzmnfzjUg0B-ecJ-dxCnJamrA9tu8eiBWU';
export const TZ = 'America/Los_Angeles';
export const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const tidy = (s) => String(s || '').trim().replace(/\s+/g, ' ');

// Titles from scraped sources look like "6/20/26: Name (Venue) - FREE". The real
// date lives in available_from, so strip the leading date prefix and trailing price
// tag, leaving a clean human name. Native titles (e.g. "OpenClaw @ GitHub") pass through.
export function cleanName(raw) {
  let t = tidy(raw);
  t = t.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}:\s*/, '');
  t = t.replace(/\s[-–—]\s*(FREE\b.*|\$[\d.,].*)$/i, '');
  return tidy(t).replace(/[\s:–-]+$/, '');
}

// Trim the location to the neighborhood: drop generic ", San Francisco[, CA]" tails.
export function cleanPlace(raw) {
  let t = tidy(raw);
  if (/^san francisco(,?\s*ca)?$/i.test(t)) return '';
  t = t.replace(/,?\s*san francisco(,?\s*ca)?\.?$/i, '');
  return tidy(t);
}

const dayKeyOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// "today" in SF as YYYY-MM-DD, for the available_from query floor.
export function sfToday() { return dayKeyOf(new Date()); }

// Has this row a real clock time (not an all-day / midnight placeholder)?
function hasClockTime(rawFrom) {
  const s = String(rawFrom || '');
  return /\d{1,2}:\d{2}/.test(s) && !/[T\s]00:00(:00)?/.test(s);
}

// The literal calendar day written in the source value (YYYY-MM-DD), taken AS-IS.
// Source dates are stored as UTC instants, so converting a midnight-UTC placeholder
// through the SF timezone shifts it back a day — which made "today" all-day events
// look like yesterday and silently drop. For all-day rows we trust the written date.
function rawDateKey(rawFrom) {
  const m = String(rawFrom || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Is this event already over, by current time? All-day events (no clock time) are
// "past" only once their calendar day has fully ended (compared in SF); timed events
// get a 2-hour grace so something that just started (likely still going) isn't dropped.
const PAST_GRACE_MS = 2 * 60 * 60 * 1000;
export function isPast(when, rawFrom, now = new Date()) {
  if (!when || isNaN(when)) return false; // unknown date → keep (don't hide blindly)
  if (!hasClockTime(rawFrom)) {
    const dk = rawDateKey(rawFrom) || dayKeyOf(when);
    return dk < dayKeyOf(now);
  }
  return when.getTime() < now.getTime() - PAST_GRACE_MS;
}

// Fetch + clean + dedupe + prune-past, soonest first. `fetchJSON` is the widget/app
// proxy fetcher. Returns [{ name, when:Date|null, place, emoji, raw }].
export async function fetchEvents(fetchJSON, { limit = 60 } = {}) {
  const params = new URLSearchParams({
    select: 'id,title,location_address,available_from,emoji',
    category: 'eq.Events',
    available_from: `gte.${sfToday()}`,
    order: 'available_from.asc',
    limit: String(limit),
    apikey: ANON,
  });
  const rows = await fetchJSON(`${SUPA}?${params.toString()}`);
  if (!Array.isArray(rows)) throw new Error('bad events payload');

  const now = new Date();
  const dedupKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const name = cleanName(r.title);
    if (!name || /^__SCRAPER_RUN__/.test(r.title || '')) continue;
    const when = r.available_from ? new Date(r.available_from) : null;
    if (isPast(when, r.available_from, now)) continue; // prune events already over
    const key = dedupKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      when: when && !isNaN(when) ? when : null,
      place: cleanPlace(r.location_address),
      emoji: tidy(r.emoji),
    });
  }
  return out;
}
