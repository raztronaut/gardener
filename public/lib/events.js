// Shared SF events data layer — used by BOTH the on-dashboard widget
// (widgets/sf-events.js) and the full-screen /events modal (app.js), so the two
// always agree on sourcing, cleaning, de-duping and time-pruning.
//
// Source: SF RATS (sfrats.com) — "a working field guide to free events around the
// Bay Area." Supabase-backed; its anon PostgREST endpoint is keyless (the anon key
// ships in the site's own JS bundle) and CORS-open. We fetch the "Events" category
// through the SSRF-safe proxy and order it OURSELVES: the API can only sort by the
// row's scrape timestamp, which is not the event's date (see fetchEvents).

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

// The scraper sometimes drops apostrophes, leaving a lone "s" word ("SF s Wild
// New Thursday Night Party"). A standalone lowercase "s" between words is almost
// never real English, so restore the possessive: "SF s Wild" → "SF’s Wild".
const tidy = (s) => decodeEntities(s).trim().replace(/\s+/g, ' ').replace(/([A-Za-z0-9]) s(?= )/g, '$1’s');

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

// Does an available_from timestamp sit at EXACTLY noon UTC? That's the source's
// "no real start time" placeholder — 12:00Z renders as 5:00 AM PDT, so a native
// (non-title-dated) row carrying it would otherwise print a bogus "5:00 AM" start
// on the wall (e.g. a comedy show or beat battle "at 5 AM"). We treat such rows as
// all-day/time-unknown, the same way title-dated scraped rows already are. NOTE:
// midnight UTC (00:00Z → 5:00 PM PDT) is deliberately NOT matched — that's the
// real evening-event hour the rest of this file relies on.
function isNoonUtcPlaceholder(iso) {
  if (!iso) return false;
  return /T12:00(?::00)?(?:\.0+)?(?:Z|\+00:?00)$/i.test(String(iso).trim());
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

// Collapse near-duplicate listings (the same series re-published for several
// dates, or a title whose punctuation drifted between scrapes) onto one key.
// The prefix must be LONG: at 12 characters it was silently eating genuinely
// different events that merely shared an opening phrase — "Golden Gate Park
// Sunday Roller Disco Party" vs "Golden Gate Park 'The Whale's Tail' Beer
// Garden", or Oakland's "Town Biz" vs "POC" comedy nights. 28 characters still
// merges the true duplicates (an em-dash swapped for a colon) while keeping
// distinct events distinct. Exported for smoke.
export function dedupKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 28);
}

// Same-day near-duplicates (2026-10-25). The scraper often lists ONE event several
// times under reworded titles — "SF's Free “World of Dumplings” Festival at the
// Ferry Building" / "“World of Dumplings” 2026: Free Community Food Fest" — which
// the 28-char prefix key can't see, so the wall card showed the festival twice.
// Two listings ON THE SAME DAY are one event when they share a distinctive quoted
// name (2+ words, one of them a non-generic word of 5+ letters — so two different
// "Trick-Or-Treat" events never merge), or when their significant words overlap
// heavily (3+ shared, ≥70% of the shorter title). Exported for smoke.
const DUP_STOP = new Set('the and for with from at of in on to w a an by sf sfs san francisco free annual every new is back'.split(' '));
const DUP_GENERIC = new Set('trick treat halloween comedy night party market dance music show free open'.split(' '));
const dupWords = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);
const dupTokens = (s) => new Set(dupWords(s).filter((w) => w.length >= 3 && !DUP_STOP.has(w) && !/^\d+$/.test(w))
  .map((w) => (w.length > 4 ? w.replace(/s$/, '') : w)));
