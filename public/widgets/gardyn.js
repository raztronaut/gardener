// Gardyn — growth trajectory for the Gardyn Studio 2 "Budding Florist" kit
// (16 pods: 15 varieties, Stock Flower planted twice), sown 2026-09-20 and placed
// per Gardyn's official Studio layout. Lights: 14 h/day Sep 20–22, 16 h/day from
// Sep 23 (see LIGHT_SCHEDULE — growth windows are scaled by actual light hours).
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

const START = '2026-09-20';          // sow day = day 0
// Daily light hours, by the day they took effect (Gardyn recommends 14–16 h).
const LIGHT_SCHEDULE = [{ from: '2026-09-20', h: 14 }, { from: '2026-09-23', h: 16 }];
const LIGHT_HOURS = LIGHT_SCHEDULE[LIGHT_SCHEDULE.length - 1].h; // current schedule
// Gardyn's published ranges don't say which schedule they assume, so treat them as
// the middle of its recommended 14–16 h. Growth after sprouting scales with light
// (daily light integral ∝ hours): a 16 h day = 16/15 of a baseline day. Germination
// is driven by water + warmth, so sprout windows are NOT scaled.
const BASE_HOURS = 15;
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
  { d: 7, to: 14, t: 'Sprout dose', how: '¾ tsp plant food + 1 gal water → tank',
    s: 'Once most pods sprout: remove unsprouted cubes, then mix ¾ tsp Gardyn plant food into 1 gal of water and add it to the 2 gal starting tank (¼ tsp/gal). Water only until then.' },
  { d: 14, to: 21, t: 'Thin the sprouts', how: 'snip extras: keep 1 (greens), 3 (others)',
    s: 'Cut extras at the base (don’t pull). Keep 1 for greens & sunflower, 3 for herbs and small flowers. yCovers can go on after.' },
  { d: 21, g: true, t: 'Feed at ½ tsp / gal', how: 'top-offs: ½ tsp plant food per gal',
    s: 'Once true leaves or ½ in roots appear, mix top-offs at ½ tsp plant food per gallon.' },
  { d: 22, t: 'Replacement check', how: 'no sprout yet → free replacement pod',
    s: 'Any pod still unsprouted today qualifies for Gardyn’s replacement guarantee.' },
  { d: 30, g: true, t: 'Petunias start blooming', how: 'pinch off spent blooms',
    s: 'First flowers of the kit. Deadhead spent blooms to keep them coming.' },
  { d: 60, g: true, t: 'Feed at 1 tsp / gal', how: 'top-offs: 1 tsp plant food per gal',
    s: 'Plants are maturing and blooming — strengthen top-offs to 1 tsp per gallon. Check roots every 2–4 weeks.' },
  { d: 65, g: true, t: 'Stock & sunflower blooms', how: 'keep the room under ~75°F for stock',
    s: 'Expect the first stock spikes and sunflowers. Keep the room under ~75°F for stock.' },
  { d: 80, g: true, t: 'Snapdragons open', how: 'cut at 45° above a leaf node; blooms come in waves',
    s: 'Snapdragon blooms arrive in waves.' },
  { d: 180, t: 'Refresh the garden', how: 'swap tired pods for new ones',
    s: 'Most Gardyn plants last ~6 months — swap tired yCubes for new ones.' },
];
const recurring = () => {
  const out = [];
  for (let d = 7; d <= 180; d += 7) {
    out.push(d % 28 === 0
      ? { d, t: 'Tank refresh', how: 'drain, rinse with baking soda, refill with fed water', s: 'Drain, clean with baking soda, refill with fed water + HydroBoost.', rec: true }
      : { d, t: 'Weekly top-off', how: 'fill to 4 gal with water + plant food + HydroBoost', s: 'Top off to 4 gal with fed water + HydroBoost; keep the tank at least half full.', rec: true });
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
// Light-scaled clock: baseline (15 h) days accumulated by the end of calendar day c.
const hoursOn = (c) => {
  let h = LIGHT_SCHEDULE[0].h;
  for (const s of LIGHT_SCHEDULE) if (Math.round((Date.parse(s.from + 'T00:00:00Z') - startMs) / DAY) <= c) h = s.h;
  return h;
};
// Calendar day on which a baseline-day milestone b is reached.
export function calDay(b) {
  let c = 0, eff = 0;
  for (;;) {
    const r = hoursOn(c) / BASE_HOURS;
    if (eff + r >= b || c > 400) return Math.round(c + (b - eff) / r);
    eff += r; c++;
  }
}
for (const p of PLANTS) { p.base = p.m; p.m = p.m.map(calDay); }
for (const c of CARE) if (c.g) { c.d = calDay(c.d); if (c.to != null) c.to = calDay(c.to); }
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
  .gd-st { font-family:var(--font-display); font-size:20px; font-weight:400; color:var(--mint); }
  .gd-light { margin-left:auto; font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); }
  .gd-next { flex:0 0 auto; font-size:13px; color:var(--ink); }
  .gd-next > div { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gd-next .how { font-size:12px; color:var(--ink-soft); margin-top:2px; }
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
  if (active.length) return { k: 'Now', t: active[0].t, when: `until ${fmtShort(active[0].to)}`, how: active[0].how, s: active[0].s };
  const n = upcoming[0];
  return n ? { k: 'Next', t: n.t, when: fmtShort(n.d), how: n.how, s: n.s } : null;
}

function chart(h, day, detailed) {
  // Ranked by how soon each plant (or group) reaches its first harvest / bloom.
  const soon = (a, b) => a.m[0] - b.m[0] || a.m[1] - b.m[1];
  const of = (k) => PLANTS.filter((p) => p.k === k).sort(soon);
  const first = (ps) => ({ m: [Math.min(...ps.map((p) => p.m[0])), Math.min(...ps.map((p) => p.m[1]))] });
  const rows = detailed
    ? [...PLANTS].sort(soon).map((p) => row(h, p, day))
    : [...of('flower').map((p) => ({ ...p, el: () => row(h, p, day) })),
      ...['green', 'herb'].map((k) => ({ ...first(of(k)), el: () => groupRow(h, k, of(k), day) }))]
      .sort(soon).map((r) => r.el());
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
      h('div', { class: 'gd-light', title: 'Lights 14 h/day Sep 20–22, 16 h/day since Sep 23 (Gardyn recommends 14–16 h)' }, `${LIGHT_HOURS}h ☀`)),
    nx ? h('div', { class: 'gd-next', title: nx.s },
      h('div', {}, h('b', {}, `${nx.k} · `), `${nx.t}, ${nx.when}`),
      nx.how ? h('div', { class: 'how' }, nx.how) : null) : null,
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

  // Fullscreen: headline milestones, the full trajectory, the pod tower and
  // what's coming up. Deliberately light on text — details live in tooltips.
  openFull(body, ctx) {
    const { h } = ctx;
    const tz = (ctx.config && ctx.config.tz) || 'America/Los_Angeles';
    const day = todayIndex(tz);
    ctx.style(STYLE + FULL_STYLE);

    // Milestone tiles: when each kind first pays off, plus the next care step.
    const firstOf = (k) => Math.min(...PLANTS.filter((p) => p.k === k).map((p) => p.m[0]));
    const tile = (label, d, color, verb) => {
      const left = d - day;
      return h('div', { class: 'gx-tile', style: { '--c': color } },
        h('div', { class: 'l' }, label),
        h('div', { class: 'v' }, left > 0 ? String(left) : '✓', left > 0 ? h('small', {}, left === 1 ? 'day' : 'days') : null),
        h('div', { class: 's' }, left > 0 ? `${verb} ${fmtShort(d)}` : 'now'));
    };
    const nx = nextText(day);
    const tiles = h('div', { class: 'gx-tiles' },
      tile('First harvest', firstOf('green'), KINDS.green.color, 'greens ·'),
      tile('First bloom', firstOf('flower'), KINDS.flower.color, 'petunias ·'),
      tile('Herbs ready', firstOf('herb'), KINDS.herb.color, 'from'),
      nx ? h('div', { class: 'gx-tile care', title: nx.s },
        h('div', { class: 'l' }, nx.k === 'Now' ? 'Do now' : 'Next care'),
        h('div', { class: 'v t' }, nx.t),
        h('div', { class: 's', style: { whiteSpace: 'normal' } }, `${nx.when} · ${nx.how || ''}`)) : null);

    // Chart, with a labelled "today" marker above the rows.
    const chartEl = chart(h, day, true);
    if (day >= 0 && day <= AXIS_DAYS) {
      chartEl.querySelector('.gd-axis .ticks')
        .append(h('span', { class: 'tk today', style: { left: pct(day) } }, 'TODAY'));
    }

    // The tower: Studio 2 pods, two columns top → bottom, as the device stands.
    const byPos = {};
    for (const p of PLANTS) for (const ps of p.pos) byPos[ps] = p;
    const col = (side) => h('div', { class: 'gx-col' }, ...Array.from({ length: 8 }, (_, i) => {
      const p = byPos[side + (i + 1)];
      return h('div', { class: 'gx-pod', title: `${p.n} — ${p.note}` },
        h('i', { style: { background: KINDS[p.k].color } }),
        h('span', { class: 'n' }, p.n.replace(/^(Purple|Yellow) (?=Snapdragon|Swiss)/, '')),
        h('span', { class: 'ps' }, side + (i + 1)));
    }));

    // Coming up: the next one-off care steps; the routine collapses to one line.
    const soon = CARE.filter((c) => (c.to != null ? c.to : c.d) >= day).slice(0, 5).map((c) => {
      const now = day >= c.d && day <= (c.to != null ? c.to : c.d);
      return h('div', { class: `gx-ev${now ? ' now' : ''}`, title: c.s },
        h('div', { class: 'dt' }, fmtShort(c.d)),
        h('div', {}, h('div', { class: 't' }, c.t), c.how ? h('div', { class: 'how' }, c.how) : null),
        h('div', { class: 'in' }, now ? 'now' : `${c.d - day}d`));
    });
    const nextRefresh = recurring().find((c) => c.d >= day && c.t === 'Tank refresh');

    body.replaceChildren(h('div', { class: 'gx' },
      h('div', { class: 'gx-hero' },
        h('div', { class: 'gd-day' }, h('small', {}, 'DAY'), String(Math.max(0, day))),
        h('div', { class: 'gx-id' },
          h('div', { class: 'st' }, gardenStage(day)),
          h('div', { class: 'sub' }, `${DEVICE} · ${KIT} · sown ${fmtShort(0)} · ${LIGHT_HOURS}h light since Sep 23`))),
      tiles,
      h('section', { class: 'gx-sec gf-chart' },
        h('div', { class: 'gx-h' }, h('span', {}, 'Trajectory'),
          h('span', { class: 'key' }, h('i', { class: 'k1' }), 'sprouting', h('i', { class: 'k2' }), 'bloom / harvest')),
        chartEl),
      h('div', { class: 'gx-bottom' },
        h('section', { class: 'gx-sec' },
          h('div', { class: 'gx-h' }, h('span', {}, 'The tower'), h('span', { class: 'key' }, 'top → bottom')),
          h('div', { class: 'gx-tower' }, col('L'), h('div', { class: 'spine' }), col('R'))),
        h('section', { class: 'gx-sec' },
          h('div', { class: 'gx-h' }, h('span', {}, 'Coming up')),
          h('div', { class: 'gx-evs' }, ...soon),
          h('div', { class: 'gx-routine' },
            h('div', {}, h('b', {}, 'Every week'), ' top off to 4 gal + plant food'),
            nextRefresh ? h('div', {}, h('b', {}, 'Every 4 weeks'), ` tank refresh · next ${fmtShort(nextRefresh.d)}`) : null))),
      h('div', { class: 'gf-src' }, 'Gardyn’s published ranges from sow day, scaled by your light hours (14 h → 16 h on Sep 23) — estimates, not sensor readings.')));
  },
};

