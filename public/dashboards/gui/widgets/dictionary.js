// "Dicionário Louise" — a made-up dictionary of our life: the day's entry, big, and
// yesterday's beneath it, smaller (rotating by date; words in love.js).
import { DICTIONARY } from '/dashboards/gui/love.js';

const dayN = (off = 0) => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) + off; };
const pick = (off) => DICTIONARY[((dayN(off) * 5) % DICTIONARY.length + DICTIONARY.length) % DICTIONARY.length];

export default {
  id: 'dictionary',
  title: 'Dicionário Louise',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lv-dc { height:476px; display:flex; flex-direction:column; }
      .lv-dc .e { display:flex; flex-direction:column; gap:10px; }
      .lv-dc .e.big { flex:1; justify-content:center; gap:14px; }
      .lv-dc .e.small { flex:none; padding-top:18px; border-top:1px solid var(--stroke); gap:6px; }
      .lv-dc .hw { display:flex; align-items:baseline; flex-wrap:wrap; column-gap:12px; }
      .lv-dc .w { font-family:var(--font-display); color:#fff; line-height:1; }
      .lv-dc .big .w { font-size:64px; } .lv-dc .small .w { font-size:28px; color:var(--ink); }
      .lv-dc .c { font-size:16px; font-style:italic; color:var(--rose); }
      .lv-dc .p { font-size:15px; color:var(--ink-faint); letter-spacing:.02em; }
      .lv-dc .d { color:var(--ink); line-height:1.38; }
      .lv-dc .big .d { font-size:24px; } .lv-dc .small .d { font-size:16px; color:var(--ink-soft); }
      .lv-dc .v { font-size:15px; font-style:italic; color:var(--ink-faint); }
    `);
    const entry = (x, cls) => ctx.h('div', { class: `e ${cls}` },
      ctx.h('div', { class: 'hw' }, ctx.h('span', { class: 'w' }, x.w), ctx.h('span', { class: 'c' }, x.c), x.p ? ctx.h('span', { class: 'p' }, `/${x.p}/`) : null),
      ctx.h('div', { class: 'd' }, x.d),
      x.v ? ctx.h('div', { class: 'v' }, x.v) : null);
    const render = () => body.replaceChildren(ctx.h('div', { class: 'lv-dc' }, entry(pick(0), 'big'), entry(pick(-1), 'small')));
    render();
    ctx.interval(render, 60 * 60 * 1000);
  },
};
