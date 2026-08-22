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

// Scraped titles/venues arrive carrying HTML entities — mostly numeric curly
// quotes and dashes (&#8220;…&#8221;), plus the odd &amp; / &#39; / &eacute;.
// They render as PLAIN TEXT in the widget and the /events modal, so a literal
// "&#8221;" leaks onto the wall. Decode to real characters here — pure and
// deterministic (no DOM), handling decimal/hex numeric refs plus the common
// named ones; unknown or lone-ampersand tokens are left untouched.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', deg: '°', trade: '™', copy: '©', reg: '®',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ',
  uuml: 'ü', ouml: 'ö', auml: 'ä',
};
function decodeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, e) => {
    try {
      if (e[0] === '#') {
        const cp = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return (Number.isFinite(cp) && cp > 0 && cp <= 0x10FFFF) ? String.fromCodePoint(cp) : m;
      }
      const k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
    } catch { return m; }
  });
}

const tidy = (s) => decodeEntities(s).trim().replace(/\s+/g, ' ');

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

// The literal event day written in the TITLE ("6/10/26: …"), as YYYY-MM-DD.
// Scraped rows carry their real calendar day in the title and a noon-UTC
// placeholder in available_from — the title is the truth for those.
function titleDateKey(title) {
  const m = String(title || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}):/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Is this event already over?
// - ALL-DAY rows (title-dated placeholders): past once their written calendar day
//   has fully ended in SF.
// - Everything else: available_from is a REAL UTC instant (e.g. 00:00Z = 5:00 PM
//   PDT the previous SF evening — the classic event hour, NOT an all-day marker;
//   that bad heuristic kept showing yesterday-evening events all of today).
//   Past once the instant is over, with a 2-hour grace for just-started events.
const PAST_GRACE_MS = 2 * 60 * 60 * 1000;
export function isPast(ev, now = new Date()) {
  if (ev.allDay) return ev.dayKey < dayKeyOf(now);
  if (!ev.when || isNaN(ev.when)) return false; // unknown date → keep (don't hide blindly)
  return ev.when.getTime() < now.getTime() - PAST_GRACE_MS;
}

// Fetch + clean + dedupe + prune-past, soonest first. `fetchJSON` is the widget/app
// proxy fetcher. Returns [{ name, when:Date|null, place, emoji, raw }].
export async function fetchEvents(fetchJSON, { limit = 60 } = {}) {
  const params = new URLSearchParams({
    select: 'id,title,location_address,available_from,available_until,description,url,interest_count,emoji',
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
    const dayKey = titleDateKey(r.title); // non-null → all-day placeholder row
    let when = r.available_from ? new Date(r.available_from) : null;
    if (when && isNaN(when)) when = null;
    // For all-day rows, anchor `when` to SF noon of the WRITTEN day so date
    // displays are stable (the stored noon-UTC placeholder is 5 AM PDT).
    if (dayKey) when = new Date(`${dayKey}T12:00:00-07:00`);
    const ev = {
      name,
      when,
      allDay: !!dayKey,
      dayKey: dayKey || (when ? dayKeyOf(when) : null),
      place: cleanPlace(r.location_address),
      placeFull: tidy(r.location_address),
      emoji: tidy(r.emoji),
      // detail-view fields (descriptions arrive as HTML — strip to text)
      description: tidy(String(r.description || '').replace(/<br[^>]*>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')),
      url: tidy(r.url),
      until: r.available_until ? new Date(r.available_until) : null,
      interest: Number(r.interest_count) || 0,
    };
    if (isPast(ev, now)) continue; // prune events already over
    const key = dedupKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}
