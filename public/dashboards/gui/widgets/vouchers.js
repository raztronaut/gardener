// "Vales para Louise" — three vouchers a day, side by side, split by perforation
// lines; válidos para sempre (words in love.js).
import { VOUCHERS, TO, dailyN } from '/dashboards/gui/love.js';

const P = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  cup: `<path ${P} d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>`,
  wave: `<path ${P} d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M17 4a3 3 0 1 1-3 3"/>`,
  oven: `<circle ${P} cx="8" cy="13" r="3"/><circle ${P} cx="15.5" cy="11" r="3.5"/><circle ${P} cx="12" cy="17" r="2.5"/>`,
  cake: `<path ${P} d="M4 20h16M5 20v-7h14v7M5 16c2 1 3-1 4.7 0s3 1 4.6 0 3-1 4.7 0M12 13V9M12 6.5a1 1 0 0 1 0-2c.5.6.5 1.4 0 2z"/>`,
  star: `<path ${P} d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/>`,
  music: `<path ${P} d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"/>`,
  moon: `<path ${P} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
  flower: `<circle ${P} cx="12" cy="9" r="2.2"/><path ${P} d="M12 6.8a2.6 2.6 0 1 1 2.1-4.2A2.6 2.6 0 1 1 16.4 7a2.6 2.6 0 1 1-1.3 4.6 2.6 2.6 0 1 1-6.2 0A2.6 2.6 0 1 1 7.6 7a2.6 2.6 0 1 1 2.3-4.4A2.6 2.6 0 0 1 12 6.8M12 11.2V21M12 17c-2.5 0-4-1.5-4.5-3.5 2.5 0 4 1.3 4.5 3.5zM12 15c2.5 0 4-1.5 4.5-3.5-2.5 0-4 1.3-4.5 3.5z"/>`,
  film: `<rect ${P} x="3" y="5" width="18" height="14" rx="2"/><path ${P} d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>`,
  plane: `<path ${P} d="M10.5 13.5 3 11l1.5-1.5 8 .5 4-4.5a2 2 0 0 1 3 3l-4.5 4 .5 8L14 22l-2.5-7.5-3 3V20l-1.5 1-1-3.5L2.5 16l1-1.5h2.5z"/>`,
  phone: `<rect ${P} x="7" y="2.5" width="10" height="19" rx="2.5"/><path ${P} d="M11 18.5h2"/>`,
  hand: `<path ${P} d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V13c0 4.5-2.5 8-6.5 8-2.5 0-4-1.5-5.5-3.5l-2-3a1.5 1.5 0 0 1 2.4-1.8L8 15"/>`,
};

export default {
  id: 'vouchers',
  title: `Vales para ${TO}`,
  size: 'wide',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lv-vc { height:190px; display:grid; grid-template-columns:repeat(3, 1fr); }
      .lv-vc .v { display:flex; flex-direction:column; gap:10px; padding:4px 22px; }
      .lv-vc .v:first-child { padding-left:4px; } .lv-vc .v:last-child { padding-right:4px; }
      .lv-vc .v + .v { border-left:1.5px dashed rgba(255,155,176,.32); }
      .lv-vc .top { display:flex; align-items:center; justify-content:space-between; }
      .lv-vc .ic { display:flex; color:var(--rose); } .lv-vc .ic svg { width:34px; height:34px; }
      .lv-vc .lab { font: 700 12px var(--font); letter-spacing:.2em; color:var(--rose); }
      .lv-vc .t { flex:1; font-size:21px; line-height:1.32; color:var(--ink); }
      .lv-vc .ok { font-size:13px; font-style:italic; color:var(--ink-faint); }
    `);
    const render = () => body.replaceChildren(ctx.h('div', { class: 'lv-vc' },
      ...dailyN(VOUCHERS, 3, 2).map((x) => ctx.h('div', { class: 'v' },
        ctx.h('div', { class: 'top' }, ctx.h('span', { class: 'ic', html: `<svg viewBox="0 0 24 24">${ICON[x.i] || ICON.star}</svg>` }), ctx.h('span', { class: 'lab' }, 'VALE')),
        ctx.h('div', { class: 't' }, x.t),
        ctx.h('div', { class: 'ok' }, 'válido para sempre')))));
    render();
    ctx.interval(render, 60 * 60 * 1000);
  },
};
