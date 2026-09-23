// BART departures — a calm, full-width "departure board" for a central SF station,
// so a glance across the room answers "when's the next train?". Data via BART's
// keyless public API (a documented, freely-shared public key — no secret) through
// the SSRF-safe proxy.
//   etd.aspx  → root.station[0].etd[] : one entry per DESTINATION, each with an
//               estimate[] of the next trains ({minutes, hexcolor, direction, …}).
//   sched.aspx (stnsched) → the day's full timetable, used as a graceful fallback
//               when no trains are running live (BART is closed overnight), so the
//               board shows the NEXT SCHEDULED departures instead of a blank card.
//
// Network is best-effort: the initial load retries with short backoff, and a
// periodic refresh fetches BEFORE replacing the DOM so a failed refresh keeps the
// last good board on screen.

// BART's shared public API key — published in BART's own developer docs for
// everyone to use (not a secret credential).
const KEY = 'REDACTED_TRANSIT_API_KEY';
const STATION = 'POWL';                    // Powell St. — central downtown SF hub
const STATION_NAME = 'Powell St.';
const TZ = 'America/Los_Angeles';
const ETD = `https://api.bart.gov/api/etd.aspx?cmd=etd&orig=${STATION}&key=${KEY}&json=y`;
const SCHED = `https://api.bart.gov/api/sched.aspx?cmd=stnsched&orig=${STATION}&key=${KEY}&json=y`;
// System-wide service advisories (delays, disruptions). Keyless, same host. On a
// clear day BART returns a single "No delays reported." entry; a real problem
// carries the advisory text — which is exactly what a rider glancing at the board
// wants to know before they know when the next train is.
const BSA = `https://api.bart.gov/api/bsa.aspx?cmd=bsa&key=${KEY}&json=y`;

// Route number → BART's own line hex, for colouring the scheduled-departures
// fallback (the live ETD feed already carries hexcolor per estimate). Route
// numbers are stable; a missing one simply falls back to mint.
const ROUTE_HEX = {
  1: '#FFFF33', 2: '#FFFF33',   // Yellow — Antioch ↔ SFO/Millbrae
  3: '#FF9933', 4: '#FF9933',   // Orange — Richmond ↔ Berryessa
  5: '#339933', 6: '#339933',   // Green  — Berryessa ↔ Daly City
  7: '#FF0000', 8: '#FF0000',   // Red    — Richmond ↔ SFO/Millbrae
  11: '#0099CC', 12: '#0099CC', // Blue   — Dublin ↔ Daly City
  19: '#B0BEC7', 20: '#B0BEC7', // Grey   — OAK shuttle
};

// The lines that serve this station, for the reconnecting legend. Colours match
// BART's own hex.
const LEGEND = [
  { name: 'Antioch', hex: '#FFFF33' },
  { name: 'Richmond', hex: '#FF0000' },
  { name: 'Berryessa', hex: '#339933' },
  { name: 'Dublin', hex: '#0099CC' },
];

// Long official destination strings → short, recognisable board labels. A missing
// entry falls back to the raw name, so the board never shows a blank column.
const SHORT = {
  'Berryessa/North San Jose': 'Berryessa',
  'Dublin/Pleasanton': 'Dublin',
  'SFO/Millbrae': 'SFO',
  'Millbrae/SFIA': 'Millbrae',
  "Millbrae/SF Int'l Airport": 'Millbrae',
  'SF Airport': 'SFO',
  'Daly City': 'Daly City',
  'Richmond': 'Richmond',
  'Antioch': 'Antioch',
  'Pittsburg/Bay Point': 'Pittsburg',
  'Pittsburg Center': 'Pittsburg',
};
const shortDest = (d) => SHORT[d] || (d || '').replace(/\s*\/.*$/, '') || d || '—';
// Scheduled trainHeadStation ("SF / OAK Airport / Berryessa") → its final leg.
const schedDest = (h) => {
  const parts = String(h || '').split('/').map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || h;
  return shortDest(last);
};

