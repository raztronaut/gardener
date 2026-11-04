// Midterms — the 2026 US midterm results, live. TEMPORARY: it takes Out in SF's slot
// on the main wall (manifest "replaces": "sf-events", "until": 2026-11-06 12:00 PT) and
// hands the slot back by itself — at `until`, or 12 h after both chambers' control has
// been called (ctx.retire, persisted in localStorage; see REPLACEMENTS in app.js).
//
// DATA SOURCE — CNN's election results API (keyless, public, CORS *), fetched through
// the SSRF proxy (host politics.api.cnn.io in src/proxy-allowlist.json):
//   https://politics.api.cnn.io/results/national-races/2026-SG.json   Senate (35 incl. FL + OH specials, ~85 KB)
//   https://politics.api.cnn.io/results/national-races/2026-HG.json   House (435 districts + the TX-18 special, ~890 KB)
//   https://politics.api.cnn.io/results/national-races/2026-GG.json   Governors (36, ~88 KB)
// These are the feeds CNN's own results pages read. Each race carries its candidates'
// votes + %, % reporting, the call (status "W" + winner flag), the party the seat counts
// for in the balance of power (winnerBopPartyId — handles independents who caucus), and
// its poll-closing time. Verified live on election night (2026-11-03 ~4:30 PM PT: VA
// Senate called, 9 House seats called, FL/GA/IN/KY counting).
// Why not the others: NYT's static JSON (static01.nyt.com/elections-assets/pages/data/
// 2026-11-03/results-*.json) is also live, but its House file is 9.2 MB — over the
// proxy's 4 MB cap and heavy for the kiosk every 2 minutes. Politico / Fox / AP pages
// refuse non-browser clients (403) or need a key. Wikipedia lags by hours.
//
// What we derive: seats = calls (+ for the Senate the 65 seats not up this year: 34 D
// incl. King & Sanders, 31 R); Senate control = D at 51, R at 50 (VP Vance breaks
// ties); House control = 218. The map's default layer (tile + fullscreen) is the
// HOUSE POPULAR VOTE PER STATE (two-party share, summed over the state's districts) —
// the only aggregate with votes in all 50 states; the fullscreen can switch to the
// Senate / Governor race in each state.
//
// FAILING GRACEFULLY: the three feeds are fetched together every 2 min; if any fails we
// keep the last good snapshot (in memory + localStorage 'garden.midterms.last', so a
// reload mid-outage still shows it) with an "as of" time. With nothing cached at all
// the tile shows its full-size neutral map and "Results feed unavailable · retrying".
// Before any votes the map is neutral and the footer reads "Polls close 3 PM – 10 PM PT".
//
// Map geometry: /lib/us-states.js (us-atlas v3, ISC, from Census public-domain data;
// pre-projected Albers USA, vendored — no runtime CDN). Static SVG: fills change on a
// refresh, nothing animates.
import { US_VIEWBOX, US_STATES } from '/lib/us-states.js';

const FEED = (o) => `https://politics.api.cnn.io/results/national-races/2026-${o}.json`;
const REFRESH = 2 * 60 * 1000;
const FRESH = 90 * 1000;            // a snapshot this young is reused (tile + fullscreen share it)
const GRACE = 12 * 3600 * 1000;     // once both chambers are called, keep the card this long
const HOLD = { D: 34, R: 31 };      // Senate seats not up in 2026 (D incl. 2 independents)
const LS_KEY = 'garden.midterms.last';
const TZ = () => (window.__GARDEN_STATE && window.__GARDEN_STATE.tz) || 'America/Los_Angeles';

// Party colours, validated (dataviz validate_palette.js, dark surface): diverging arms
// from a muted lean step to the vivid pole; independents get a violet arm.
const ARM = {
  D: ['#3d4f6e', '#3c5f9c', '#4378d0', '#4d8ff7'],
  R: ['#6a4146', '#9a4549', '#cc4c52', '#f2545b'],
  I: ['#55496e', '#6c5a9c', '#8a6fd0', '#a385f2'],
};
const BINS = [2, 8, 16];            // margin (pts) steps: <2 lean · 2–8 · 8–16 · 16+
const NEUTRAL = { open: '#2a3e37', closed: '#4f6760', none: '#1a2a25' };
const POLE = { D: ARM.D[3], R: ARM.R[3], I: ARM.I[3] };
const PNAME = { D: 'Democrats', R: 'Republicans', I: 'Independents' };
const fillFor = (p, m) => ARM[p][BINS.filter((b) => m >= b).length];

