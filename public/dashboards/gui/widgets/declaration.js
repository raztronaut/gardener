// The day's love declaration to Louise — big, centred, in The Garden face.
import { DECLARATIONS, FROM, TO, daily } from '/dashboards/gui/love.js';

export default {
  id: 'declaration',
  title: `For ${TO}`,
  size: 'hero',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lv-hero { height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;
        text-align:center; gap:22px; padding:10px 34px; }
      .lv-hero .heart { width:44px; height:44px; color:var(--rose); }
      .lv-hero .q { font-family:var(--font-display); font-size:46px; line-height:1.12; color:#fff; text-wrap:balance; }
      .lv-hero .from { font-size:18px; color:var(--rose); letter-spacing:.04em; }
    `);
    const heart = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>';
    const render = () => body.replaceChildren(ctx.h('div', { class: 'lv-hero' },
      ctx.h('div', { class: 'heart', html: heart }),
      ctx.h('div', { class: 'q' }, daily(DECLARATIONS)),
      ctx.h('div', { class: 'from' }, `— ${FROM}`)));
    render();
    ctx.interval(render, 60 * 60 * 1000);
  },
};
