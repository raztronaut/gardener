// Seismic — "has the ground moved?", the most San Franciscan ambient fact there is.
//
// Source: USGS FDSN event service (earthquake.usgs.gov) — keyless, public, the
// authoritative feed. One request per refresh returns every earthquake of M1.5+
// within 300 km of the house over the past 7 days, newest first.
//
// The card tells a three-beat story, quietly:
//   1. THE LAST SHAKE — magnitude (coloured by band), where it was, how long ago,
//      how far/which way from here, how deep, and — the human detail — how many
//      people filed a "did you feel it?" report.
//   2. THE WEEK'S BIGGEST — one hushed line, shown only when it isn't the same
//      event, so a slept-through jolt still surfaces.
//   3. A 7-DAY DOT STRIP — every tremor as a dot, placed by time and sized/coloured
//      by magnitude. Static (no animation), so it costs nothing on the kiosk, but
//      it answers "is the ground restless this week?" from across the room.
// On a genuinely still week it says so, warmly, rather than showing an error.

const SF_LAT = 37.7577, SF_LON = -122.4727;
const RADIUS_KM = 300;            // Bay Area + Geysers + Monterey + the Delta
const MIN_MAG = 1.5;              // below this is instrument-only noise
const DAYS = 7;
const RAD = Math.PI / 180;
const R_MI = 3958.8;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Magnitude bands. Colour carries the meaning: sub-2 tremors are almost invisible
// (they should be — nobody felt them), a light quake glows mint, and anything
// moderate/strong escalates to gold then rose. Keeps a still week visually calm.
const BANDS = [
  { max: 2, label: 'micro', color: 'var(--ink-faint)' },
  { max: 3, label: 'minor', color: 'var(--ink-soft)' },
  { max: 4, label: 'light', color: 'var(--mint)' },
  { max: 5, label: 'moderate', color: 'var(--gold)' },
  { max: Infinity, label: 'strong', color: 'var(--rose)' },
];
export function magBand(m) {
  if (!Number.isFinite(m)) return BANDS[0];
  return BANDS.find((b) => m < b.max) || BANDS[BANDS.length - 1];
}

// Great-circle distance (miles) + 16-point compass bearing FROM the house TO the
// epicentre. USGS's own `place` string is relative to the nearest town ("10 km SSW
// of Tres Pinos"), which is useless for judging "should I have felt that?" — the
// distance and direction from home is the reading that actually matters here.
export function geoFrom(lat0, lon0, lat, lon) {
  if (![lat0, lon0, lat, lon].every(Number.isFinite)) return null;
  const dLat = (lat - lat0) * RAD, dLon = (lon - lon0) * RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat0 * RAD) * Math.cos(lat * RAD) * Math.sin(dLon / 2) ** 2;
  const mi = 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dLon) * Math.cos(lat * RAD);
  const x = Math.cos(lat0 * RAD) * Math.sin(lat * RAD)
    - Math.sin(lat0 * RAD) * Math.cos(lat * RAD) * Math.cos(dLon);
  const brg = (Math.atan2(y, x) / RAD + 360) % 360;
  return { mi, dir: COMPASS[Math.round(brg / 22.5) % 16] };
}

// Elapsed time in the garden's usual plain-English idiom. Coarsens as it ages —
// minutes while it's fresh news, then hours, then days.
export function agoLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'moments ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Trim USGS place strings for a wall: metric offsets mean nothing here, and the
// ", CA" tail is a given. "10 km SSW of Tres Pinos, CA" → "6 mi SSW of Tres Pinos".
export function tidyPlace(raw) {
  let t = String(raw == null ? '' : raw).trim();
  t = t.replace(/,\s*(CA|California|Nevada|NV|Oregon|OR)\s*$/i, '');
  t = t.replace(/^(\d+(?:\.\d+)?)\s*km\b/i, (_, km) => {
    const mi = Math.round(Number(km) * 0.621371);
    return `${mi} mi`;
  });
  return t || 'somewhere nearby';
}