const dupQuotes = (s) => [...String(s || '').matchAll(/[“"]([^”"]{3,})[”"]/g)].map((m) => dupWords(m[1]))
  .filter((ws) => ws.length >= 2 && ws.some((w) => w.length >= 5 && !DUP_GENERIC.has(w))).map((ws) => ws.join(' '));
export function sameEvent(a, b) {
  const qb = new Set(dupQuotes(b));
  if (dupQuotes(a).some((q) => qb.has(q))) return true;
  const A = dupTokens(a), B = dupTokens(b);
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n >= 3 && n / Math.min(A.size, B.size) >= 0.7;
}

// Which side of the Bay is this? The scraped titles tag their city in plain text
// ("… (Alameda)", "Oakland's Free …", "SF's Chinatown …"), and location_address is
// usually blank, so the title is what we have to read. Returns a sort rank:
// 0 = San Francisco, 1 = unstated, 2 = elsewhere in the Bay. An explicit SF signal
// always wins, which also keeps SF's own Richmond district from being mistaken for
// the city of Richmond. Exported for smoke.
const SF_RE = /\bsan francisco\b|\bsf'?s?\b|\(sf\)|golden gate park|\bpresidio\b|\bthe embarcadero\b|\bchinatown\b|dolores park|\bthe castro\b|north beach|fisherman'?s wharf|\bsoma\b|\bnob hill\b|\bhaight\b|union square|\bthe mission\b/i;
const OTHER_RE = /\b(oakland|berkeley|alameda|albany|emeryville|piedmont|el cerrito|richmond|san leandro|hayward|fremont|union city|milpitas|san jose|santa clara|sunnyvale|mountain view|palo alto|redwood city|san mateo|burlingame|daly city|pacifica|half moon bay|concord|walnut creek|pleasant hill|martinez|benicia|vallejo|napa|santa rosa|petaluma|novato|san rafael|sausalito|marin|livermore|pleasanton|dublin|danville|orinda|lafayette|moraga|antioch)\b/i;
export function localeRank(ev) {
  const hay = `${(ev && ev.name) || ''} ${(ev && ev.placeFull) || ''}`;
  if (SF_RE.test(hay)) return 0;
  if (OTHER_RE.test(hay)) return 2;
  return 1;
}

// Chronological comparator over the RESOLVED event instant. Undated ("Soon") rows
// sink to the end rather than masquerading as imminent. Exported for smoke.
//
// Ties break toward San Francisco. This matters more than it sounds: every all-day
// listing for a given day is anchored to the same SF-noon instant, so a whole day's
// events tie exactly — and a card headlined "Out in SF" was opening with Alameda and
// Berkeley purely by scrape order while Flower Piano and the Autumn Moon Festival sat
// further down. Strictly a tiebreak: timed events keep their true chronological order.
export function byWhen(a, b) {
  const ta = a && a.when && !isNaN(a.when) ? a.when.getTime() : Infinity;
  const tb = b && b.when && !isNaN(b.when) ? b.when.getTime() : Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1; // never Infinity - Infinity (NaN)
  return localeRank(a) - localeRank(b);
}

// Fetch + clean + prune-past + SORT + dedupe, soonest first. `fetchJSON` is the
// widget/app proxy fetcher. Returns [{ name, when:Date|null, place, emoji, raw }].
//
// `limit` is deliberately generous: the server-side `order=available_from.asc` is
// ordering by the row's SCRAPE/publish timestamp, which bears no relation to when
// the event actually happens (see the sort below). A small limit therefore lops off
// an ARBITRARY slice of dates — at 60 rows the head of the list was routinely a
// handful of events weeks out while tonight's plans sat past the cut. Fetching a
// wider window (~75KB, every 5 min) and sorting locally is what makes "soonest
// first" true.
export async function fetchEvents(fetchJSON, { limit = 150 } = {}) {
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
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const name = cleanName(r.title);
    if (!name || /^__SCRAPER_RUN__/.test(r.title || '')) continue;
    const dayKey = titleDateKey(r.title); // non-null → all-day placeholder row
    let when = r.available_from ? new Date(r.available_from) : null;
    if (when && isNaN(when)) when = null;
    // Native rows sometimes carry the same noon-UTC "no real time" placeholder the
    // scraped rows use, but WITHOUT a title date prefix — those must be treated as
    // all-day too, or the widget prints a spurious "5:00 AM" start on the wall.
    const noonPlaceholder = !dayKey && !!when && isNoonUtcPlaceholder(r.available_from);
    // For all-day rows, anchor `when` to SF noon of the day so date displays are
    // stable (the stored noon-UTC placeholder is 5 AM PDT). Title-dated rows use
    // the written day; noon-UTC native rows use that placeholder's own SF day.
    if (dayKey) when = new Date(`${dayKey}T12:00:00-07:00`);
    else if (noonPlaceholder) when = new Date(`${dayKeyOf(when)}T12:00:00-07:00`);
    const ev = {
      name,
      when,
      allDay: !!dayKey || noonPlaceholder,
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
    out.push(ev);
  }

  // SORT BY THE REAL EVENT DATE. The source's `available_from` is the row's
  // scrape/publish instant, NOT the event's day — scraped rows carry their true
  // calendar day in the TITLE ("10/3/26: …") and only a placeholder timestamp in
  // available_from. So the server's `order=available_from.asc` hands back an
  // essentially arbitrary jumble of dates, and every consumer here (the wall card
  // takes the first 3; the /events panel lists them in order) was trusting it.
  // The visible symptom: a card headlined "Out in SF" showing plans 2, 3 and 9
  // WEEKS away while a dozen things were happening in the city that same day.
  out.sort(byWhen);

  // Dedupe AFTER sorting, so a recurring series (e.g. a pumpkin patch listed for
  // four separate weekends) keeps its SOONEST occurrence rather than whichever
  // one the scraper happened to publish first.
  const picked = [];
  for (const ev of out) {
    const key = dedupKey(ev.name);
    if (seen.has(key)) continue;
    if (ev.dayKey && picked.some((p) => p.dayKey === ev.dayKey && sameEvent(p.name, ev.name))) continue;
    seen.add(key);
    picked.push(ev);
  }
  return picked;
}

// Display split of a scraped title into a calm headline + its trailing tags.
// Titles carry their metadata in a final parenthetical — "(SF)", "(2026)",
// "(Summer 2026)", "(Oct. 1-Nov. 1)", "(7p + 9p)", "(Every Saturday)",
// "(Yerba Buena Gardens)" — which read as noise in a two-line clamp. Pure; the
// raw ev.name is untouched (locale ranking + dedupe still read it). Exported for smoke.
//   → { name, time, where, note }  (time/where/note are '' when absent)
const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d/i;
export function splitTitle(raw) {
  let name = tidy(raw).replace(/\s+-\s+\d+\+$/, ''); // "… (Alameda) - 5+" age tag
  let time = '', where = '', note = '';
  for (let i = 0; i < 2; i++) {
    const m = name.match(/\s*\(([^()]{1,40})\)$/);
    if (!m) break;
    const tag = m[1].trim();
    const rest = name.slice(0, m.index).trim();
    if (rest.length < 8) break; // the parenthetical IS the name — leave it
    if (/^(sf|s\.f\.|san francisco)$/i.test(tag)) { /* the card is already "Out in SF" */ }
    else if (/^((spring|summer|fall|autumn|winter)\s+)?20\d\d$/i.test(tag)) { /* year/season */ }
    else if (/^\d{1,2}(:\d\d)?\s*[ap]m?(\s*[+&,/–-]\s*\d{1,2}(:\d\d)?\s*[ap]m?)*$/i.test(tag)) {
      time = tag.replace(/\s+/g, ' ').toUpperCase();
    } else if (/^every\b/i.test(tag)) { note = tag.replace(/^Every/, 'every'); }
    else if (MONTH_RE.test(tag)) {
      // A date run ("Oct. 1-Nov. 1") is worth keeping as "thru …"; a lone date is today.
      const end = tag.split(/\s*[–-]\s*/)[1];
      const mon = (t) => t.replace(/^([a-z]{3})[a-z]*\.?/i, '$1');
      if (end) note = `thru ${mon(/^\d/.test(end) ? tag.match(/^[a-z]+/i)[0] + ' ' + end : end)}`;
    } else if (!where && !/\d/.test(tag)) {
      where = tag.replace(/^(SF|San Francisco)[’']s\s+/i, '');
    } else break;
    name = rest;
  }
  name = name.replace(/^SF[’']s\s+(?=\S)/, '');
  return { name, time, where, note };
}
