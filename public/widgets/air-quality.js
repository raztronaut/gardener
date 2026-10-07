// Air Quality — a compact square tile: the US AQI reading, its category, and PM2.5.
// Keyless Open-Meteo air-quality API (through the proxy). Sized 'sq' (quarter-width
// square) so two small tiles fit where one half-width card used to.
// Each band carries a short, plain-English health cue — genuinely useful on an
// ambient wall during SF's summer/fall wildfire-smoke spells, not just a number.
const CATS = [
  { max: 50, short: 'Good', color: '#74f7b0', tip: 'Fresh air — enjoy the outdoors' },
  { max: 100, short: 'Moderate', color: '#f7d774', tip: 'Fine for most; sensitive folks take note' },
  { max: 150, short: 'Sensitive', color: '#f7a374', tip: 'Sensitive groups should ease up outside' },
  { max: 200, short: 'Unhealthy', color: '#f77474', tip: 'Limit prolonged time outdoors' },
  { max: 300, short: 'Very bad', color: '#c074f7', tip: 'Avoid outdoor exertion' },
  { max: Infinity, short: 'Hazardous', color: '#f74a74', tip: 'Stay indoors; keep windows shut' },
];
const aqiCat = (v) => CATS.find((c) => v <= c.max) || CATS[CATS.length - 1];

// The US AQI is, by definition, the WORST of several per-pollutant sub-indices.
// Naming that driver turns a bare number into a story: high PM2.5 means wildfire
// smoke, high ozone means a hot smoggy afternoon — a meaningful distinction in SF.
// Open-Meteo exposes each pollutant's own US-AQI, so the dominant one is just the max.
const POLLUTANTS = [
  { key: 'us_aqi_pm2_5', label: 'PM2.5' },
  { key: 'us_aqi_pm10', label: 'PM10' },
  { key: 'us_aqi_ozone', label: 'O₃' },
  { key: 'us_aqi_nitrogen_dioxide', label: 'NO₂' },
  { key: 'us_aqi_sulphur_dioxide', label: 'SO₂' },
  { key: 'us_aqi_carbon_monoxide', label: 'CO' },
];
function dominant(cur) {
  let best = null;
  for (const p of POLLUTANTS) {
    const v = cur && cur[p.key];
    if (Number.isFinite(v) && (!best || v > best.val)) best = { label: p.label, val: v };
  }
  return best;
}

// The hourly US-AQI series is local to the requested tz. Find the index of the
// entry for the current tz-local DATE and hour, so both the trend and the
// forecast peak start from the present moment. This is date-aware (not just
// hour-matched) so it stays correct even when the series carries past days —
// otherwise a bare hour match would land on YESTERDAY's same hour. Falls back to
// a plain hour match, then the series start, if the date prefix isn't found.
function nowIndex(times, tz) {
  if (!Array.isArray(times)) return 0;
  if (tz) {
    try {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date());
      const g = (t) => p.find((x) => x.type === t)?.value;
      const prefix = `${g('year')}-${g('month')}-${g('day')}T${g('hour')}`;
      const j = times.findIndex((t) => typeof t === 'string' && t.startsWith(prefix));
      if (j >= 0) return j;
    } catch { /* fall through to hour match */ }
  }
  const nowH = new Date().getHours();
  const i = times.findIndex((t) => new Date(t).getHours() === nowH);
  return i < 0 ? 0 : i;
}

// How today's air compares to the SAME HOUR yesterday — a genuinely SF-useful
// read during fire season, distinct from the short-term "next 6h" trend. Reads
// the past day from the hourly series (24 entries back from "now") and reports a
// meaningful shift only (≥10 AQI), so the tile stays calm on steady days and
// speaks up when the smoke actually thickened or cleared overnight. Returns
// { word, arrow, color, delta } or null.
function vsYesterday(hourly, current, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  const y = vals[i - 24];
  if (!Number.isFinite(current) || !Number.isFinite(y)) return null;
  const delta = Math.round(current - y);
  if (Math.abs(delta) < 10) return null;
  return delta < 0
    ? { word: 'Clearer than yesterday', arrow: '↓', color: '#74f7b0', delta: -delta }
    : { word: 'Hazier than yesterday', arrow: '↑', color: '#f7a374', delta };
}