// A live estimate's "minutes" is "Leaving" or a number. Normalise to a sortable
// number (Leaving → 0).
const estMinutes = (m) => (String(m).toLowerCase() === 'leaving' ? 0 : parseInt(m, 10));

// BART's per-train platform + compass direction → a compact board tag. A real
// departure board shows the PLATFORM so a rider knows where to stand; the ETD feed
// carries a platform number and a "North"/"South" direction on each estimate, so we
// surface the platform as a hushed "PLAT 2" pill and keep the direction for the
// tooltip. Returns { tag, title } or null when the feed doesn't carry a usable
// platform (e.g. the scheduled-timetable fallback), so the pill simply hides.
const DIR_WORD = { n: 'Northbound', s: 'Southbound', e: 'Eastbound', w: 'Westbound' };
const platformInfo = (est) => {
  const plat = est && est.platform != null ? String(est.platform).trim() : '';
  if (!/^\d+$/.test(plat)) return null;
  const dir = DIR_WORD[String((est && est.direction) || '').trim().toLowerCase()[0]] || '';
  return { tag: `Plat ${plat}`, title: dir ? `${dir} · Platform ${plat}` : `Platform ${plat}` };
};
// BART's XML→JSON conversion yields a single object where an array is expected;
// normalise so callers can always map over it.
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// Parse BART's Service Advisory feed into { clear } on a quiet day or
// { clear:false, text } when there's a genuine advisory. BART's XML→JSON puts the
// message inside description as a CDATA object ({ '#cdata-section': '…' }); a clear
// system reports the sentinel "No delays reported.", which we treat as clear so the
// board stays calm and only speaks up when something's actually wrong.
const bsaText = (b) => {
  const d = b && b.description;
  const t = d && typeof d === 'object' ? (d['#cdata-section'] ?? d['#text'] ?? '') : (d ?? '');
  return String(t).replace(/\s+/g, ' ').trim();
};
// A clear system reports one of BART's "all clear" sentinels — historically
// "No delays reported.", but the live feed also returns "No advisories issued."
// Both (and kindred "no advisory/advisories …" phrasings) must read as CLEAR so
// the header stays calm; only a genuine advisory raises the gold ⚠ clause.
const isClearBsa = (t) => /\bno\s+(delays?\s+reported|advisor(?:y|ies))/i.test(t);
function parseBsa(data) {
  const list = asArray(data && data.root && data.root.bsa);
  const real = list.map(bsaText)
    .filter((t) => t && !isClearBsa(t));
  return real.length ? { clear: false, text: real.join(' · ') } : { clear: true };
}

// Exposed for smoke: the destination normalisers + the "Leaving"→0 rule are the
// widget's core parsing invariants against BART's raw feed shape.
export { shortDest, schedDest, estMinutes, ROUTE_HEX, parseBsa, platformInfo };

