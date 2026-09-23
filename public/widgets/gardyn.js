// Gardyn — growth trajectory for the Gardyn Studio 2 "Budding Florist" kit
// (16 pods: 15 varieties, Stock Flower planted twice), started 2026-09-19 under a
// 14 h/day light schedule, placed per Gardyn's official Studio layout.
//
// The card is a compact timeline: one row per plant on a shared 0–120 day axis,
// showing the expected SPROUT window (faint) and the first BLOOM / HARVEST window
// (solid), with a single "today" line across every row — so a glance answers
// "how far is each plant from growing, and when do my flowers open?". Colour
// encodes the plant's kind (flower / herb / green); names are direct labels.
// Fullscreen adds the pod layout, the care calendar and per-plant notes.
//
// All timings are Gardyn's own published ranges (help.mygardyn.com plant pages +
// care-cycle guides); they're estimates from the planting date, not sensor reads.

const START = '2026-09-19';          // planting day = day 0
const LIGHT_HOURS = 14;              // Gardyn recommends 14–16 h at full brightness
const AXIS_DAYS = 120;               // shared timeline span (snapdragon tops out ~115)
const KIT = 'Budding Florist';
const DEVICE = 'Gardyn Studio 2';

// Validated (dataviz validator, dark surface) categorical palette — kind of plant.
const KINDS = {
  flower: { label: 'Flowers', color: '#d9528e' },
  herb: { label: 'Herbs', color: '#9a7cf0' },
  green: { label: 'Greens', color: '#1fa874' },
};

// sp = sprout window (days), m = first bloom / first-cut window (days), pos = pods.
// Leafy greens: Gardyn says most are ready to harvest in 3–5 weeks (first outer-leaf
// cut at ~4 in), so their window starts at day 21 and runs to full size.
export const PLANTS = [
  { n: 'White Petunia', k: 'flower', sp: [7, 12], m: [30, 40], pos: ['R5'], ht: '1 ft, trails',
    note: 'Not edible. If it has sprouted but shows no true leaves 14 days later, add plant food. Trails as it grows; deadhead spent blooms.' },
  { n: 'Stock Flower', k: 'flower', sp: [5, 10], m: [65, 80], pos: ['R2', 'R6'], ht: 'under 1 ft',
    note: 'Fragrant pink / purple spikes. Won’t bloom if it’s too warm (likes 55–75°F). Remove the whole spent head at the stalk base so side shoots follow.' },
  { n: 'Sunflower', k: 'flower', sp: [10, 14], m: [65, 75], pos: ['L3'], ht: '1 ft',
    note: 'Dwarf and pollen-free — keep just 1 sprout. Gives 20+ blooms over 3–4 waves.' },
  { n: 'Celosia Mix', k: 'flower', sp: [7, 14], m: [75, 100], pos: ['L7'], ht: '2 ft',
    note: 'Feathery magenta, orange and yellow plumes. Watch for aphids.' },
  { n: 'Purple Snapdragon', k: 'flower', sp: [7, 20], m: [80, 115], pos: ['R4'], ht: '8–10 in',
    note: 'Blooms in several waves — deadhead to keep them coming. Cut at 45° above a leaf node, leaving a third of the plant.' },
  { n: 'Bull’s Blood Beet', k: 'green', sp: [5, 10], m: [21, 35], pos: ['R7'], ht: '1 ft',
    note: 'Deep-red leaves; harvest for 4–5 weeks.' },
  { n: 'Yellow Swiss Chard', k: 'green', sp: [7, 21], m: [28, 60], pos: ['L4'], ht: '1 ft',
    note: 'Harvest the outer leaves once they reach 3 in.' },
  { n: 'Breen', k: 'green', sp: [7, 21], m: [21, 45], pos: ['L6'], ht: 'under 1 ft',
    note: 'Harvest outer leaves at 4 in; productive for 3–5 weeks.' },
  { n: 'Butterhead', k: 'green', sp: [7, 21], m: [21, 45], pos: ['R3'], ht: 'under 1 ft',
    note: 'Harvest outer leaves at 4 in; prefers 60–70°F.' },
  { n: 'Green Salanova', k: 'green', sp: [7, 14], m: [21, 55], pos: ['L2'], ht: 'under 1 ft',
    note: 'Harvest outer leaves at 4 in.' },
  { n: 'Red Sorrel', k: 'herb', sp: [7, 14], m: [60, 75], pos: ['L1'], ht: 'under 1 ft',
    note: 'Lemony red-veined leaves; harvest for 3–4 weeks. Watch for thrips.' },
  { n: 'Bunching Onions', k: 'herb', sp: [7, 21], m: [60, 60], pos: ['L8'], ht: '1 ft',
    note: 'Cut at 6–8 in down to 2 in — they regrow in 1–2 weeks.' },
  { n: 'Lemon Balm', k: 'herb', sp: [7, 14], m: [70, 70], pos: ['R1'], ht: '2 ft',
    note: 'Start trimming at 10 in; harvest for 8–12 weeks.' },
  { n: 'Purple Basil', k: 'herb', sp: [5, 10], m: [72, 72], pos: ['L5'], ht: '1 ft',
    note: 'Pinch off flower buds to delay bolting; likes it warm (70–85°F).' },
  { n: 'Pink Celery', k: 'green', sp: [12, 20], m: [75, 100], pos: ['R8'], ht: '1 ft',
    note: 'Slow to sprout. Add plant food 10 days after sprouting; harvest stalks at 6 in+.' },
];