const P = (x) => (x === 'DEM' ? 'D' : x === 'REP' || x === 'GOP' ? 'R' : 'I');

// ---- data ----------------------------------------------------------------------
function raceOf(r, kind) {
  const all = (r.candidates || []).slice().sort((a, b) => (b.voteNum || 0) - (a.voteNum || 0));
  const win = all.find((c) => c.winner);
  return {
    st: r.stateAbbreviation, name: r.stateName, kind, sp: /-SP-|-HQ-/.test(r.ecKey || ''),
    // % from the votes themselves: CNN's votePercentNum is rounded to whole points
    c: all.slice(0, 3).map((c) => ({ n: c.lastName || c.fullName || '', p: P(c.majorParty),
      pct: r.totalVote ? (100 * (c.voteNum || 0)) / r.totalVote : parseFloat(c.votePercentStr) || 0, v: c.voteNum || 0, w: !!c.winner })),
    rep: Math.round(r.percentReporting || 0), tot: r.totalVote || 0,
    called: r.status === 'W' || !!win,
    bop: r.winnerBopPartyId ? P(r.winnerBopPartyId) : win ? P(win.majorParty) : null,
    close: r.raceEmbargo?.assignedPollsClose || 0, closed: !!r.raceEmbargo?.pollsClosed, watch: !!r.raceToWatch,
  };
}
function distill(sg, hg, gg) {
  const senate = sg.map((r) => raceOf(r, 'S'));
  const gov = gg.map((r) => raceOf(r, 'G'));
  const hs = {};
  const hw = { D: 0, R: 0, I: 0 };
  let hCalled = 0, hTotal = 0, stamp = 0, first = Infinity, last = 0;
  const seen = (r) => {
    const t = Date.parse(r.voteTimestamp || '') || 0; if (t > stamp) stamp = t;
    const c = r.raceEmbargo?.assignedPollsClose; if (c) { first = Math.min(first, c); last = Math.max(last, c); }
  };
  for (const r of hg) {
    if (!/^2026-HG-/.test(r.ecKey || '')) continue; // the TX-18 special (decided in January) fills the CURRENT House
    seen(r);
    const s = hs[r.stateAbbreviation] ||= { d: 0, r: 0, o: 0, rep: 0, n: 0, D: 0, R: 0, I: 0, called: 0, close: Infinity, closed: false };
    for (const c of r.candidates || []) { const p = P(c.majorParty); s[p === 'D' ? 'd' : p === 'R' ? 'r' : 'o'] += c.voteNum || 0; }
    s.n++; s.rep += r.percentReporting || 0; hTotal++;
    s.close = Math.min(s.close, r.raceEmbargo?.assignedPollsClose || Infinity);
    s.closed = s.closed || !!r.raceEmbargo?.pollsClosed;
    const x = raceOf(r, 'H');
    if (x.called && x.bop) { s[x.bop]++; s.called++; hw[x.bop]++; hCalled++; }
  }
  for (const s of Object.values(hs)) { s.rep = Math.round(s.rep / (s.n || 1)); if (!Number.isFinite(s.close)) s.close = 0; }
  sg.forEach(seen); gg.forEach(seen);
  const sw = { D: 0, R: 0, I: 0 }; let sCalled = 0;
  for (const x of senate) if (x.called && x.bop) { sw[x.bop]++; sCalled++; }
  const S = { D: HOLD.D + sw.D, R: HOLD.R + sw.R, I: sw.I };
  const hv = Object.values(hs).reduce((a, s) => ({ d: a.d + s.d, r: a.r + s.r }), { d: 0, r: 0 });
  return {
    at: Date.now(), stamp: stamp || Date.now(), first: Number.isFinite(first) ? first : 0, last,
    votes: senate.some((x) => x.tot) || hv.d + hv.r > 0,
    senate: { races: senate, won: sw, seats: S, called: sCalled, total: senate.length,
      ctl: S.D >= 51 ? 'D' : S.R >= 50 ? 'R' : null },
    house: { states: hs, seats: hw, called: hCalled, total: hTotal || 435, vote: hv,
      ctl: hw.D >= 218 ? 'D' : hw.R >= 218 ? 'R' : null },
    gov: { races: gov, called: gov.filter((x) => x.called).length, total: gov.length },
  };
}