export default {
  id: 'quakes',
  title: 'Seismic',
  icon: '〰',
  size: 'md', // half width — shares the bottom band with "Out in SF"
  chrome: true,
  async mount(body, ctx) {
    const { lat = SF_LAT, lon = SF_LON } = ctx.config || {};
    const h = ctx.h;

    ctx.style(`
      .qk { display:flex; flex-direction:column; height:100%; justify-content:space-between; }
      /* ---- beat 1: the last shake ---- */
      .qk-hero { display:flex; align-items:center; gap:13px; min-width:0; }
      .qk-mag { flex:0 0 auto; font-family:var(--font-display); font-weight:700;
        font-size:41px; line-height:.86; letter-spacing:-.02em; color:var(--qk-c,var(--ink)); }
      .qk-mag .u { font-family:var(--font-mono); font-size:13px; font-weight:600;
        letter-spacing:.06em; color:var(--ink-faint); margin-right:3px; vertical-align:9px; }
      .qk-who { flex:1; min-width:0; }
      .qk-place { font-size:15px; font-weight:600; line-height:1.18; color:var(--ink);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .qk-meta { margin-top:3px; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.03em; color:var(--ink-faint); white-space:nowrap;
        overflow:hidden; text-overflow:ellipsis; }
      .qk-meta .sep { opacity:.45; margin:0 5px; }
      /* the human detail: real people filed "did you feel it?" reports */
      .qk-meta .felt { color:var(--gold); font-weight:600; }
      /* ---- beat 2: the week's biggest, when it isn't the one above ---- */
      .qk-big { font-family:var(--font-mono); font-size:10px; letter-spacing:.05em;
        color:var(--ink-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        border-top:1px solid var(--stroke); padding-top:7px; }
      .qk-big .cap { letter-spacing:.14em; opacity:.7; margin-right:7px; }
      .qk-big b { color:var(--qk-bc,var(--ink-soft)); font-weight:700; }
      /* ---- beat 3: the 7-day dot strip ---- */
      .qk-strip { position:relative; height:19px; }
      .qk-strip .base { position:absolute; left:0; right:0; top:9px; height:1px;
        background:rgba(140,240,195,.13); }
      .qk-dot { position:absolute; top:9px; border-radius:50%;
        transform:translate(-50%,-50%); }
      .qk-axis { display:flex; justify-content:space-between; font-family:var(--font-mono);
        font-size:9.5px; letter-spacing:.11em; color:var(--ink-faint); opacity:.85; }
      /* ---- the still-week / unavailable states ---- */
      .qk-calm { flex:1; display:flex; flex-direction:column; justify-content:center;
        gap:7px; text-align:center; }
      .qk-calm .ic { font-size:24px; opacity:.55; }
      .qk-calm .t { font-size:14px; color:var(--ink-soft); line-height:1.35; }
      .qk-calm .s { font-family:var(--font-mono); font-size:9.5px; letter-spacing:.11em;
        color:var(--ink-faint); }
    `);

    const stage = h('div', { class: 'qk' });
    body.replaceChildren(stage);

    const startIso = () => new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 19);
    const url = () => 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'
      + `&latitude=${lat}&longitude=${lon}&maxradiuskm=${RADIUS_KM}`
      + `&minmagnitude=${MIN_MAG}&eventtype=earthquake&orderby=time&limit=250`
      + `&starttime=${encodeURIComponent(startIso())}`;

    // Normalise the GeoJSON into the few fields the card actually renders, so a
    // shape change upstream can only ever cost us a field, never throw.
    const parse = (d) => (Array.isArray(d && d.features) ? d.features : [])
      .map((f) => {
        const p = (f && f.properties) || {};
        const c = (f && f.geometry && f.geometry.coordinates) || [];
        return {
          mag: Number(p.mag),
          place: tidyPlace(p.place),
          time: Number(p.time),
          depthKm: Number(c[2]),
          felt: Number.isFinite(Number(p.felt)) ? Number(p.felt) : 0,
          geo: geoFrom(lat, lon, Number(c[1]), Number(c[0])),
        };
      })
      .filter((q) => Number.isFinite(q.mag) && Number.isFinite(q.time))
      .sort((a, b) => b.time - a.time);

    const render = (quakes) => {
      if (!quakes.length) {
        stage.replaceChildren(h('div', { class: 'qk-calm' },
          h('div', { class: 'ic' }, '🌿'),
          h('div', { class: 't' }, 'The ground has been perfectly still all week.'),
          h('div', { class: 's' }, `NOTHING ABOVE M${MIN_MAG.toFixed(1)} WITHIN ${Math.round(RADIUS_KM * 0.621371)} MI`)));
        return;
      }

      const now = Date.now();
      const last = quakes[0];
      const band = magBand(last.mag);
      // The week's strongest — worth a line of its own only when the most recent
      // tremor wasn't already it (otherwise it's the same sentence twice).
      const biggest = quakes.reduce((a, q) => (q.mag > a.mag ? q : a), quakes[0]);
      const showBig = biggest !== last && biggest.mag > last.mag + 0.05;

      const meta = [];
      const ago = agoLabel(now - last.time);
      if (ago) meta.push(h('span', {}, ago));
      if (last.geo) meta.push(h('span', {}, `${Math.round(last.geo.mi)} mi ${last.geo.dir}`));
      if (Number.isFinite(last.depthKm) && last.depthKm >= 0) {
        meta.push(h('span', {}, `${Math.round(last.depthKm * 0.621371)} mi deep`));
      }
      const metaKids = [];
      meta.forEach((m, i) => { if (i) metaKids.push(h('span', { class: 'sep' }, '·')); metaKids.push(m); });
      if (last.felt > 0) {
        metaKids.push(h('span', { class: 'sep' }, '·'));
        metaKids.push(h('span', { class: 'felt' },
          `${last.felt} felt it`));
      }

      // Dot strip: the whole week on one rail. Newest at the right edge, so the
      // eye naturally lands on "just now". Dots are radius-scaled by magnitude
      // (a M4 is unmistakably bigger than a M1.6) and clamped so a swarm of micros
      // stays a whisper. Cap the count so a busy Geysers week can't cost frames.
      const span = DAYS * 864e5;
      const dots = quakes
        .slice()
        .sort((a, b) => a.mag - b.mag)   // draw big ones last → they sit on top
        .slice(-70)
        .map((q) => {
          const frac = Math.min(1, Math.max(0, 1 - (now - q.time) / span));
          const d = Math.max(4, Math.min(13, 4 + (q.mag - MIN_MAG) * 2.6));
          const c = magBand(q.mag).color;
          return h('span', {
            class: 'qk-dot',
            title: `M${q.mag.toFixed(1)} — ${q.place}, ${agoLabel(now - q.time)}`,
            style: `left:${(frac * 100).toFixed(2)}%;width:${d}px;height:${d}px;`
              + `background:${c};opacity:${q.mag < 2 ? '.45' : '.9'};`,
          });
        });

      stage.replaceChildren(
        h('div', { class: 'qk-hero', style: `--qk-c:${band.color}` },
          h('div', { class: 'qk-mag', title: `${band.label} earthquake` },
            h('span', { class: 'u' }, 'M'), last.mag.toFixed(1)),
          h('div', { class: 'qk-who' },
            h('div', { class: 'qk-place', title: last.place }, last.place),
            h('div', { class: 'qk-meta' }, ...metaKids))),
        showBig
          ? h('div', { class: 'qk-big', style: `--qk-bc:${magBand(biggest.mag).color}` },
            h('span', { class: 'cap' }, 'WEEK’S BIGGEST'),
            h('b', {}, `M${biggest.mag.toFixed(1)}`),
            ` ${biggest.place}`,
            h('span', { class: 'sep' }, ' · '),
            agoLabel(now - biggest.time))
          : h('div', { class: 'qk-big' },
            h('span', { class: 'cap' }, 'THIS WEEK'),
            `${quakes.length} tremor${quakes.length === 1 ? '' : 's'} above M${MIN_MAG.toFixed(1)}`),
        h('div', { class: 'qk-strip', title: `${quakes.length} earthquakes in the past ${DAYS} days` },
          h('span', { class: 'base' }), ...dots),
        h('div', { class: 'qk-axis' },
          h('span', {}, `${DAYS} DAYS AGO`),
          h('span', {}, `${quakes.length} IN ${Math.round(RADIUS_KM * 0.621371)} MI`),
          h('span', {}, 'NOW')),
      );
    };

    // Fetch BEFORE touching the DOM, so a failed refresh leaves the last good
    // render in place. Retry the very first load a few times — the Jetson's link
    // to public APIs stalls now and then and a blank card is worse than a wait.
    let loadedOnce = false;
    const refresh = async () => { const q = parse(await ctx.fetchJSON(url())); render(q); loadedOnce = true; };

    stage.replaceChildren(ctx.loading('listening to the ground…'));
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try { await refresh(); ok = true; }
      catch { await new Promise((r) => setTimeout(r, 700 * (i + 1))); }
    }
    if (!ok) {
      stage.replaceChildren(h('div', { class: 'qk-calm' },
        h('div', { class: 'ic' }, '〰'),
        h('div', { class: 't' }, 'Seismic feed unavailable'),
        h('div', { class: 's' }, 'USGS IS QUIET — RETRYING SHORTLY')));
    }

    // Quakes are news on the scale of minutes, not seconds. Every 5 min is plenty
    // and keeps the kiosk near idle; a failed poll keeps the previous render.
    ctx.interval(() => { if (loadedOnce) refresh().catch(() => {}); }, 5 * 60 * 1000);
  },
};
