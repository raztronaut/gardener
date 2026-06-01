// Hacker News — top stories (rank, title, score, comments, source domain) via
// the keyless Firebase API (through the SSRF-safe proxy).
//   https://hacker-news.firebaseio.com/v0/topstories.json -> [id, id, ...]
//   https://hacker-news.firebaseio.com/v0/item/<id>.json   -> { title, score, url, ... }

const TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const COUNT = 5;

function domainOf(url) {
  if (!url) return 'news.ycombinator.com';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export default {
  id: 'hacker-news',
  title: 'Hacker News',
  icon: '📰',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .hn { display:flex; flex-direction:column; gap:8px; height:100%; }
      .hn-item { display:flex; gap:13px; align-items:flex-start; flex:1;
        padding:9px 13px; background:rgba(255,255,255,.04);
        border:1px solid var(--stroke); border-radius:16px; }
      .hn-rank { font-family:var(--font-display); font-size:25px; font-weight:700;
        line-height:1; color:var(--mint); min-width:26px; text-align:center; margin-top:1px;
        filter:drop-shadow(0 3px 8px rgba(0,0,0,.4)); }
      .hn-body { display:flex; flex-direction:column; gap:5px; min-width:0; flex:1; }
      .hn-title { font-size:16px; line-height:1.25; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .hn-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); }
      .hn-score { color:var(--gold); font-weight:600; }
      .hn-cmts { color:var(--mint-2); }
      .hn-dot { color:var(--ink-faint); opacity:.5; }
      .hn-domain { color:var(--ink-soft);
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
          return ctx.h('div', { class: 'hn-item' },
            ctx.h('div', { class: 'hn-rank' }, String(i + 1)),
            ctx.h('div', { class: 'hn-body' },
              ctx.h('div', { class: 'hn-title' }, s.title),
              ctx.h('div', { class: 'hn-meta' },
                ctx.h('span', { class: 'hn-score' }, `▲ ${score}`),
                ctx.h('span', { class: 'hn-dot' }, '·'),
                ctx.h('span', { class: 'hn-cmts' }, `💬 ${cmts}`),
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