// Care calendar (days from planting). Recurring items are expanded below.
const CARE = [
  { d: 7, to: 14, t: 'Sprout dose', s: 'Once most pods sprout: remove unsprouted cubes, then add ¾ tsp plant food mixed in 1 gal to the tank (¼ tsp/gal).' },
  { d: 14, to: 21, t: 'Thin the sprouts', s: 'Cut extras at the base (don’t pull). Keep 1 for greens & sunflower, 3 for herbs and small flowers. yCovers can go on after.' },
  { d: 21, t: 'Feed at ½ tsp / gal', s: 'Once true leaves or ½ in roots appear, mix top-offs at ½ tsp plant food per gallon.' },
  { d: 22, t: 'Replacement check', s: 'Any pod still unsprouted today qualifies for Gardyn’s replacement guarantee.' },
  { d: 30, t: 'Petunias start blooming', s: 'First flowers of the kit. Deadhead spent blooms to keep them coming.' },
  { d: 60, t: 'Feed at 1 tsp / gal', s: 'Plants are maturing and blooming — strengthen top-offs to 1 tsp per gallon. Check roots every 2–4 weeks.' },
  { d: 65, t: 'Stock & sunflower blooms', s: 'Expect the first stock spikes and sunflowers (day 65–80). Keep the room under ~75°F for stock.' },
  { d: 80, t: 'Snapdragons open', s: 'Snapdragon blooms arrive between day 80 and 115, in waves.' },
  { d: 180, t: 'Refresh the garden', s: 'Most Gardyn plants last ~6 months — swap tired yCubes for new ones.' },
];
const recurring = () => {
  const out = [];
  for (let d = 7; d <= 180; d += 7) {
    out.push(d % 28 === 0
      ? { d, t: 'Tank refresh', s: 'Drain, clean with baking soda, refill with fed water + HydroBoost.', rec: true }
      : { d, t: 'Weekly top-off', s: 'Top off to 4 gal with fed water + HydroBoost; keep the tank at least half full.', rec: true });
  }
  return out;
};

const DAY = 864e5;
const startMs = Date.parse(START + 'T00:00:00Z');
function todayIndex(tz) {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return Math.round((Date.parse(key + 'T00:00:00Z') - startMs) / DAY);
}
const dateOf = (d) => new Date(startMs + d * DAY);
const fmtShort = (d) => dateOf(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const rangeTxt = ([a, b]) => (a === b ? `day ${a} (${fmtShort(a)})` : `day ${a}–${b} (${fmtShort(a)} – ${fmtShort(b)})`);

// Where one plant is on its trajectory, given today's day index.
export function plantStatus(p, day) {
  const flower = p.k === 'flower';
  if (day < p.sp[0]) return { phase: 'seed', label: `${p.m[0] - day}d`, sub: 'germinating' };
  if (day <= p.sp[1]) return { phase: 'sprout', label: `${p.m[0] - day}d`, sub: 'sprouting' };
  if (day < p.m[0]) return { phase: 'grow', label: `${p.m[0] - day}d`, sub: 'growing' };
  if (day <= p.m[1]) return { phase: 'ready', label: flower ? 'blooming' : 'ready', sub: flower ? 'first blooms' : 'harvest' };
  return { phase: 'ongoing', label: flower ? 'in bloom' : 'harvest', sub: 'producing' };
}

// The garden's overall stage.
export function gardenStage(day) {
  if (day < 0) return 'Not planted yet';
  if (day < 7) return 'Germinating';
  if (day < 22) return 'Sprouting';
  if (day < 30) return 'Seedlings';
  if (day < 65) return 'Growing';
  if (day < 180) return 'Blooming';
  return 'Past prime';
}

// The next care actions: whatever is active now, then the next upcoming item.
export function nextCare(day) {
  const all = [...CARE, ...recurring()].sort((a, b) => a.d - b.d);
  const active = all.filter((c) => !c.rec && c.to != null && day >= c.d && day <= c.to);
  const upcoming = all.filter((c) => c.d > day || (c.d === day && !active.includes(c)));
  return { active, upcoming };
}

const pct = (d) => `${(Math.max(0, Math.min(AXIS_DAYS, d)) / AXIS_DAYS) * 100}%`;
const MONTHS = (() => {
  const out = [];
  const s = dateOf(0);
  for (let i = 1; i <= 4; i++) {
    const m = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1));
    const d = Math.round((m - startMs) / DAY);
    if (d <= AXIS_DAYS) out.push({ d, t: m.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase() });
  }
  return out;
})();

