// Little promises — things I'll do for you, three a day.
import { PROMISES, dailyN, TO } from '/dashboards/gui/love.js';

export default {
  id: 'promises',
  title: `Promises to ${TO}`,
  size: 'tall',
  chrome: true,
  frame: false,
  async mount(body, ctx) {
    ctx.style(`
      .lv-pr { display:flex; flex-direction:column; height:100%; justify-content:center; gap:22px; }
      .lv-pr .p { display:flex; gap:14px; align-items:flex-start; font-size:19px; line-height:1.35; color:var(--ink); }
      .lv-pr .dot { flex:none; width:10px; height:10px; margin-top:8px; border-radius:50%; background:var(--rose);
        box-shadow:0 0 12px rgba(255,155,176,.6); }
    `);
    const render = () => body.replaceChildren(ctx.h('div', { class: 'lv-pr' },
      ...dailyN(PROMISES, 3, 2).map((t) => ctx.h('div', { class: 'p' }, ctx.h('span', { class: 'dot' }), t))));
    render();
    ctx.interval(render, 60 * 60 * 1000);
  },
};