let LAST = null, inflight = null, lastErr = 0;
try { LAST = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }
async function getData(ctx, force = false) {
  if (!force && LAST && Date.now() - LAST.at < FRESH && !lastErr) return LAST;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [sg, hg, gg] = await Promise.all(['SG', 'HG', 'GG'].map((o) => ctx.fetchJSON(FEED(o), { timeout: 30000 })));
      if (!Array.isArray(sg) || !Array.isArray(hg) || !Array.isArray(gg) || !hg.length) throw new Error('unexpected shape');
      LAST = distill(sg, hg, gg); lastErr = 0;
      try { localStorage.setItem(LS_KEY, JSON.stringify(LAST)); } catch { /* quota: memory copy still works */ }
      // Both chambers called = the midterms are decided: hand the wall slot back to
      // Out in SF 12 h later (earliest call wins; the manifest's "until" caps it anyway).
      if (LAST.senate.ctl && LAST.house.ctl) ctx.retire?.(Date.now() + GRACE);
    } catch { lastErr = Date.now(); }
    finally { inflight = null; }
    return LAST;
  })();
  return inflight;
}

// ---- small helpers -------------------------------------------------------------
const fmtTime = (t) => new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const fmtHour = (t) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(t));
  const hh = p.find((x) => x.type === 'hour')?.value, mm = p.find((x) => x.type === 'minute')?.value, ap = p.find((x) => x.type === 'dayPeriod')?.value;
  return `${hh}${mm && mm !== '00' ? ':' + mm : ''} ${ap}`;
};
const pct1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
// The map layer for one state: { party, margin, share (two-party D %), state: open|closed|none }
function layerFor(d, mode, st) {
  if (!d) return { state: 'open' };
  if (mode === 'H') {
    const s = d.house.states[st];
    if (!s) return { state: 'none' };
    const two = s.d + s.r;
    if (!two) return { state: s.closed ? 'closed' : 'open' };
    const dsh = (100 * s.d) / two;
    return { party: dsh >= 50 ? 'D' : 'R', margin: Math.abs(2 * dsh - 100), share: dsh, rep: s.rep };
  }
  const list = (mode === 'S' ? d.senate.races : d.gov.races).filter((x) => x.st === st);
  if (!list.length) return { state: 'none' };
  const x = list.sort((a, b) => b.tot - a.tot)[0];
  if (!x.tot || !x.c[0]) return { state: x.closed ? 'closed' : 'open', race: x };
  return { party: x.c[0].p, margin: x.c[0].pct - (x.c[1]?.pct || 0), race: x, called: x.called };
}
const layerFill = (l) => (l.party ? fillFor(l.party, l.margin) : NEUTRAL[l.state]);

function mapSvg(cls) {
  let s = `<svg class="${cls}" viewBox="${US_VIEWBOX}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="US map">`;
  for (const [st, g] of Object.entries(US_STATES)) s += `<path data-st="${st}" d="${g.d}" fill="${NEUTRAL.open}"/>`;
  return s + '<path class="sel" d="" fill="none"/></svg>';
}
function paintMap(svg, d, mode) {
  for (const p of svg.querySelectorAll('path[data-st]')) p.setAttribute('fill', layerFill(layerFor(d, mode, p.dataset.st)));
}
// Seat bar: [D held][D won] … [R won][R held] across the chamber, a tick at control.
function seatBar(h, d, ch) {
  const tot = ch === 'S' ? 100 : 435;
  const seg = (n, color, cls = '') => (n > 0 ? h('i', { class: cls, style: { flexGrow: String(n), background: color } }) : null);
  if (!d) return h('div', { class: 'mt-bar' }, seg(tot, 'rgba(255,255,255,.07)'), h('b'));
  const c = ch === 'S' ? d.senate : d.house, held = ch === 'S' ? HOLD : { D: 0, R: 0 };
  const won = ch === 'S' ? c.won : c.seats;
  const rest = tot - held.D - held.R - won.D - won.R - (won.I || 0);
  return h('div', { class: 'mt-bar' },
    seg(held.D, ARM.D[1]), seg(won.D, POLE.D), seg(won.I || 0, POLE.I),
    seg(rest, 'rgba(255,255,255,.07)'),
    seg(won.R, POLE.R), seg(held.R, ARM.R[1]), h('b'));
}