export default {
  id: 'transit',
  title: 'BART',
  icon: '🚆',
  size: 'wide',   // full-width single-row departure board
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .bart { display:flex; flex-direction:column; gap:9px; height:100%; min-height:0; }
      .bart-head { display:flex; align-items:baseline; gap:10px; flex:none; }
      .bart-head .st { font-family:var(--font-display); font-weight:700; font-size:18px; color:var(--ink);
        letter-spacing:.01em; white-space:nowrap; }
      .bart-head .sub { font-family:var(--font-mono); font-size:10px; letter-spacing:.14em;
        text-transform:uppercase; color:var(--ink-faint); }
      /* a hushed status clause pinned right: "updated Xs ago" live, or "scheduled"
         when the board is showing the timetable overnight. */
      .bart-head .upd { margin-left:auto; font-family:var(--font-mono); font-size:10px;
        letter-spacing:.06em; color:var(--ink-faint); white-space:nowrap; }
      .bart-head .upd.sched { color:var(--mint-2); }
      /* service advisory — a hushed gold ⚠ clause that only appears when BART reports
         a real delay/disruption. It fills the middle of the header and ellipsises, so
         a long advisory never pushes the "updated" stamp off the right edge (and,
         being flex:1, it leaves no free space for the stamp's auto-margin, keeping the
         stamp pinned right). Clear days render nothing here — the header stays calm. */
      .bart-head .adv { flex:1 1 auto; min-width:0; text-align:right; align-self:baseline;
        font-family:var(--font-mono); font-size:10px; letter-spacing:.03em; color:var(--gold);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

      /* departures — a row of destination columns filling the full width. Each is a
         quiet glass tile with a line-coloured top rule, the destination, and the
         next arrival(s). flex:1 so they share the width evenly. Static, no motion. */
      .bart-deps { flex:1; display:flex; gap:10px; min-height:0; }
      .bart-dep { flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:3px;
        background:rgba(255,255,255,.04); border:1px solid var(--stroke); border-radius:12px;
        border-top:3px solid var(--bart-c,var(--mint)); padding:7px 8px; justify-content:center; }
      /* The destination is the one thing a rider MUST be able to read from across
         the room, so the tile's horizontal budget is spent on the name first: the
         gaps, padding and platform pill are all kept lean enough that every BART
         terminus served by this station ("Daly City", "Berryessa", "Pittsburg")
         renders in full at five columns instead of ellipsising to "Daly …". */
      .bart-dep .dest { display:flex; align-items:center; gap:6px; min-width:0; }
      .bart-dep .dest .dot { width:8px; height:8px; border-radius:50%; flex:none;
        background:var(--bart-c,var(--mint)); box-shadow:0 0 6px var(--bart-c,var(--mint)); }
      .bart-dep .dest .nm { font-size:13.5px; font-weight:600; color:var(--ink); letter-spacing:.01em;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* platform pill — pinned to the right of the destination row like a real
         departure board ("PLAT 2"), so a glance tells a rider which platform to
         wait on. Hushed and flex:none, right-aligned via margin-left:auto; sits on
         the existing dest line so it adds no height and can't clip. Hidden on the
         scheduled-timetable fallback, which carries no live platform. */
      .bart-dep .dest .plat { flex:0 0 auto; margin-left:auto; font-family:var(--font-mono);
        font-size:9px; font-weight:700; letter-spacing:.02em; text-transform:uppercase;
        color:var(--ink-faint); background:rgba(255,255,255,.05); border:1px solid var(--stroke);
        border-radius:5px; padding:1.5px 4px; line-height:1.2; }
      .bart-dep .times { display:flex; align-items:baseline; gap:7px; flex-wrap:nowrap; white-space:nowrap; }
      .bart-dep .times .m0 { font-family:var(--font-display); font-weight:700; font-size:25px;
        line-height:.9; color:var(--bart-c,var(--mint)); }
      .bart-dep .times .m0.now { font-size:19px; letter-spacing:.01em; }
      .bart-dep .times .m0.clock { font-size:20px; }
      .bart-dep .times .u { font-family:var(--font-mono); font-size:11px; color:var(--ink-soft);
        letter-spacing:.02em; }
      .bart-dep .times .more { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint);
        letter-spacing:.02em; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }

      /* reconnecting state — a calm line legend, so the board never reads as blank. */
      .bart-rest { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:9px; text-align:center; color:var(--ink-soft); }
      .bart-rest .legend { display:flex; gap:16px; flex-wrap:wrap; justify-content:center; }
      .bart-rest .legend .l { display:flex; align-items:center; gap:6px;
        font-family:var(--font-mono); font-size:11.5px; color:var(--ink-soft); letter-spacing:.02em; }
      .bart-rest .legend .l .dot { width:9px; height:9px; border-radius:50%; flex:none; }
      .bart-rest .msg { font-size:13px; color:var(--ink); }
    `);
    body.classList.add('bart');
    body.appendChild(ctx.loading('reading the platform…'));

    const restBoard = (msg) => h('div', { class: 'bart-rest' },
      h('div', { class: 'legend' }, ...LEGEND.map((l) => h('div', { class: 'l' },
        h('span', { class: 'dot', style: { background: l.hex, boxShadow: `0 0 6px ${l.hex}` } }),
        l.name))),
      h('div', { class: 'msg' }, msg || 'Reconnecting to BART…'));

    let lastUpdate = null;              // Date of the last good LIVE fetch
    let updEl = null;
    const fmtAgo = () => {
      if (!lastUpdate) return '';
      const s = Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));
      if (s < 60) return `updated ${s}s ago`;
      return `updated ${Math.round(s / 60)}m ago`;
    };
    const tickUpd = () => { if (updEl && !updEl.classList.contains('sched')) updEl.textContent = fmtAgo(); };

    // Latest parsed service advisory ({clear} / {clear:false,text}); refreshed
    // best-effort each cycle and kept between cycles so a flaky BSA fetch never
    // blanks a known advisory (or spuriously raises one).
    let lastAdv = null;
    const advChip = () => {
      if (!lastAdv || lastAdv.clear) return null;
      return h('span', { class: 'adv', title: `BART service advisory: ${lastAdv.text}` }, `⚠ ${lastAdv.text}`);
    };

    const headEl = (status, sched) => h('div', { class: 'bart-head' },
      h('span', { class: 'st' }, STATION_NAME),
      h('span', { class: 'sub' }, 'BART departures'),
      advChip(),
      h('span', { class: `upd${sched ? ' sched' : ''}` }, status));

    // Build one departure tile. `mins` is a list of upcoming waits in minutes (live)
    // or `clock` is a "7:55a" scheduled time (fallback).
    const depTile = (d) => {
      // Platform pill (right-aligned on the dest row) — live board only; the
      // scheduled fallback carries no platform, so d.plat is null there.
      const platPill = d.plat ? h('span', { class: 'plat', title: d.plat.title }, d.plat.tag) : null;
      if (d.clock) {
        return h('div', { class: 'bart-dep', style: { '--bart-c': d.hex }, title: d.title },
          h('div', { class: 'dest' }, h('span', { class: 'dot' }), h('span', { class: 'nm' }, d.dest), platPill),
          h('div', { class: 'times' }, h('span', { class: 'm0 clock' }, d.clock),
            d.more ? h('span', { class: 'more' }, d.more) : null));
      }
      const m0 = d.mins[0];
      const nowish = m0 <= 0;
      const rest = d.mins.slice(1, 3);
      return h('div', { class: 'bart-dep', style: { '--bart-c': d.hex }, title: d.title },
        h('div', { class: 'dest' }, h('span', { class: 'dot' }), h('span', { class: 'nm' }, d.dest), platPill),
        h('div', { class: 'times' },
          h('span', { class: `m0${nowish ? ' now' : ''}` }, nowish ? 'Now' : String(m0)),
          nowish ? null : h('span', { class: 'u' }, 'min'),
          rest.length ? h('span', {
            class: 'more',
            title: `then ${rest.map((n) => (n <= 0 ? 'now' : `${n} min`)).join(', ')}`,
          }, `+${rest.map((n) => (n <= 0 ? 'now' : n)).join(', ')}`) : null));
    };

    // "07:55 AM" (BART schedule clock string, station-local) → minutes past midnight.
    const schedMins = (s) => {
      const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s || '');
      if (!m) return null;
      let hh = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) hh += 12;
      return hh * 60 + parseInt(m[2], 10);
    };
    const fmtClock = (s) => (s || '').replace(/\s*(AM|PM)/i, (x, ap) => ap[0].toLowerCase()).replace(/^0/, '').replace(' ', '');
    // Now, as minutes past midnight in SF — so "next scheduled" is honest regardless
    // of the host clock's own zone.
    const nowMins = () => {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      return parseInt(p.find((x) => x.type === 'hour')?.value || '0', 10) * 60
        + parseInt(p.find((x) => x.type === 'minute')?.value || '0', 10);
    };

    // LIVE board from the ETD feed. Returns the number of departures rendered.
    const renderLive = (data) => {
      const root = data && data.root;
      const station = root && asArray(root.station)[0];
      const etds = station ? asArray(station.etd) : [];
      const deps = etds.map((e) => {
        const ests = asArray(e.estimate)
          .map((x) => ({ n: estMinutes(x.minutes), hex: x.hexcolor, dir: x.direction, platform: x.platform, length: x.length }))
          .filter((x) => Number.isFinite(x.n))
          .sort((a, b) => a.n - b.n);
        if (!ests.length) return null;
        return {
          dest: shortDest(e.destination),
          hex: ests[0].hex || '#74f7b0',
          mins: ests.map((x) => x.n),
          plat: platformInfo(ests[0]),
          title: `${e.destination}${ests[0].dir ? ` · ${ests[0].dir}bound` : ''} · ${ests.slice(0, 3).map((x) => (x.n <= 0 ? 'now' : `${x.n} min`)).join(', ')}`,
        };
      }).filter(Boolean).sort((a, b) => a.mins[0] - b.mins[0]).slice(0, 5);
      if (!deps.length) return 0;
      body.replaceChildren(headEl(fmtAgo(), false),
        h('div', { class: 'bart-deps' }, ...deps.map(depTile)));
      updEl = body.querySelector('.upd');
      return deps.length;
    };

    // SCHEDULED fallback from the timetable — the next few trains by clock time.
    const renderSched = (data) => {
      const station = data && data.root && data.root.station;
      const items = station ? asArray(station.item) : [];
      const now = nowMins();
      // Keep only trains still to come today, soonest first; one tile per next train.
      const upcoming = items
        .map((it) => ({ it, m: schedMins(it['@origTime']) }))
        .filter((x) => x.m != null && x.m >= now)
        .sort((a, b) => a.m - b.m)
        .slice(0, 5)
        .map(({ it }) => {
          const route = parseInt(String(it['@line']).replace(/\D+/g, ''), 10);
          const waitMin = (schedMins(it['@origTime']) ?? 0) - now;
          const wh = Math.floor(waitMin / 60), wm = waitMin % 60;
          return {
            dest: schedDest(it['@trainHeadStation']),
            hex: ROUTE_HEX[route] || '#74f7b0',
            clock: fmtClock(it['@origTime']),
            more: `in ${wh ? `${wh}h ` : ''}${wm}m`,
            title: `${it['@trainHeadStation']} · scheduled ${it['@origTime']}`,
          };
        });
      if (!upcoming.length) return 0;
      body.replaceChildren(headEl('next scheduled', true),
        h('div', { class: 'bart-deps' }, ...upcoming.map(depTile)));
      updEl = body.querySelector('.upd');
      return upcoming.length;
    };

    // One refresh: try live; if nothing is running, fall back to the timetable.
    const refresh = async () => {
      // Service advisory in parallel — best-effort, never blocks or breaks the board:
      // it updates lastAdv (kept from the prior cycle on failure) and is capped so a
      // slow BSA response can't hold up the departures once the ETD feed is in.
      const bsaP = ctx.fetchJSON(BSA).then((b) => { lastAdv = parseBsa(b); }).catch(() => {});
      const live = await ctx.fetchJSON(ETD);
      lastUpdate = new Date();
      await Promise.race([bsaP, new Promise((r) => setTimeout(r, 1200))]);
      if (renderLive(live) > 0) return;
      // No live trains (overnight / closed) — show the next scheduled departures.
      const sched = await ctx.fetchJSON(SCHED);
      if (renderSched(sched) > 0) return;
      body.replaceChildren(headEl('', false), restBoard('No trains running right now'));
      updEl = body.querySelector('.upd');
    };

    // Initial load: a few attempts with short backoff so one slow/aborted response
    // doesn't drop the board to an error for a whole refresh cycle.
    let loaded = false;
    for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
      try { await refresh(); loaded = true; }
      catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt)); }
    }
    if (!loaded) body.replaceChildren(headEl('', false), restBoard('Reconnecting to BART…'));

    // Departures move fast — refresh every minute. On failure KEEP the last good
    // board (refresh replaces the DOM only after a clean fetch). ctx.interval fires
    // immediately, so skip the first synchronous tick (the initial load covered it).
    let firstTick = true;
    ctx.interval(() => {
      if (firstTick) { firstTick = false; return; }
      refresh().catch(() => {});
    }, 60 * 1000);
    // Tick the "updated Xs ago" label every 15s (cheap text-only) between refreshes.
    ctx.interval(tickUpd, 15 * 1000);
  },
};