// Trend over the next ~6h from the hourly US-AQI series. Semantic colours: air
// getting cleaner reads mint (down = good for pollution), worsening reads rose,
// steady stays quiet. Returns null when there isn't enough data to be honest.
// (We fetch 2 forecast days so this lookahead stays valid late in the evening,
// when a single-day series would run off its end and silently drop the arrow.)
function aqiTrend(hourly, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  const cur = vals[i];
  const ahead = vals[i + 6];
  if (!Number.isFinite(cur) || !Number.isFinite(ahead)) return null;
  const diff = ahead - cur;
  if (diff <= -8) return { arrow: '↘', color: '#74f7b0', label: 'easing' };
  if (diff >= 8) return { arrow: '↗', color: '#f7a374', label: 'rising' };
  return { arrow: '→', color: 'var(--ink-faint)', label: 'steady' };
}

// The worst AQI coming over the next ~12h, with the hour it lands. Lets the tile
// hint — with a quiet ghost tick on the scale — how far the air is expected to
// climb before the day is out; genuinely useful when SF smoke is building.
// Returns null without enough data to be honest.
function aqiPeak(hourly, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  let peak = -Infinity, peakIdx = -1;
  for (let j = i; j < Math.min(i + 12, vals.length); j++) {
    if (Number.isFinite(vals[j]) && vals[j] > peak) { peak = vals[j]; peakIdx = j; }
  }
  if (peakIdx < 0) return null;
  return { val: peak, hour: new Date(times[peakIdx]).getHours() };
}

// The next 12 hours of US AQI from the hourly series, for the tile's little
// outlook strip. Returns [{ v, hour }] (finite readings only) or null.
function aqiOutlook(hourly, tz) {
  const times = hourly && hourly.time;
  const vals = hourly && hourly.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(vals)) return null;
  const i = nowIndex(times, tz);
  const out = [];
  for (let j = i; j < Math.min(i + 12, vals.length); j++) {
    if (Number.isFinite(vals[j])) out.push({ v: vals[j], hour: Number(String(times[j]).slice(11, 13)) });
  }
  return out.length >= 6 ? out : null;
}

