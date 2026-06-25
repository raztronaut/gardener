// Arcade + Air — two compact tiles sharing ONE grid cell, to free room on the
// full canvas for the camera. Top half: a compact US-AQI readout. Bottom half: a
// small Arcade launcher (ROM count). Tapping the card (or controller "open")
// delegates to the Arcade picker via the emulator widget's own openFull.
import emulator from './emulator.js';

const CATS = [
  { max: 50, short: 'Good', color: '#74f7b0' },
  { max: 100, short: 'Moderate', color: '#f7d774' },
  { max: 150, short: 'Sensitive', color: '#f7a374' },
  { max: 200, short: 'Unhealthy', color: '#f77474' },
  { max: 300, short: 'Very bad', color: '#c074f7' },
  { max: Infinity, short: 'Hazardous', color: '#f74a74' },
];
const aqiCat = (v) => CATS.find((c) => v <= c.max) || CATS[CATS.length - 1];

export default {
  id: 'mini-duo',
  title: 'Arcade · Air',
  icon: '🎮',
  size: 'md',
  chrome: true,
  // Reuse the Arcade ROM picker as this cell's fullscreen view.
  openFull: emulator.openFull,
  async mount(body, ctx) {
    const { h } = ctx;
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .duo { display:flex; flex-direction:column; height:100%; min-height:0; }
      .duo-aq { flex:1; display:flex; align-items:center; gap:13px; min-height:0; }
      .duo-aq .num { font-family:var(--font-display); font-weight:700; font-size:34px; line-height:.9;
        color:var(--duo-c, var(--ink)); flex:0 0 auto; }
      .duo-aq .meta { display:flex; flex-direction:column; gap:3px; min-width:0; }
      .duo-aq .lbl { font-family:var(--font-mono); font-size:9px; letter-spacing:.14em; color:var(--ink-faint); }
      .duo-aq .cat { font-size:15px; font-weight:700; color:var(--duo-c, var(--ink)); line-height:1;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .duo-aq .pm { margin-left:auto; flex:0 0 auto; text-align:right; }
      .duo-aq .pm .v { font-family:var(--font-mono); font-weight:700; font-size:15px; color:var(--ink); line-height:1; }
      .duo-aq .pm .k { font-family:var(--font-mono); font-size:8.5px; letter-spacing:.1em; color:var(--ink-faint); }
      .duo-div { height:1px; background:var(--stroke); flex:0 0 auto; margin:8px 0; }
      .duo-arc { flex:1; display:flex; align-items:center; gap:13px; min-height:0; }
      .duo-arc .pad { font-size:25px; flex:0 0 auto; filter:drop-shadow(0 0 8px rgba(116,247,176,.35)); }
      .duo-arc .meta { display:flex; flex-direction:column; gap:3px; min-width:0; }
      .duo-arc .t { font-family:var(--font-display); font-weight:700; font-size:16px; color:var(--ink); line-height:1; }
      .duo-arc .s { font-family:var(--font-mono); font-size:10px; letter-spacing:.1em; color:var(--ink-faint); }
      .duo-arc .go { margin-left:auto; flex:0 0 auto; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.12em; color:var(--mint); }
    `);
    body.classList.add('duo');

    const aqEl = h('div', { class: 'duo-aq' }, h('span', { class: 'lbl' }, 'AIR · loading'));
    const arcEl = h('div', { class: 'duo-arc' },
      h('span', { class: 'pad' }, '🎮'),
      h('div', { class: 'meta' }, h('div', { class: 't' }, 'Arcade'), h('div', { class: 's' }, 'loading…')));
    body.replaceChildren(aqEl, h('div', { class: 'duo-div' }), arcEl);

    const loadAq = async () => {
      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
          + `&longitude=${lon}&current=us_aqi,pm2_5&timezone=${encodeURIComponent(tz)}`;
        const d = await ctx.fetchJSON(url);
        const aqi = d && d.current && d.current.us_aqi;
        const pm = d && d.current && d.current.pm2_5;
        if (aqi == null) return;
        const cat = aqiCat(aqi);
        aqEl.style.setProperty('--duo-c', cat.color);
        aqEl.replaceChildren(
          h('div', { class: 'num' }, String(Math.round(aqi))),
          h('div', { class: 'meta' },
            h('div', { class: 'lbl' }, 'US AQI · SF'),
            h('div', { class: 'cat' }, cat.short)),
          h('div', { class: 'pm' },
            h('div', { class: 'v' }, pm == null ? '—' : pm.toFixed(1)),
            h('div', { class: 'k' }, 'PM2.5')));
      } catch { /* keep last */ }
    };
    const loadArc = async () => {
      try {
        const r = await fetch('/api/roms', { cache: 'no-store' });
        const { roms = [] } = await r.json();
        arcEl.replaceChildren(
          h('span', { class: 'pad' }, '🎮'),
          h('div', { class: 'meta' },
            h('div', { class: 't' }, 'Arcade'),
            h('div', { class: 's' }, roms.length ? `${roms.length} game${roms.length === 1 ? '' : 's'}` : 'drop ROMs in data/roms')),
          h('span', { class: 'go' }, roms.length ? 'play ▸' : ''));
      } catch { /* keep last */ }
    };

    loadAq(); loadArc();
    ctx.interval(loadAq, 15 * 60 * 1000);
    ctx.interval(loadArc, 5 * 60 * 1000);
  },
};