const STYLE = `
  .gd { display:flex; flex-direction:column; height:100%; min-height:0; gap:12px; }
  .gd-top { flex:0 0 auto; display:flex; align-items:baseline; gap:12px; }
  .gd-day { font-family:var(--font-display); font-weight:700; font-size:44px; line-height:.85; color:var(--ink); }
  .gd-day small { font-size:13px; font-weight:600; color:var(--ink-faint); letter-spacing:.08em; margin-right:5px; }
  .gd-st { font-size:16px; font-weight:700; color:var(--mint); }
  .gd-light { margin-left:auto; font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); }
  .gd-next { flex:0 0 auto; font-size:13px; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gd-next b { color:var(--gold); font-weight:600; }

  .gd-chart { flex:1; min-height:0; display:flex; flex-direction:column; }
  .gd-row, .gd-axis { display:grid; grid-template-columns: 104px 1fr 36px; align-items:center; column-gap:10px; }
  .gd-axis { height:12px; flex:0 0 auto; }
  .gd-axis .ticks { position:relative; height:100%; }
  .gd-axis .tk { position:absolute; top:0; transform:translateX(-50%); font-family:var(--font-mono);
    font-size:8.5px; letter-spacing:.08em; color:var(--ink-faint); }
  .gd-rows { flex:1; min-height:0; display:flex; flex-direction:column; justify-content:space-evenly; }
  .gd-row { flex:0 0 auto; height:18px; }
  .gd-row .nm { font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gd-row.grp .nm { color:var(--ink-soft); }
  .gd-row .tr { position:relative; height:100%; }
  .gd-row .tr::before { content:''; position:absolute; left:0; right:0; top:50%; height:1px; background:var(--stroke); }
  .gd-row .sp { position:absolute; top:50%; height:4px; margin-top:-2px; border-radius:2px; opacity:.35; }
  .gd-row .mw { position:absolute; top:50%; height:8px; margin-top:-4px; border-radius:4px; min-width:6px; }
  .gd-row.grp .mw { opacity:.5; }
  .gd-row .now { position:absolute; top:-3px; bottom:-3px; width:1.5px; margin-left:-.75px; background:var(--gold); }
  .gd-row .rt { font-family:var(--font-mono); font-size:11px; color:var(--ink-soft); text-align:right; white-space:nowrap; }
  .gd-row.ready .rt { color:var(--mint); font-weight:600; }
  .gd-row .dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:7px; vertical-align:1px; }
`;

const tip = (p) => `${p.n}${p.pos.length > 1 ? ' ×2' : ''} · pod ${p.pos.join(' & ')} · sprouts ${rangeTxt(p.sp)} · `
  + `${p.k === 'flower' ? 'first blooms' : 'first cut'} ${rangeTxt(p.m)}`;
const bar = (h, cls, a, b, c) => h('div', { class: cls, style: { left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, background: c } });

// One plant = one row (sprout window faint, first bloom / cut window solid).
function row(h, p, day) {
  const c = KINDS[p.k].color;
  const st = plantStatus(p, day);
  const ready = st.phase === 'ready' || st.phase === 'ongoing';
  return h('div', { class: `gd-row${ready ? ' ready' : ''}`, title: tip(p) },
    h('div', { class: 'nm' }, h('span', { class: 'dot', style: { background: c } }), p.n + (p.pos.length > 1 ? ' ×2' : '')),
    h('div', { class: 'tr' },
      bar(h, 'sp', p.sp[0], p.sp[1], c),
      bar(h, 'mw', p.m[0], p.m[1], c),
      day >= 0 && day <= AXIS_DAYS ? h('div', { class: 'now', style: { left: pct(day) } }) : null),
    h('div', { class: 'rt' }, ready ? (p.k === 'flower' ? 'bloom' : 'ready') : `${p.m[0] - day}d`));
}

