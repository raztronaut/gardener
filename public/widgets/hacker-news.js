let VARIANT_DATA = null;
// Hacker News — top stories (rank, title, score, comments, source domain) via
// the keyless Firebase API (through the SSRF-safe proxy).
//   https://hacker-news.firebaseio.com/v0/topstories.json -> [id, id, ...]
//   https://hacker-news.firebaseio.com/v0/item/<id>.json   -> { title, score, url, ... }

const TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const COUNT = 4;
// Fetch a buffer beyond COUNT so profane/flagged titles can be skipped while
// still filling the card with clean stories.
const FETCH = 12;

// Profanity / offensive-content guard. This is an unattended WALL display, so a
// single crude front-page title (HN occasionally surfaces one) is unacceptable.
// We DROP any story whose title trips the filter rather than censor-in-place —
// cleaner for an ambient feed. Word-boundary matched, case-insensitive, and
// tolerant of common leet/spacing obfuscation (f u c k, f*ck, sh1t).
const BAD_WORDS = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'dick', 'piss',
  'cock', 'pussy', 'slut', 'whore', 'nigger', 'faggot', 'retard', 'wank',
  'jerk off', 'jack off', 'blowjob', 'cum', 'porn', 'rape', 'nazi',
];
export function isClean(title) {
  if (!title) return true;
  // Normalise: lowercase, map common leet substitutions, collapse separators
  // between letters (f-u-c-k, f*ck, f u c k) so obfuscated forms are caught.
  const norm = String(title)
    .toLowerCase()
    .replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o').replace(/3/g, 'e')
    .replace(/[^a-z ]+/g, '')       // drop punctuation used to break up words
    .replace(/\s+/g, ' ');
  const squished = norm.replace(/ /g, ''); // catches "f u c k" style spacing
  // Vowel-agnostic form: drops vowels from both the text and each bad word so
  // asterisk/vowel-censored spellings (f*ck → "fck", sh!t → "sht") still match.
  const devowel = (s) => s.replace(/[aeiou]/g, '');
  const squishedNV = devowel(squished);
  return !BAD_WORDS.some((w) => {
    const bare = w.replace(/ /g, '');
    const re = new RegExp(`\\b${bare}\\b`);
    if (re.test(norm) || squished.includes(bare)) return true;
    // Only apply the vowel-agnostic pass to stems long enough that dropping
    // vowels won't collide with common words (≥4 letters, ≥2 consonants).
    const nv = devowel(bare);
    return nv.length >= 3 && bare.length >= 4 && squishedNV.includes(nv);
  });
}

function domainOf(url) {
  if (!url) return 'news.ycombinator.com';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Classify a front-page item into an at-a-glance badge. Ask/Show HN are
// title-prefixed self-posts; jobs carry an explicit type. Returns null for a
// plain link story (no badge — the domain already tells that story).
export function badgeOf(item) {
  if (item.type === 'job') return { label: 'JOB', kind: 'job' };
  const t = item.title || '';
  if (/^ask hn[:\s]/i.test(t)) return { label: 'ASK', kind: 'ask' };
  if (/^show hn[:\s]/i.test(t)) return { label: 'SHOW', kind: 'show' };
  return null;
}

// "3h", "12m", "2d" — compact age from a unix-seconds timestamp.
export function ageOf(unixSecs) {
  if (!Number.isFinite(unixSecs)) return '';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - unixSecs) / 60));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

// Momentum: is this a genuinely fast-CLIMBING story right now? Derived purely
// from the score + age we already have (no extra API). We flag only recent
// items (≤12h old) accruing points quickly — the ambient "what's hot this hour"
// signal a wall feed wants — while ignoring old stories that merely amassed a
// big total slowly. Returns points-per-hour when rising, else 0.
export function risingRate(item) {
  const t = item.time, score = Number.isFinite(item.score) ? item.score : 0;
  if (!Number.isFinite(t) || score <= 0) return 0;
  const hrs = (Date.now() / 1000 - t) / 3600;
  if (hrs > 12) return 0;                 // only fresh stories can be "climbing"
  const pph = score / Math.max(hrs, 0.5); // floor age so brand-new posts don't spike
  return pph >= 100 ? Math.round(pph) : 0;
}

