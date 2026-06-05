// Colyap — a small tribute pane. Requested by the humans: "talk about colyap in a
// pane and the value it creates… and the genius of Piyush." Colyap (colyap.com) is
// an AI phone-friend you can just *yap* to — the one on the other side who remembers
// everything and keeps it to itself. A product of Alchemy Labs (Phoenix · SF),
// created by Piyush. Static content (no network), so it's free to render.
export default {
  id: 'colyap',
  title: 'Colyap',
  icon: '🗣️',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .cy { display:flex; flex-direction:column; gap:8px; height:100%; }
      .cy-top { display:flex; align-items:center; gap:9px; }
      .cy-glyph { font-size:24px; line-height:1; }
      .cy-dom { font-family:var(--font-mono); font-size:11px; letter-spacing:.05em; color:var(--mint); }
      .cy-lead { font-size:14.5px; line-height:1.3; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .cy-lead b { color:var(--mint); font-weight:700; }
      .cy-by { margin-top:auto; padding-top:4px; font-size:12px; line-height:1.36; color:var(--ink-faint); }
      .cy-by b { color:var(--gold); font-weight:700; }
    `);

    const h = ctx.h;
    body.replaceChildren(h('div', { class: 'cy' },
      h('div', { class: 'cy-top' },
        h('span', { class: 'cy-glyph' }, '🗣️'),
        h('span', { class: 'cy-dom' }, 'colyap.com')),
      h('div', { class: 'cy-lead' },
        'An AI phone-friend you can just ', h('b', {}, 'yap'),
        ' to — remembers everything, keeps it to itself. A judgment-free place to think out loud, in total privacy.'),
      h('div', { class: 'cy-by' },
        'Alchemy Labs · Phoenix · SF — the genius of ',
        h('b', {}, 'Piyush'), '.')));
  },
};