// A whole kind collapsed into one row: every member's window drawn as a
// translucent segment on the same track (overlaps read darker).
function groupRow(h, kind, plants, day) {
  const c = KINDS[kind].color;
  const first = Math.min(...plants.map((p) => p.m[0]));
  const ready = plants.some((p) => day >= p.m[0]);
  return h('div', { class: `gd-row grp${ready ? ' ready' : ''}`, title: plants.map(tip).join('\n') },
    h('div', { class: 'nm' }, h('span', { class: 'dot', style: { background: c } }), `${KINDS[kind].label} ×${plants.length}`),
    h('div', { class: 'tr' },
      ...plants.map((p) => bar(h, 'mw', p.m[0], p.m[1], c)),
      day >= 0 && day <= AXIS_DAYS ? h('div', { class: 'now', style: { left: pct(day) } }) : null),
    h('div', { class: 'rt' }, ready ? 'ready' : `${first - day}d`));
}

function nextText(day) {
  const { active, upcoming } = nextCare(day);
  if (active.length) return { k: 'Now', t: active[0].t, when: `until ${fmtShort(active[0].to)}`, s: active[0].s };
  const n = upcoming[0];
  return n ? { k: 'Next', t: n.t, when: fmtShort(n.d), s: n.s } : null;
}

function chart(h, day, detailed) {
  const flowers = PLANTS.filter((p) => p.k === 'flower').sort((a, b) => a.m[0] - b.m[0]);
  const rest = (k) => PLANTS.filter((p) => p.k === k).sort((a, b) => a.m[0] - b.m[0]);
  const rows = detailed
    ? [...flowers, ...rest('herb'), ...rest('green')].map((p) => row(h, p, day))
    : [...flowers.map((p) => row(h, p, day)), groupRow(h, 'green', rest('green'), day), groupRow(h, 'herb', rest('herb'), day)];
  return h('div', { class: 'gd-chart' },
    h('div', { class: 'gd-axis' }, h('div', {}),
      h('div', { class: 'ticks' }, ...MONTHS.map((m) => h('span', { class: 'tk', style: { left: pct(m.d) } }, m.t))),
      h('div', {})),
    h('div', { class: 'gd-rows' }, ...rows));
}

function build(h, body, tz) {
  const day = todayIndex(tz);
  const nx = nextText(day);
  body.replaceChildren(h('div', { class: 'gd' },
    h('div', { class: 'gd-top' },
      h('div', { class: 'gd-day' }, h('small', {}, 'DAY'), String(Math.max(0, day))),
      h('div', { class: 'gd-st' }, gardenStage(day)),
      h('div', { class: 'gd-light', title: 'Gardyn recommends 14–16 h at full brightness' }, `${LIGHT_HOURS}h ☀`)),
    nx ? h('div', { class: 'gd-next', title: nx.s }, h('b', {}, `${nx.k} · `), `${nx.t}, ${nx.when}`) : null,
    chart(h, day, false)));
}