// Discussion pulse: is the front page ARGUING about this one? Derived purely from
// the score + comment count we already have (no extra API). On HN a comment count
// that rivals or exceeds a story's upvotes marks a genuinely lively debate — a
// useful ambient "big conversation here" cue that complements the 🔥 fast-rising
// signal (surging) with a distinct 🗣 signal (contested). Conservative thresholds
// keep it quiet on ordinary stories: a real crowd must be talking (≥80 comments)
// AND the comments must rival the upvotes. Returns the comment count when the
// story qualifies, else 0.
function debateRate(item) {
  const score = Number.isFinite(item.score) ? item.score : 0;
  const cmts = Number.isFinite(item.descendants) ? item.descendants : 0;
  if (cmts < 80) return 0;          // needs a real crowd in the thread
  if (cmts < score * 0.9) return 0; // comments must rival the upvotes
  return cmts;
}
export { debateRate };

// Board-rank movement across refreshes — a gentle "living front page" cue. Compares
// a story's CURRENT position on the shown board against where it sat on the PREVIOUS
// refresh. Only RISERS are surfaced: a story climbing the front page is the
// interesting, positive signal on an ambient wall, while a story that merely held or
// slipped gets no marker, keeping the feed calm. A story that wasn't on the board
// last time reads as a fresh arrival ('new'). `prevRank` is the story's 0-based index
// last refresh, or null/undefined if it wasn't shown then. Returns
// { kind:'new' } | { kind:'up', delta } | null.
export function rankMovement(prevRank, curRank) {
  if (prevRank == null) return { kind: 'new' };
  if (Number.isFinite(prevRank) && prevRank > curRank) return { kind: 'up', delta: prevRank - curRank };
  return null;
}