// ---- the wall tile: a glance --------------------------------------------------------
const TILE_CSS = `
  .mt { height:100%; display:flex; flex-direction:column; gap:12px; }
  .mt-ch { flex:none; display:grid; grid-template-columns:1fr 1fr; column-gap:30px; }
  .mt-lb { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; letter-spacing:.08em;
    text-transform:uppercase; color:var(--ink-soft); white-space:nowrap; }
  .mt-lb .to { letter-spacing:.02em; text-transform:none; color:var(--ink-faint); }
  .mt-n { display:flex; justify-content:space-between; align-items:baseline; margin:4px 0 7px; font-family:var(--font-display);
    font-size:38px; line-height:1; color:var(--ink); font-variant-numeric:tabular-nums; }
  .mt-n small { font-family:var(--font); font-size:15px; color:var(--ink-faint); margin-left:4px; }
  .mt-n .ctl { font-family:var(--font); font-size:14px; color:var(--ink); align-self:center; white-space:nowrap; }
  .mt-lb .win .ctl { font-size:13px; letter-spacing:.04em; text-transform:none; font-weight:600; }
  .mt-bar { position:relative; display:flex; gap:2px; height:8px; }
  .mt-bar i { display:block; min-width:2px; border-radius:2px; }
  .mt-bar b { position:absolute; left:50%; top:-4px; bottom:-4px; width:2px; margin-left:-1px; background:var(--ink); border-radius:1px; }
  .mt-map { flex:1 1 0; min-height:150px; display:flex; }
  .mt-map svg { width:100%; height:100%; display:block; }
  .mt-map path[data-st], .mf-map path[data-st] { stroke:#0d221b; stroke-width:1.1; stroke-linejoin:round; }
  .mt-ft { flex:none; display:flex; justify-content:space-between; gap:10px; font-size:14px; color:var(--ink-faint); white-space:nowrap; }
  .mt-ft .k { color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis; }
`;
function chamberBlock(h, d, ch, full = false) {
  const c = d && (ch === 'S' ? d.senate : d.house);
  const seats = c ? c.seats : null;
  const to = ch === 'S' ? (full ? 'D 51 · R 50 + VP to win' : '51 to win') : '218 to win';
  const n = (p) => h('span', {}, seats ? String(seats[p]) : '–', h('small', {}, p));
  const ctl = c && c.ctl ? h('span', { class: 'ctl', style: { color: POLE[c.ctl] || '' } }, `${PNAME[c.ctl]} win`) : null;
  // On the half-width tile a called chamber says so in the label row (in place of the
  // "to win" target) — squeezed between the two seat counts it crowded them and pushed
  // the House's R count off the card. The wider fullscreen keeps it between the numbers.
  const lbRight = ctl && !full ? h('span', { class: 'to win' }, ctl) : h('span', { class: 'to' }, to);
  return h('div', { class: 'mt-c' },
    h('div', { class: 'mt-lb' }, h('span', {}, ch === 'S' ? 'Senate' : 'House'), lbRight),
    h('div', { class: 'mt-n' }, n('D'), full ? ctl : null, n('R')),
    seatBar(h, d, ch));
}
function footText(d) {
  if (!d) return ['Results feed unavailable', 'retrying'];
  const stale = lastErr && Date.now() - d.at > 5 * 60 * 1000;
  if (!d.votes) return [d.first ? `Polls close ${fmtHour(d.first)} – ${fmtHour(d.last)} PT` : 'Polls closing tonight', 'first results soon'];
  return ['House vote share by state', `${stale ? 'as of ' : ''}${fmtTime(d.stamp)}`];
}