export default {
  id: 'gardyn',
  title: 'Gardyn',
  icon: '🌸',
  size: 'tall',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;
    const tz = (ctx.config && ctx.config.tz) || 'America/Los_Angeles';
    ctx.style(STYLE);
    build(h, body, tz);
    // The day only changes at midnight — an hourly rebuild is plenty (text + divs only).
    ctx.interval(() => build(h, body, tz), 60 * 60 * 1000);
  },

  // Fullscreen: pod layout, the full care calendar, and per-plant notes.
  openFull(body, ctx) {
    const { h } = ctx;
    const tz = (ctx.config && ctx.config.tz) || 'America/Los_Angeles';
    const day = todayIndex(tz);
    ctx.style(STYLE + `
      .gf { height:100%; overflow:auto; padding:6px 30px 40px; display:flex; flex-direction:column; gap:22px; }
      .gf h3 { font-family:var(--font-mono); font-size:11px; letter-spacing:.18em; color:var(--ink-faint); font-weight:400; margin-bottom:10px; }
      .gf-hero { display:flex; align-items:flex-end; gap:18px; }
      .gf-hero .gd-day { font-size:64px; }
      .gf-hero .st { font-size:22px; font-weight:700; color:var(--mint); }
      .gf-hero .sub { font-size:13px; color:var(--ink-soft); margin-top:4px; }
      .gf-chart .gd-row { height:22px; }
      .gf-chart .gd-row .nm { font-size:14px; }
      .gf-chart .gd-row.fl .nm { font-size:15px; }
      .gf-chart .gd-row, .gf-chart .gd-axis { grid-template-columns: 170px 1fr 70px; }
      .gf-chart .gd-row .rt { font-size:13px; }
      .gf-grid { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
      .gf-pods { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      .gf-pod { display:flex; align-items:center; gap:9px; padding:7px 10px; border:1px solid var(--stroke);
        border-radius:10px; font-size:13px; color:var(--ink); }
      .gf-pod .ps { font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); width:20px; }
      .gf-pod i { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
      .gf-cal { display:flex; flex-direction:column; gap:8px; }
      .gf-ev { display:grid; grid-template-columns:78px 1fr; gap:10px; font-size:13px; line-height:1.35; }
      .gf-ev .dt { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); padding-top:2px; }
      .gf-ev .t { color:var(--ink); font-weight:600; }
      .gf-ev .s { color:var(--ink-soft); }
      .gf-ev.done { opacity:.4; }
      .gf-ev.now .dt, .gf-ev.now .t { color:var(--gold); }
      .gf-notes { display:grid; grid-template-columns:1fr 1fr; gap:10px 22px; }
      .gf-note { font-size:13px; line-height:1.4; color:var(--ink-soft); }
      .gf-note b { color:var(--ink); }
      .gf-src { font-size:11px; color:var(--ink-faint); }
    `);
    const byPos = {};
    for (const p of PLANTS) for (const ps of p.pos) byPos[ps] = p;
    const pods = [];
    for (let i = 1; i <= 8; i++) for (const side of ['L', 'R']) {
      const p = byPos[side + i];
      pods.push(h('div', { class: 'gf-pod' },
        h('span', { class: 'ps' }, side + i),
        h('i', { style: { background: KINDS[p.k].color } }),
        h('span', {}, p.n)));
    }
    const cal = [...CARE, ...recurring().filter((c) => c.d <= 63)].sort((a, b) => a.d - b.d).map((c) => {
      const end = c.to != null ? c.to : c.d;
      const cls = end < day ? 'done' : (day >= c.d && day <= end ? 'now' : '');
      return h('div', { class: `gf-ev ${cls}` },
        h('div', { class: 'dt' }, c.to != null ? `${fmtShort(c.d)}–${fmtShort(c.to).replace(/^\w+ /, '')}` : fmtShort(c.d)),
        h('div', {}, h('div', { class: 't' }, c.t), h('div', { class: 's' }, c.s)));
    });
    const chartEl = chart(h, day, true);
    body.replaceChildren(h('div', { class: 'gf' },
      h('div', { class: 'gf-hero' },
        h('div', { class: 'gd-day' }, h('small', {}, 'DAY'), String(Math.max(0, day))),
        h('div', {},
          h('div', { class: 'st' }, gardenStage(day)),
          h('div', { class: 'sub' }, `${DEVICE} · ${KIT} kit · 16 pods · planted ${fmtShort(0)} · ${LIGHT_HOURS} h light/day (Gardyn recommends 14–16 h)`))),
      h('div', { class: 'gf-chart' }, h('h3', {}, 'TRAJECTORY · SPROUT WINDOW (FAINT) → FIRST BLOOM / FIRST CUT (SOLID)'), chartEl),
      h('div', { class: 'gf-grid' },
        h('div', {}, h('h3', {}, 'POD LAYOUT · TOP → BOTTOM'), h('div', { class: 'gf-pods' }, ...pods)),
        h('div', {}, h('h3', {}, 'CARE CALENDAR'), h('div', { class: 'gf-cal' }, ...cal))),
      h('div', {}, h('h3', {}, 'PLANT NOTES'),
        h('div', { class: 'gf-notes' }, ...PLANTS.map((p) => h('div', { class: 'gf-note' },
          h('b', {}, p.n), ` — ${p.k === 'flower' ? 'blooms' : 'harvest'} ${rangeTxt(p.m)}; ${p.ht}. ${p.note}`)))),
      h('div', { class: 'gf-src' }, 'Timings are Gardyn’s published ranges (help.mygardyn.com) counted from the planting date — estimates, not sensor readings.')));
  },
};
