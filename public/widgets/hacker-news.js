// Hacker News — top stories (rank, title, score, comments, source domain) via
// the keyless Firebase API (through the SSRF-safe proxy).
//   https://hacker-news.firebaseio.com/v0/topstories.json -> [id, id, ...]
//   https://hacker-news.firebaseio.com/v0/item/<id>.json   -> { title, score, url, ... }

const TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const COUNT = 4;

function domainOf(url) {
  if (!url) return 'news.ycombinator.com';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Classify a front-page item into an at-a-glance badge. Ask/Show HN are
// title-prefixed self-posts; jobs carry an explicit type. Returns null for a
// plain link story (no badge — the domain already tells that story).
function badgeOf(item) {
  if (item.type === 'job') return { label: 'JOB', kind: 'job' };
  const t = item.title || '';
  if (/^ask hn[:\s]/i.test(t)) return { label: 'ASK', kind: 'ask' };
  if (/^show hn[:\s]/i.test(t)) return { label: 'SHOW', kind: 'show' };
  return null;
}

// "3h", "12m", "2d" — compact age from a unix-seconds timestamp.
function ageOf(unixSecs) {
  if (!Number.isFinite(unixSecs)) return '';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - unixSecs) / 60));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export default {
  id: 'hacker-news',
  title: 'Hacker News',
  icon: '📰',
  size: 'tall', // half width × 2 rows — a roomy front-page feed beside the camera
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .hn { display:flex; flex-direction:column; gap:7px; height:100%; }
      .hn-item { display:flex; gap:12px; align-items:flex-start; flex:1; min-height:0;
        padding:7px 12px; background:rgba(255,255,255,.04);
        border:1px solid var(--stroke); border-radius:16px; }
      .hn-rank { font-family:var(--font-display); font-size:23px; font-weight:700;
        line-height:1; color:var(--mint); min-width:24px; text-align:center; margin-top:1px;
        filter:drop-shadow(0 3px 8px rgba(0,0,0,.4)); }
      .hn-body { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }
      .hn-title { font-size:14.5px; line-height:1.2; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .hn-meta { display:flex; align-items:center; gap:7px; flex-wrap:nowrap;
        min-width:0; overflow:hidden;
        font-family:var(--font-mono); font-size:11.5px; color:var(--ink-faint); }
      .hn-meta > * { flex:0 0 auto; }
      .hn-score { color:var(--gold); font-weight:600; }
      .hn-cmts { color:var(--mint-2); }
      .hn-age { color:var(--ink-soft); }
      .hn-dot { color:var(--ink-faint); opacity:.5; }
      .hn-domain { color:var(--ink-soft); flex:1 1 auto; min-width:0;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
      /* type badge — a compact static pill; colour keys the kind at a glance */
      .hn-badge { font-size:9.5px; font-weight:700; letter-spacing:.08em; line-height:1;
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
      .hn-fallback .hn-fb-sub { font-family:var(--font-mono); font-size:11.5px;
        color:var(--ink-faint); }
    `);
    body.appendChild(ctx.loading('reading the front page…'));

    // Fetch + render. Builds the rows BEFORE touching the DOM and only replaces on
    // success — so a flaky fetch or an empty response keeps the last good front page
    // intact rather than blanking it. Throws on failure so callers can retry.
    const refresh = async () => {
      const ids = await ctx.fetchJSON(TOP);
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('no stories');
      const top = ids.slice(0, COUNT);
      const stories = await Promise.all(top.map((id) => ctx.fetchJSON(ITEM(id)).catch(() => null)));
      const rows = stories
        .map((s, i) => {
          if (!s || !s.title) return null;
          const score = Number.isFinite(s.score) ? s.score : 0;
          const cmts = Number.isFinite(s.descendants) ? s.descendants : 0;
          const badge = badgeOf(s);
          const age = ageOf(s.time);
          const domain = domainOf(s.url);
          // Self-posts (Ask/Show HN, and link-less jobs) always resolve to the
          // HN domain — redundant once the badge is shown, so drop it there.
          const showDomain = !(badge && !s.url);
          return ctx.h('div', { class: 'hn-item' },
            ctx.h('div', { class: 'hn-rank' }, String(i + 1)),
            ctx.h('div', { class: 'hn-body' },
              ctx.h('div', { class: 'hn-title' }, s.title),
              ctx.h('div', { class: 'hn-meta' },
                ctx.h('span', { class: 'hn-score' }, `▲ ${score}`),
                ctx.h('span', { class: 'hn-dot' }, '·'),
                ctx.h('span', { class: 'hn-cmts' }, `💬 ${cmts}`),
                age ? ctx.h('span', { class: 'hn-dot' }, '·') : null,
                age ? ctx.h('span', { class: 'hn-age' }, age) : null,
                badge ? ctx.h('span', { class: `hn-badge ${badge.kind}` }, badge.label) : null,
                showDomain ? ctx.h('span', { class: 'hn-dot' }, '·') : null,
                showDomain ? ctx.h('span', { class: 'hn-domain' }, domain || 'news.ycombinator.com') : null)));
        })
        .filter(Boolean);

      if (rows.length === 0) throw new Error('no renderable stories');
      body.replaceChildren(ctx.h('div', { class: 'hn' }, ...rows));
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