export default {
  getVariantData: () => VARIANT_DATA,
  id: 'hacker-news',
  title: 'Hacker News',
  icon: '📰',
  size: 'tall', // half width × 2 rows — a roomy front-page feed beside the APOD photo
  chrome: true,
  frame: false, // zigzag of open cards (2026-10-06)
  async mount(body, ctx) {
    ctx.style(`
      .hn { display:flex; flex-direction:column; gap:0; height:100%; overflow:hidden; }
      /* Rows grow to share the card but NEVER shrink below their content — a
         two-line title used to squeeze its meta line out past the row's border.
         If the stories don't all fit, fitRows() drops the last one instead. */
      .hn-item { position:relative; display:flex; gap:12px; align-items:center; flex:1 0 auto;
        padding:6px 0; background:none; border:none; border-radius:0;
        border-bottom:1px solid var(--stroke); }
      /* open card (2026-10-06): no boxed rows — hairline dividers like Out in SF */
      .hn-item:last-child { border-bottom:none; }
      /* rank column — the big mint number */
      .hn-rank { display:flex; flex-direction:column; align-items:center; gap:3px;
        min-width:28px; margin-top:1px; }
      .hn-rank .n { font-family:var(--font-display); font-size:26px; font-weight:700;
        line-height:1; color:var(--mint); filter:drop-shadow(0 3px 8px rgba(0,0,0,.4)); }
      .hn-body { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }
      .hn-title { font-size:18px; line-height:1.2; font-weight:500; letter-spacing:-.005em; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .hn-meta { display:flex; align-items:center; gap:7px; flex-wrap:nowrap;
        min-width:0; overflow:hidden;
        font-family:var(--font-mono); font-size:13px; color:var(--ink-faint); }
      .hn-meta > * { flex:0 0 auto; }
      .hn-score { color:var(--gold); font-weight:600; }
      .hn-dot { color:var(--ink-faint); opacity:.5; }
      .hn-domain { color:var(--ink-soft); flex:1 1 auto; min-width:0;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
      /* type badge — a compact static pill; colour keys the kind at a glance */
      .hn-badge { font-size:11.5px; font-weight:700; letter-spacing:.08em; line-height:1;
        padding:2.5px 5px; border-radius:6px; border:1px solid currentColor; }
      .hn-badge.ask { color:var(--gold); }
      .hn-badge.show { color:var(--mint); }
      .hn-badge.job { color:var(--mint-2); }
      /* graceful fallback — fills the tall card so a network miss never leaves
         a large empty black region; static, no animation. */
      .hn-fallback { display:flex; flex-direction:column; align-items:center;
        justify-content:center; gap:10px; height:100%; text-align:center;
        color:var(--ink-soft); }
      .hn-fallback .hn-fb-icon { font-size:40px; opacity:.55; line-height:1; }
      .hn-fallback .hn-fb-msg { font-size:15px; color:var(--ink); }
      .hn-fallback .hn-fb-sub { font-family:var(--font-mono); font-size:13px;
        color:var(--ink-faint); }
    `);
    body.appendChild(ctx.loading('reading the front page…'));

    // Keep every row whole: while the board's content is taller than the card
    // gives it, drop the lowest story (never below 2). Whole stories beat a
    // clipped meta line on a wall read from across the room.
    const fitRows = (board) => {
      if (!board.isConnected || board.clientHeight === 0) return;
      while (board.children.length > 2 && board.scrollHeight > board.clientHeight + 1) {
        board.lastElementChild.remove();
      }
    };

    // Fetch + render. Builds the rows BEFORE touching the DOM and only replaces on
    // success — so a flaky fetch or an empty response keeps the last good front page
    // intact rather than blanking it. Throws on failure so callers can retry.
    const refresh = async () => {
      const ids = await ctx.fetchJSON(TOP);
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('no stories');
      // Pull a buffer of stories, then keep only clean, renderable ones and take
      // the top COUNT — so a crude/flagged title is skipped, not shown.
      const top = ids.slice(0, FETCH);
      const fetched = await Promise.all(top.map((id) => ctx.fetchJSON(ITEM(id)).catch(() => null)));
      VARIANT_DATA = fetched.filter(s => s && s.title && isClean(s.title));
      const stories = VARIANT_DATA.slice(0, COUNT);
      // Calm tile (2026-11-01 prune): rank, title and ONE quiet line — the score
      // and where it's from (or the ASK/SHOW/JOB kind). Comments, age, the 🔥/🗣
      // cues and rank movement live in the fullscreen front page (app.js).
      const rows = stories
        .map((s, i) => {
          if (!s || !s.title) return null;
          const score = Number.isFinite(s.score) ? s.score : 0;
          const badge = badgeOf(s);
          const domain = domainOf(s.url);
          // Self-posts (Ask/Show HN, and link-less jobs) always resolve to the
          // HN domain — redundant once the badge is shown, so drop it there.
          const showDomain = !(badge && !s.url);
          return ctx.h('div', { class: 'hn-item' },
            ctx.h('div', { class: 'hn-rank' },
              ctx.h('div', { class: 'n' }, String(i + 1))),
            ctx.h('div', { class: 'hn-body' },
              ctx.h('div', { class: 'hn-title' }, s.title),
              ctx.h('div', { class: 'hn-meta' },
                ctx.h('span', { class: 'hn-score' }, `▲ ${score}`),
                badge ? ctx.h('span', { class: 'hn-dot' }, '·') : null,
                badge ? ctx.h('span', { class: `hn-badge ${badge.kind}` }, badge.label) : null,
                showDomain ? ctx.h('span', { class: 'hn-dot' }, '·') : null,
                showDomain ? ctx.h('span', { class: 'hn-domain' }, domain || 'news.ycombinator.com') : null)));
        })
        .filter(Boolean);

      if (rows.length === 0) throw new Error('no renderable stories');
      const board = ctx.h('div', { class: 'hn' }, ...rows);
      body.replaceChildren(board);
      fitRows(board);
      // Webfonts can land after first paint and re-wrap titles — re-check once.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitRows(board)).catch(() => {});
    };

    // Initial load: a few attempts with short backoff so one slow/aborted response
    // doesn't drop the widget to an error for a whole refresh cycle.
    let loaded = false;
    for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
      try { await refresh(); loaded = true; }
      catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt)); }
    }
    // If the initial load never succeeded, show a self-contained fallback that
    // FILLS the tall card (icon + message) rather than a bare error line that
    // leaves a large empty black region. The steady refresh below keeps trying.
    if (!loaded) {
      body.replaceChildren(
        ctx.h('div', { class: 'hn-fallback' },
          ctx.h('div', { class: 'hn-fb-icon' }, '📰'),
          ctx.h('div', { class: 'hn-fb-msg' }, 'Front page is quiet'),
          ctx.h('div', { class: 'hn-fb-sub' }, 'reconnecting to Hacker News…')));
    }
    // Steady refresh; on failure KEEP the last good front page (don't blank).
    ctx.interval(() => refresh().catch(() => {}), 10 * 60 * 1000);
  },
};
