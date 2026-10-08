// Reasons I love you — five a day, rotating.
import { REASONS, dailyN } from '/dashboards/gui/love.js';

export default {
  id: 'reasons',
  title: 'Reasons I love you',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lv-list { display:flex; flex-direction:column; height:100%; justify-content:space-evenly; }
      .lv-list .r { display:grid; grid-template-columns:34px 1fr; align-items:baseline; padding:10px 0;
        border-bottom:1px solid var(--stroke); }
      .lv-list .r:last-child { border-bottom:none; }
      .lv-list .n { font-family:var(--font-display); font-size:24px; color:var(--rose); }
      .lv-list .t { font-size:18px; line-height:1.3; color:var(--ink); }
    `);
    const render = () => body.replaceChildren(ctx.h('div', { class: 'lv-list' },
      ...dailyN(REASONS, 5, 1).map((t, i) => ctx.h('div', { class: 'r' }, ctx.h('span', { class: 'n' }, String(i + 1)), ctx.h('span', { class: 't' }, t)))));
    render();
    ctx.interval(render, 60 * 60 * 1000);
  },
};
