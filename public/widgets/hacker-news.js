// Hacker News — top stories (rank, title, score, comments, source domain) via
// the keyless Firebase API (through the SSRF-safe proxy).
//   https://hacker-news.firebaseio.com/v0/topstories.json -> [id, id, ...]
//   https://hacker-news.firebaseio.com/v0/item/<id>.json   -> { title, score, url, ... }

const TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const COUNT = 2;

function domainOf(url) {
  if (!url) return 'news.ycombinator.com';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
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
  size: 'md',
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
    `);
    body.appendChild(ctx.loading('reading the front page…'));

    const refresh = async () => {
      const ids = await ctx.fetchJSON(TOP);
      if (!Array.isArray(ids) || ids.length === 0) {
        body.replaceChildren(ctx.error('no stories right now'));
        return;
      }
      const top = ids.slice(0, COUNT);
      const stories = await Promise.all(top.map((id) => ctx.fetchJSON(ITEM(id)).catch(() => null)));
      const rows = stories
        .map((s, i) => {
          if (!s || !s.title) return null;
          const score = Number.isFinite(s.score) ? s.score : 0;
          const cmts = Number.isFinite(s.descendants) ? s.descendants : 0;
          const domain = domainOf(s.url);
          const age = ageOf(s.time);
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
                ctx.h('span', { class: 'hn-dot' }, '·'),
                ctx.h('span', { class: 'hn-domain' }, domain || 'news.ycombinator.com'))));
        })
        .filter(Boolean);

      if (rows.length === 0) {
        body.replaceChildren(ctx.error('no stories right now'));
        return;
      }
      body.replaceChildren(ctx.h('div', { class: 'hn' }, ...rows));
    };

    try {
      await refresh();
      ctx.interval(() => refresh().catch(() => {}), 10 * 60 * 1000);
    } catch {
      body.replaceChildren(ctx.error('hacker news unavailable'));
    }
  },
};