// ---- fullscreen ---------------------------------------------------------------------
const FULL_CSS = `
  .mf { display:flex; flex-direction:column; gap:16px; padding:4px 0 0; }
  .mf-sec { font-size:13px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft); }
  .mf-bop { display:grid; grid-template-columns:1fr 1fr; column-gap:36px; }
  .mf-bop .mt-lb { font-size:15px; }
  .mf-bop .mt-n { font-size:64px; margin:8px 0 12px; }
  .mf-bop .mt-n small { font-size:19px; margin-left:6px; }
  .mf-bop .mt-n .ctl { font-size:18px; }
  .mf-bop .mt-bar { height:14px; }
  .mf-bop .mt-bar b { top:-6px; bottom:-6px; }
  .mf-sub { margin-top:12px; font-size:16px; color:var(--ink-soft); }
  .mf-hd { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
  .mf-cap { font-size:19px; color:var(--ink); margin-top:4px; }
  .mf-tg { display:flex; gap:4px; }
  .mf-tg .gbtn { font-size:16px; padding:7px 14px; border-radius:999px; color:var(--ink-soft); }
  .mf-tg .gbtn.sel { color:var(--mint); background:rgba(116,247,176,.10); font-weight:600; }
  .mf-map svg { width:100%; height:auto; display:block; }
  .mf-map path[data-st] { cursor:var(--c-hand, pointer); }
  .mf-map path.sel { stroke:var(--ink); stroke-width:2.6; pointer-events:none; }
  .mf-lg { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 16px; font-size:15px; color:var(--ink-soft); white-space:nowrap; }
  .mf-lg .sc { display:flex; align-items:center; gap:2px; }
  .mf-lg .sc i { display:block; width:26px; height:12px; border-radius:2px; }
  .mf-lg .sc span { margin:0 8px; }
  .mf-lg .nv { display:flex; gap:16px; }
  .mf-lg .nv i { display:inline-block; width:12px; height:12px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  .mf-st { border-top:1px solid var(--stroke); border-bottom:1px solid var(--stroke); padding:12px 0; min-height:132px; }
  .mf-st .nm { font-family:var(--font-display); font-size:30px; line-height:1; color:var(--ink); }
  .mf-st .nm small { font-family:var(--font); font-size:16px; color:var(--ink-faint); margin-left:10px; }
  .mf-st .rows { margin-top:10px; display:grid; grid-template-columns:110px 1fr; row-gap:6px; font-size:17px; color:var(--ink); }
  .mf-st .rows .k { color:var(--ink-faint); font-size:15px; letter-spacing:.06em; text-transform:uppercase; align-self:center; }
  .mf-st .dim { color:var(--ink-faint); }
  .mf-dot { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:7px; vertical-align:0; }
  .mf-keys { display:grid; grid-template-columns:1fr 1fr; column-gap:36px; }
  .mf-keys .mf-sec { margin-bottom:4px; }
  .mf-row { display:grid; grid-template-columns:34px 1fr 1fr 64px; column-gap:8px; align-items:center; height:42px;
    border-bottom:1px solid var(--stroke); font-size:16px; letter-spacing:-.005em; color:var(--ink); white-space:nowrap; cursor:var(--c-hand, pointer);
    border-radius:8px; padding:0 6px; margin:0 -6px; }
  .mf-row:last-child { border-bottom:none; }
  .mf-row .st { font-weight:700; color:var(--ink-soft); }
  .mf-row .cd { display:flex; align-items:center; min-width:0; }
  .mf-row .cd .cn { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .mf-row .cd b { flex:none; font-weight:600; font-variant-numeric:tabular-nums; margin-left:6px; }
  .mf-row .cd .mf-dot { flex:none; margin-right:6px; }
  .mf-row .rp { text-align:right; color:var(--ink-faint); font-size:15px; }
  .mf-row .rp.won { color:var(--ink); }
  .mf-row.on, .mf-row:hover { background:rgba(116,247,176,.08); }
  .mf-ft { display:flex; justify-content:space-between; font-size:14px; color:var(--ink-faint); }
`;
const MODES = [['H', 'House vote'], ['S', 'Senate'], ['G', 'Governor']];
const CAPTION = {
  H: 'Two-party share of the House vote in each state',
  S: 'Leader in each state’s Senate race (35 races)',
  G: 'Leader in each state’s governor race (36 races)',
};
// "closest first": counting races by margin, then not-yet-counted watch-list races, then called ones.
function keyRaces(races, n) {
  const score = (x) => (x.called ? 1000 : 0) + (x.tot ? x.c[0].pct - (x.c[1]?.pct || 0) : 500 - (x.watch ? 100 : 0));
  return races.slice().sort((a, b) => score(a) - score(b) || a.close - b.close).slice(0, n);
}
function candLine(h, c) {
  if (!c) return h('span', { class: 'cd' });
  return h('span', { class: 'cd' }, h('i', { class: 'mf-dot', style: { background: POLE[c.p] } }), h('span', { class: 'cn' }, c.n),
    c.pct || c.v ? h('b', {}, `${pct1(c.pct)}${c.w ? ' ✓' : ''}`) : null);
}