export default {
  id: 'air-quality',
  title: 'Air',
  icon: '🌬',
  size: 'md', // half width — shares the top row with the clock (Arcade moved off-grid 2026-10-01)
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    const { lat = 37.7577, lon = -122.4727, tz = 'America/Los_Angeles' } = ctx.config || {};
    ctx.style(`
      .aqs { display:flex; flex-direction:column; justify-content:center; gap:5px; height:100%; min-height:0; }
      .aqs > * { flex-shrink:0; }
      .aqs .numrow { display:flex; align-items:baseline; gap:8px; }
      .aqs .numrow .pm { margin-left:auto; min-width:0; }
      .aqs .num { font-family:var(--font-display); font-weight:700; font-size:40px; line-height:.85;
        color:var(--aqs-c, var(--ink)); }
      /* trend arrow beside the number — glanceable sense of where the air is headed */
      .aqs .trend { display:inline-flex; align-items:baseline; gap:3px; line-height:1; }
      .aqs .trend .ar { font-size:22px; font-weight:700; color:var(--ink-faint); }
      .aqs .trend .tl { font-family:var(--font-mono); font-size:11.5px; letter-spacing:.05em;
        color:var(--ink-faint); text-transform:lowercase; }
      .aqs .cat { font-size:14px; font-weight:700; color:var(--aqs-c, var(--ink)); line-height:1;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* quiet health cue under the category — clamped to 2 lines so it never
         pushes the scale/PM rows out of the small square tile. */
      .aqs .tip { font-size:12.5px; line-height:1.28; color:var(--ink-soft); margin-top:-1px;
        display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
      /* "vs. yesterday" cue — a compact coloured line that sits ABOVE the health
         tip only when the air shifted notably from the same hour yesterday. When
         it shows, the tip below drops to a single line (.one), so the two together
         occupy the SAME two-line box the tip used alone — no added height, no clip.
         A mint ↓ reads "cleared overnight"; a warm ↑ reads "smokier than yesterday". */
      .aqs .vsy { font-size:12.5px; line-height:1.28; font-weight:700; letter-spacing:.01em;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex;
        align-items:baseline; gap:4px; }
      .aqs .vsy .ar { font-weight:700; flex:0 0 auto; }
      .aqs .tip.one { -webkit-line-clamp:1; }
      /* static gradient AQI scale (0→300+) with a marker showing today's position —
         a glanceable sense of how close we are to unhealthy. No animation. */
      .aqs .scale { position:relative; height:6px; border-radius:3px; margin:3px 0 2px;
        background:linear-gradient(90deg,
          #74f7b0 0%, #74f7b0 13%,
          #f7d774 21%, #f7d774 30%,
          #f7a374 41%, #f7a374 47%,
          #f77474 57%, #f77474 64%,
          #c074f7 80%, #c074f7 88%,
          #f74a74 100%); }
      .aqs .scale .mark { position:absolute; top:-3px; width:3px; height:12px; border-radius:2px;
        background:#fff; box-shadow:0 0 4px rgba(0,0,0,.65); transform:translateX(-50%); }
      /* forecast-peak tick — where today's air is headed at its worst. Slimmer,
         hollow-feeling and tinted to the peak's own category so it reads as a
         quiet "later" marker distinct from the solid white "now" tick. Sits
         inside the bar's bounds, adding no height. */
      .aqs .scale .peak { position:absolute; top:-2px; width:2px; height:10px; border-radius:2px;
        background:var(--aqs-peak, #fff); opacity:.9; transform:translateX(-50%);
        box-shadow:0 0 5px var(--aqs-peak, rgba(255,255,255,.7)); }
      .aqs .scale .peak::after { content:''; position:absolute; left:50%; top:-4px;
        width:5px; height:5px; border-radius:50%; transform:translateX(-50%);
        background:var(--aqs-peak, #fff); box-shadow:0 0 5px var(--aqs-peak, rgba(255,255,255,.7)); }
      /* footer: PM2.5 concentration, plus a quiet tag naming the pollutant that
         actually drives today's reading — but only when it ISN'T PM2.5, so the line
         stays calm on ordinary days and speaks up only when there's a reason to. */
      .aqs .pm { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint);
        letter-spacing:.06em; display:flex; align-items:baseline; gap:6px; white-space:nowrap;
        overflow:hidden; text-overflow:ellipsis; }
      .aqs .pm .lead { color:var(--aqs-c, var(--ink-soft)); font-weight:700; letter-spacing:.04em; flex:0 0 auto; }
      .aqs .pm .val { overflow:hidden; text-overflow:ellipsis; }
      /* Next-12h outlook — a row of slim hour columns, each tinted to its AQI
         band and scaled to its value, so "will it get smoky tonight?" reads at a
         glance. Static, no animation; hour ticks sit beneath every few columns. */
      .aqs .ol { display:grid; grid-template-columns:auto 1fr; column-gap:10px; align-items:end; margin-top:2px; }
      .aqs .ol .k { font-family:var(--font-mono); font-size:11.5px; letter-spacing:.1em; color:var(--ink-faint);
        text-transform:uppercase; line-height:1; padding-bottom:0; white-space:nowrap; }
      .aqs .ol .bars { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:3px; align-items:end; height:16px; }
      .aqs .ol .b { border-radius:2px 2px 1px 1px; min-height:3px; opacity:.85; }
      .aqs .ol .b:first-child { opacity:1; }
      .aqs .ol .hrs { grid-column:2; display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:3px; margin-top:4px; }
      .aqs .ol .hrs span { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); line-height:1;
        white-space:nowrap; overflow:visible; }
    `);
    // Build the 12h outlook strip (or null when the hourly series is missing).
    // Column height is scaled against max(150, the window's peak) so a calm day
    // reads as low, even columns rather than exaggerated noise.
    const outlookEl = (ol, hr12) => {
      if (!ol) return null;
      const top = Math.max(150, ...ol.map((o) => o.v));
      return h('div', { class: 'ol', title: 'US AQI · next 12 hours' },
        h('div', { class: 'k' }, '12h'),
        h('div', { class: 'bars' }, ...ol.map((o) => h('div', {
          class: 'b',
          title: `${hr12(o.hour)} · AQI ${Math.round(o.v)} (${aqiCat(o.v).short})`,
          style: { height: `${Math.max(20, Math.round((o.v / top) * 100))}%`, background: aqiCat(o.v).color },
        }))),
        h('div', { class: 'hrs' }, ...ol.map((o, k) => h('span', {},
          k === 0 ? 'now' : (k % 3 === 0 ? hr12(o.hour) : '')))));
    };
    body.classList.add('aqs');
    body.appendChild(ctx.loading('air…'));

    const render = async ({ retry = false } = {}) => {
      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}`
          + `&longitude=${lon}&current=us_aqi,pm2_5,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,`
          + `us_aqi_nitrogen_dioxide,us_aqi_sulphur_dioxide,us_aqi_carbon_monoxide`
          + `&hourly=us_aqi&forecast_days=2&past_days=1`
          + `&timezone=${encodeURIComponent(tz)}`;
        const d = await ctx.fetchJSON(url);
        const aqi = d && d.current && d.current.us_aqi;
        const pm = d && d.current && d.current.pm2_5;
        if (aqi == null) {
          if (retry) throw new Error('no reading');
          if (!body.dataset.loaded) body.replaceChildren(ctx.error('no reading'));
          return;
        }
        const cat = aqiCat(aqi);
        body.style.setProperty('--aqs-c', cat.color);
        // Position on a 0–300 scale, clamped just inside the bar's edges.
        const posOf = (v) => Math.max(2, Math.min(98, (Math.min(v, 300) / 300) * 100));
        const pos = posOf(aqi);
        const trend = aqiTrend(d.hourly, tz);
        // Forecast peak: only surfaced when the air is expected to climb a full
        // category-ish step (≥15 AQI) above now — so the tile stays calm on
        // steady days and speaks up only when there's a reason to.
        const peak = aqiPeak(d.hourly, tz);
        const showPeak = peak && peak.val - aqi >= 15;
        if (showPeak) body.style.setProperty('--aqs-peak', aqiCat(peak.val).color);
        // How the air compares to the same hour yesterday (overnight shift). Shown
        // above the health tip only when it moved notably; the tip then drops to a
        // single line so the pair keeps the tip's original two-line footprint.
        const vsy = vsYesterday(d.hourly, aqi, tz);
        const hr12 = (hh) => `${((hh + 11) % 12) + 1}${hh < 12 ? 'a' : 'p'}`;
        // Which pollutant is driving the AQI? Only surfaced when it's NOT PM2.5
        // (which is already shown) and the air is at least worth a glance.
        const lead = dominant(d.current);
        const showLead = lead && lead.label !== 'PM2.5' && aqi >= 40;
        const numrow = h('div', { class: 'numrow' }, h('div', { class: 'num' }, String(Math.round(aqi))));
        const pmEl = h('div', {
            class: 'pm',
            title: showLead
              ? `${lead.label} is the main pollutant today · PM2.5 ${pm == null ? '—' : pm.toFixed(1)} µg/m³`
              : 'PM2.5 · fine particulate (µg/m³)',
          },
            showLead ? h('span', { class: 'lead' }, `${lead.label} lead`) : null,
            h('span', { class: 'val' }, pm == null ? 'PM2.5 —' : `PM2.5 ${pm.toFixed(1)}`));
        if (trend) {
          numrow.appendChild(h('div', {
            class: 'trend',
            title: `Air quality ${trend.label} over the next 6 hours`,
          }, h('span', { class: 'ar', style: { color: trend.color } }, trend.arrow),
            h('span', { class: 'tl' }, trend.label)));
        }
        numrow.appendChild(pmEl);
        // NOTE: native Node.replaceChildren coerces a null argument to the text
        // node "null" (unlike ctx.h, which drops null children). So build the
        // top-level children as an array and filter falsy entries out — otherwise
        // the calm-air day (no "vs. yesterday" cue) prints a stray "null" line.
        body.replaceChildren(...[
          numrow,
          h('div', { class: 'cat', title: 'US AQI · SF' }, cat.short),
          vsy ? h('div', {
            class: 'vsy',
            style: { color: vsy.color },
            title: `AQI ${Math.round(aqi)} now vs ~${Math.round(aqi - (vsy.arrow === '↓' ? -vsy.delta : vsy.delta))} at this hour yesterday`,
          }, h('span', { class: 'ar' }, vsy.arrow), `${vsy.word} (${vsy.delta})`) : null,
          h('div', { class: `tip${vsy ? ' one' : ''}`, title: cat.tip }, cat.tip),
          h('div', {
            class: 'scale',
            title: showPeak
              ? `AQI ${Math.round(aqi)} now · up to ~${Math.round(peak.val)} by ${hr12(peak.hour)} (${aqiCat(peak.val).short})`
              : 'AQI 0–300+ scale',
          },
            showPeak ? h('div', {
              class: 'peak',
              style: { left: `${posOf(peak.val)}%` },
            }) : null,
            h('div', { class: 'mark', style: { left: `${pos}%` } })),
          // (12-hour outlook bars removed 2026-10-07 at the humans' request)
        ].filter(Boolean));
        body.dataset.loaded = '1';
      } catch (e) {
        if (retry) throw e;
        if (!body.dataset.loaded) body.replaceChildren(ctx.error('air unavailable'));
      }
    };
    // Initial load: a few attempts with short backoff so one slow/aborted response
    // doesn't drop the tile to an error for a whole 15-minute refresh cycle.
    (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await render({ retry: true }); return; }
        catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt)); }
      }
      if (!body.dataset.loaded) body.replaceChildren(ctx.error('air unavailable'));
    })();
    // Steady refresh; on failure KEEP the last good reading (don't blank). The
    // initial load above already fetched, so skip this interval's immediate tick.
    let firstTick = true;
    ctx.interval(() => {
      if (firstTick) { firstTick = false; return; }
      render().catch(() => {});
    }, 15 * 60 * 1000);
  },
};