const FULL_STYLE = `
  .panel-card:has(.gx) { background: linear-gradient(180deg, rgba(120,247,176,.06), transparent 160px), #0c1f19; }
  .gx { height:100%; overflow:auto; padding:4px 30px 30px; display:flex; flex-direction:column; gap:22px; }
  .gx-hero { display:flex; align-items:center; gap:22px; }
  .gx-hero .gd-day { font-size:92px; line-height:.8; }
  .gx-hero .gd-day small { display:block; font-size:14px; letter-spacing:.14em; margin:0 0 12px 4px; }
  .gx-id .st { font-family:var(--font-display); font-size:38px; font-weight:400; color:var(--mint); line-height:1; }
  .gx-id .sub { font-size:15px; color:var(--ink-soft); margin-top:8px; }

  .gx-tiles { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
  .gx-tile { border:1px solid var(--stroke); border-radius:18px; padding:14px 16px 13px;
    background:linear-gradient(180deg, color-mix(in srgb, var(--c) 14%, transparent), transparent 70%);
    border-top:3px solid var(--c); min-width:0; }
  .gx-tile.care { --c: var(--gold); }
  .gx-tile .l { font-family:var(--font-mono); font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint); }
  .gx-tile .v { font-family:var(--font-display); font-size:44px; font-weight:700; color:var(--ink); line-height:1.05; margin-top:6px; }
  .gx-tile .v small { font-size:15px; font-weight:400; color:var(--ink-soft); margin-left:5px; }
  .gx-tile .v.t { font-size:22px; line-height:1.1; min-height:48px; display:flex; align-items:flex-end; }
  .gx-tile .s { font-size:13px; color:var(--ink-soft); margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .gx-sec { border:1px solid var(--stroke); border-radius:20px; padding:16px 18px 18px; min-width:0; }
  .gx-h { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:14px;
    font-family:var(--font-mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-faint); }
  .gx-h .key { display:flex; align-items:center; gap:7px; letter-spacing:.08em; text-transform:none; font-size:11px; }
  .gx-h .key i { display:inline-block; width:16px; border-radius:3px; background:var(--ink-soft); margin-left:8px; }
  .gx-h .key i.k1 { height:4px; opacity:.4; }
  .gx-h .key i.k2 { height:8px; }

  .gf-chart .gd-rows { gap:4px; }
  .gf-chart .gd-row { height:24px; }
  .gf-chart .gd-row .nm { font-size:16px; }
  .gf-chart .gd-row, .gf-chart .gd-axis { grid-template-columns: 170px 1fr 52px; }
  .gf-chart .gd-row .rt { font-size:13px; }
  .gf-chart .gd-axis { height:16px; margin:16px 0 6px; }
  .gf-chart .gd-axis .tk { font-size:10px; }
  .gf-chart .gd-axis .tk.today { top:-17px; color:var(--gold); font-weight:600; }

  .gx-bottom { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.1fr); gap:12px; }
  .gx-tower { display:grid; grid-template-columns:minmax(0,1fr) 2px minmax(0,1fr); gap:0 10px; }
  .gx-tower .spine { background:linear-gradient(180deg, transparent, var(--stroke-strong) 8%, var(--stroke-strong) 92%, transparent); border-radius:1px; }
  .gx-col { display:flex; flex-direction:column; gap:3px; }
  .gx-col:first-child .gx-pod { flex-direction:row-reverse; text-align:right; }
  .gx-pod { display:flex; align-items:center; gap:7px; height:34px; min-width:0; }
  .gx-pod i { width:12px; height:12px; border-radius:50%; flex:0 0 auto; box-shadow:0 0 0 3px rgba(255,255,255,.04); }
  .gx-pod .n { flex:1; min-width:0; font-size:13px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gx-pod .ps { font-family:var(--font-mono); font-size:10px; width:16px; color:var(--ink-faint); flex:0 0 auto; }

  .gx-evs { display:flex; flex-direction:column; }
  .gx-ev { display:grid; grid-template-columns:54px 1fr auto; gap:10px; align-items:baseline;
    padding:8px 0; border-bottom:1px solid var(--stroke); }
  .gx-ev:first-child { padding-top:0; }
  .gx-ev .dt { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); }
  .gx-ev .t { font-size:16px; color:var(--ink); }
  .gx-ev .how { font-size:12.5px; color:var(--ink-soft); margin-top:2px; }
  .gx-ev .in { font-family:var(--font-mono); font-size:11px; color:var(--ink-soft); }
  .gx-ev.now .dt, .gx-ev.now .t, .gx-ev.now .in { color:var(--gold); }
  .gx-routine { margin-top:12px; display:flex; flex-direction:column; gap:5px; font-size:13px; color:var(--ink-soft); }
  .gx-routine b { color:var(--ink); font-weight:600; margin-right:4px; }
  .gf-src { font-size:11px; color:var(--ink-faint); }
`;