export default {
  id: 'midterms',
  title: 'Midterms',
  icon: '🗳',
  size: 'tall', // the exact footprint of Out in SF, whose slot it borrows
  chrome: true,
  async mount(body, ctx) {
    const h = ctx.h;
    ctx.style(TILE_CSS);
    const ch = h('div', { class: 'mt-ch' });
    const map = h('div', { class: 'mt-map', html: mapSvg('') });
    const ft = h('div', { class: 'mt-ft' });
    body.replaceChildren(h('div', { class: 'mt' }, ch, map, ft));
    const svg = map.querySelector('svg');
    const render = (d) => {
      ch.replaceChildren(chamberBlock(h, d, 'S'), chamberBlock(h, d, 'H'));
      paintMap(svg, d, 'H');
      const [k, t] = footText(d);
      ft.replaceChildren(h('span', { class: 'k' }, k), h('span', {}, t));
    };
    render(LAST);
    const first = getData(ctx).then(render);
    ctx.interval(() => { getData(ctx, true).then(render); }, REFRESH);
    await Promise.race([first, new Promise((r) => setTimeout(r, 3500))]); // reveal fast; data fades in
  },

  async openFull(body, ctx) {
    const h = ctx.h;
    ctx.style(TILE_CSS);
    if (!document.getElementById('style-midterms-full')) document.head.appendChild(h('style', { id: 'style-midterms-full', html: FULL_CSS }));
    let mode = 'H', pinned = null, hover = null, d = LAST;
    const bop = h('div', { class: 'mf-bop' });
    const cap = h('div', { class: 'mf-cap' });
    const tg = h('div', { class: 'mf-tg' });
    const map = h('div', { class: 'mf-map', html: mapSvg('') });
    const lg = h('div', { class: 'mf-lg' });
    const st = h('div', { class: 'mf-st' });
    const keys = h('div', { class: 'mf-keys' });
    const ft = h('div', { class: 'mf-ft' });
    body.replaceChildren(h('div', { class: 'mf' },
      bop, h('div', { class: 'mf-hd' }, h('div', {}, h('div', { class: 'mf-sec' }, 'Map'), cap), tg), map, lg, st, keys, ft));
    const svg = map.querySelector('svg');
    const selPath = svg.querySelector('path.sel');

    const chamberFull = (ch) => {
      const c = d && (ch === 'S' ? d.senate : d.house);
      const blk = chamberBlock(h, d, ch, true);
      const sub = !c ? '—'
        : ch === 'S' ? `${c.called} of ${c.total} races called · 65 seats not up`
          : `${c.called} of ${c.total} seats called${c.seats.I ? ` · ${c.seats.I} other` : ''}`;
      blk.appendChild(h('div', { class: 'mf-sub' }, sub));
      return blk;
    };
    const stateDetail = () => {
      const code = hover || pinned;
      if (!code || !US_STATES[code]) {
        st.replaceChildren(h('div', { class: 'nm' }, 'Pick a state', h('small', {}, 'tap the map or a race below')));
        return;
      }
      const hs = d?.house.states[code];
      const rows = [];
      if (hs) {
        const two = hs.d + hs.r;
        rows.push(h('span', { class: 'k' }, 'House'), two
          ? h('span', {}, h('i', { class: 'mf-dot', style: { background: POLE.D } }), `D ${pct1((100 * hs.d) / two)}%`, '   ',
            h('i', { class: 'mf-dot', style: { background: POLE.R } }), `R ${pct1((100 * hs.r) / two)}%`,
            h('span', { class: 'dim' }, `  ·  ${hs.rep}% in  ·  seats ${hs.D} D – ${hs.R} R${hs.I ? ` – ${hs.I} other` : ''} of ${hs.n}`))
          : h('span', { class: 'dim' }, `${hs.n} seat${hs.n > 1 ? 's' : ''} · ${hs.closed ? 'polls closed, no votes yet' : hs.close ? `polls close ${fmtHour(hs.close)} PT` : 'no votes yet'}`));
      }
      for (const [k, list] of [['Senate', d?.senate.races], ['Governor', d?.gov.races]]) {
        for (const x of (list || []).filter((r) => r.st === code)) {
          rows.push(h('span', { class: 'k' }, k + (x.sp ? '*' : '')), h('span', {},
            ...x.c.slice(0, 2).flatMap((c, i) => [i ? '   ' : null, h('i', { class: 'mf-dot', style: { background: POLE[c.p] } }), `${c.n}${x.tot ? ` ${pct1(c.pct)}%` : ''}${c.w ? ' ✓' : ''}`]),
            h('span', { class: 'dim' }, x.called ? '  ·  called' : x.tot ? `  ·  ${x.rep}% in` : x.close ? `  ·  polls close ${fmtHour(x.close)} PT` : '')));
        }
      }
      st.replaceChildren(h('div', { class: 'nm' }, US_STATES[code].n, h('small', {}, pinned === code && !hover ? 'selected' : '')),
        h('div', { class: 'rows' }, ...rows));
      selPath.setAttribute('d', US_STATES[code].d);
      svg.appendChild(selPath); // keep the outline on top
    };
    const select = (code, m) => { if (m) mode = m; pinned = code; hover = null; paint(); };
    const raceRow = (x, m) => h('div', {
      class: `mf-row${pinned === x.st && mode === m ? ' on' : ''}`, 'data-psel': '1', onclick: () => select(x.st, m),
    }, h('span', { class: 'st' }, x.st + (x.sp ? '*' : '')), candLine(h, x.c[0]), candLine(h, x.c[1]),
    h('span', { class: `rp${x.called ? ' won' : ''}` }, x.called ? 'called' : x.tot ? `${x.rep}% in` : x.close ? fmtHour(x.close) : ''));
    const paint = () => {
      bop.replaceChildren(chamberFull('S'), chamberFull('H'));
      tg.replaceChildren(...MODES.map(([m, label]) => h('button', {
        class: `gbtn${m === mode ? ' sel' : ''}`, type: 'button', 'data-psel': '1', onclick: () => { mode = m; paint(); },
      }, label)));
      cap.textContent = CAPTION[mode];
      paintMap(svg, d, mode);
      const sw = (p) => [...ARM[p]].map((c) => h('i', { style: { background: c } }));
      lg.replaceChildren(
        h('div', { class: 'sc' }, h('span', {}, 'R'), ...sw('R').reverse(), ...sw('D'), h('span', {}, 'D'),
          h('span', { style: { color: 'var(--ink-faint)' } }, 'lead: <2 · 2–8 · 8–16 · 16+ pts')),
        h('div', { class: 'nv' },
          h('span', {}, h('i', { style: { background: NEUTRAL.closed } }), 'awaiting votes'),
          h('span', {}, h('i', { style: { background: NEUTRAL.open } }), 'polls open'),
          mode === 'H' ? null : h('span', {}, h('i', { style: { background: NEUTRAL.none } }), 'no race')));
      stateDetail();
      const n = 6, order = d?.votes ? 'closest first · vote %' : 'races to watch · polls close (PT)';
      keys.replaceChildren(
        h('div', {}, h('div', { class: 'mf-sec' }, `Senate · ${order}`), ...keyRaces(d?.senate.races || [], n).map((x) => raceRow(x, 'S'))),
        h('div', {}, h('div', { class: 'mf-sec' }, `Governor · ${order}`), ...keyRaces(d?.gov.races || [], n).map((x) => raceRow(x, 'G'))));
      const stale = lastErr && d && Date.now() - d.at > 5 * 60 * 1000;
      ft.replaceChildren(
        h('span', {}, d ? `${stale ? 'Feed unreachable — showing results as of' : 'Updated'} ${fmtTime(d.stamp)} PT · refreshes every 2 min` : 'Results feed unavailable · retrying'),
        h('span', {}, 'Source: CNN · * special election'));
    };
    svg.addEventListener('pointerover', (e) => { const c = e.target.dataset?.st; if (c) { hover = c; stateDetail(); } });
    svg.addEventListener('pointerleave', () => { hover = null; stateDetail(); if (!pinned) selPath.setAttribute('d', ''); });
    svg.addEventListener('click', (e) => { const c = e.target.dataset?.st; if (c) { e.stopPropagation(); select(c); } });
    // open on the closest Senate race that is counting (the most interesting state right now)
    const pickDefault = () => { if (!pinned && d) pinned = keyRaces(d.senate.races.filter((x) => x.tot && !x.called), 1)[0]?.st || null; };
    pickDefault(); paint();
    ctx.interval(() => { getData(ctx).then((x) => { d = x; pickDefault(); paint(); }); }, REFRESH);
  },
};
