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

// What the humans have actually done. Recorded from the wall (✓ Done buttons in the
// fullscreen view → POST /api/gardyn/log, persisted server-side); this is only the
// fallback when the server log can't be read. tasks: id → ISO date; water: [{date, kind}].
export const DEFAULT_LOG = {
  tasks: { sprout: '2026-09-28' }, // sprout dose: 1 tsp (white spoon) in 1 gal → tank (3 + 1 = 4 gal)
  water: [],
};

// One-off care tasks (days from sowing). Watering + feeding is NOT here — it's the
// weekly water plan below, anchored on the day the sprout dose was given.
const CARE = [
  // Dose rule is ¼ tsp per gallon for EVERY gallon in the tank. Gardyn's Studio figure
  // (¾ tsp) assumes a 2 gal start; this tank started with 3 gal, so 3 + 1 = 4 gal → 1 tsp
  // (one level white Gardyn spoon, which is 1 tsp).
  { id: 'sprout', ic: 'spoon', short: 'Sprout dose', d: 7, to: 14, t: 'Sprout dose', how: '1 white spoon (1 tsp) food + 1 gal water → tank',
    s: 'Once most pods have sprouted: mix 1 tsp (the white Gardyn spoon, level) of plant food into 1 gal of warm water, shake, pour it all into the tank. Rule: ¼ tsp per gallon in the tank — 3 gal start + this 1 gal = 4 gal. Water only until then.' },
  { id: 'thin', ic: 'scissors', short: 'Thin sprouts', after: 'sprout', d: 5, to: 7, t: 'Mini harvest', how: 'thin: snip extras, keep 1–3 per pod',
    s: '5–7 days after the sprout dose. Cut extras at the base with clean scissors (don’t pull). Keep 1 for greens & sunflower, 3 for herbs and small flowers. Green, lettuce and herb thinnings are edible — that’s the “mini harvest”.' },
  { id: 'replace', ic: 'search', short: 'Check pods', d: 22, t: 'Replacement check', how: 'any pod with no sprout → claim a free one',
    s: 'Any pod still unsprouted today qualifies for Gardyn’s replacement guarantee.' },
  { id: 'petunia', ic: 'flower', short: 'Petunias bloom', d: 30, g: true, t: 'Petunias start blooming', how: 'pinch off spent blooms',
    s: 'First flowers of the kit. Deadhead spent blooms to keep them coming.' },
  { id: 'roots', ic: 'roots', short: 'Check roots', d: 60, g: true, t: 'Check the roots', how: 'healthy = white; trim any brown mush',
    s: 'Plants are maturing and blooming — check roots every 2–4 weeks from now.' },
  { id: 'stock', ic: 'flower', short: 'Stock blooms', d: 65, g: true, t: 'Stock & sunflower blooms', how: 'keep the room under ~75°F for stock',
    s: 'Expect the first stock spikes and sunflowers. Keep the room under ~75°F for stock.' },
  { id: 'snap', ic: 'flower', short: 'Snapdragons', d: 80, g: true, t: 'Snapdragons open', how: 'cut at 45° above a leaf node',
    s: 'Snapdragon blooms arrive in waves.' },
  { id: 'refresh', ic: 'sprout', short: 'Replant', d: 180, t: 'Refresh the garden', how: 'swap tired pods for new ones',
    s: 'Most Gardyn plants last ~6 months — swap tired yCubes for new ones.' },
];

// Line icons (24px grid, round 1.8 stroke, currentColor) — the wall's icon style.
const ICON = {
  drop: '<path d="M12 3.6c3.1 4 6 7.1 6 10.4a6 6 0 0 1-12 0c0-3.3 2.9-6.4 6-10.4z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  scissors: '<circle cx="6.5" cy="7" r="2.6"/><circle cx="6.5" cy="17" r="2.6"/><path d="M8.8 8.4 19.5 17.5M8.8 15.6 19.5 6.5"/>',
  leaf: '<path d="M5 19.5C5 11 10 5 19.5 4.5 19.5 14 14 19 5.5 19"/><path d="M5 19.5c3-4.5 6-7.5 10-10"/>',
  flower: '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8C9.6 7.6 10.2 4 12 3.5c1.8.5 2.4 4.1 0 6.3zM12 14.2c2.4 2.2 1.8 5.8 0 6.3-1.8-.5-2.4-4.1 0-6.3zM9.8 12C7.6 14.4 4 13.8 3.5 12 4 10.2 7.6 9.6 9.8 12zM14.2 12c2.2-2.4 5.8-1.8 6.3 0-.5 1.8-4.1 2.4-6.3 0z"/>',
  sprig: '<path d="M12 21V9"/><path d="M12 14c-4.2 0-6.2-2.3-6.2-5.4 3.3 0 6.2 1.6 6.2 5.4zM12 11c4.2 0 6.2-2.3 6.2-5.4-3.3 0-6.2 1.6-6.2 5.4z"/>',
  spoon: '<ellipse cx="12" cy="7" rx="3.6" ry="4.4"/><path d="M12 11.4V21"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>',
  roots: '<path d="M12 3v8"/><path d="M12 11c-1.5 2.5-4.5 3.8-6.5 8M12 11c1.5 2.5 4.5 3.8 6.5 8M12 11v9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  sprout: '<path d="M12 21v-8"/><path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 13c0-3 2.5-5 6-5 0 3-2.5 5-6 5z"/>',
};
function icon(name, cls = '') {
  const el = document.createElement('span');
  el.className = `ic ${cls}`.trim();
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
  return el;
}
const KIND_ICON = { flower: 'flower', green: 'leaf', herb: 'sprig' };
const WATER_ICON = { top: 'drop', refresh: 'refresh', dose: 'spoon' };

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
const dayOfIso = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - startMs) / DAY);
const endOf = (c) => (c.to != null ? c.to : c.d);

// Tasks resolved against the log: done dates attached, and relative tasks
// (thinning) counted from when the step they follow was actually done.
function tasks(log = DEFAULT_LOG) {
  const done = (log && log.tasks) || {};
  const out = CARE.map((c) => ({ ...c, done: done[c.id] ? dayOfIso(done[c.id]) : null }));
  for (const c of out) if (c.after) {
    const prev = out.find((x) => x.id === c.after);
    const base = prev.done != null ? prev.done : endOf(prev);
    c.d += base; if (c.to != null) c.to += base;
  }
  return out;
}

// Feeding strength follows growth (Gardyn): ¼ tsp/gal from the sprout dose, ½ once
// true leaves / ½ in roots show, 1 tsp once plants mature and bloom.
const TRUE_LEAVES = calDay(21), MATURE = calDay(60);
const perGalOn = (d) => (d < TRUE_LEAVES ? 0.25 : d < MATURE ? 0.5 : 1);
const tsp = (x) => ({ 0.25: '¼', 0.5: '½', 0.75: '¾' }[x] || String(x));
const fmtDay = (d) => dateOf(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// The water plan: the next waterings, every 7 days after the LAST watering you
// recorded (or the sprout dose). A slot ≥ 25 days after the last tank refresh (or
// the first fill on day 0) is a full refresh instead of a top-off. Unrecorded past
// slots stay at the front, shown as overdue, until you mark them done.
export function waterPlan(fromDay, n = 6, log = DEFAULT_LOG) {
  const ts = tasks(log);
  const sprout = ts.find((c) => c.id === 'sprout');
  if (sprout.done == null) {
    return [{ d: Math.max(fromDay, sprout.d), kind: 'dose', t: sprout.t, amt: sprout.how, s: sprout.s }];
  }
  const water = ((log && log.water) || []).map((w) => ({ d: dayOfIso(w.date), kind: w.kind }));
  let anchor = Math.max(sprout.done, ...water.map((w) => w.d));
  let lastRefresh = Math.max(0, ...water.filter((w) => w.kind === 'refresh').map((w) => w.d));
  const out = [];
  for (let k = 1; out.length < n && k < 80; k++) {
    const d = anchor + 7 * k;
    const g = perGalOn(d);
    if (d - lastRefresh >= 25) {
      lastRefresh = d;
      out.push({ d, kind: 'refresh', t: 'Tank refresh', amt: `refill · ${tsp(g * 4)} tsp food`,
        s: `Drain the tank, wipe it with baking soda, rinse, refill to 4 gal and mix in ${tsp(g * 4)} tsp plant food (${tsp(g)} tsp per gallon).` });
    } else {
      out.push({ d, kind: 'top', t: 'Top off to 4 gal', amt: `${tsp(g)} tsp / gal`,
        s: `Check the app’s water tile. For every gallon you add to get back to 4 gal, mix ${tsp(g)} tsp plant food into it first. The water already in the tank keeps its food.` });
    }
  }
  return out;
}

// The next one-off task still to do (not done, window not over).
export function nextTask(day, log = DEFAULT_LOG) {
  return tasks(log).filter((c) => c.done == null && endOf(c) >= day).sort((a, b) => a.d - b.d)[0] || null;
}
// Everything recorded as done, newest last: tasks + waterings.
export function doneLog(log = DEFAULT_LOG) {
  const t = tasks(log).filter((c) => c.done != null).map((c) => ({ id: c.id, t: c.t, d: c.done }));
  const w = ((log && log.water) || []).map((x) => ({ id: 'water', date: x.date, t: x.kind === 'refresh' ? 'Tank refresh' : x.kind === 'dose' ? 'Sprout dose' : 'Top-off', d: dayOfIso(x.date) }));
  return [...t, ...w].sort((a, b) => a.d - b.d);
}
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

// Compat: active = tasks in their window today; upcoming = later tasks.
export function nextCare(day, log = DEFAULT_LOG) {
  const todo = tasks(log).filter((c) => c.done == null).sort((a, b) => a.d - b.d);
  return { active: todo.filter((c) => c.to != null && day >= c.d && day <= c.to), upcoming: todo.filter((c) => c.d > day) };
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
  .gd { display:flex; flex-direction:column; height:100%; min-height:0; gap:9px; }
  .gd-top { flex:0 0 auto; display:flex; align-items:baseline; gap:12px; }
  .gd-day { font-family:var(--font-display); font-weight:700; font-size:44px; line-height:.85; color:var(--ink); }
  .gd-day small { font-size:13px; font-weight:600; color:var(--ink-faint); letter-spacing:.08em; margin-right:5px; }
  .gd-st { font-family:var(--font-display); font-size:20px; font-weight:400; color:var(--mint); }
  .gd-light { margin-left:auto; font-family:var(--font-mono); font-size:10px; color:var(--ink-faint); }
  .gp { flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .gp-cell { display:flex; align-items:center; gap:9px; min-width:0; padding:8px 10px;
    border-radius:14px; background:rgba(255,255,255,.04); }
  .gp-cell.water { --c:#5fb6ff; }
  .gp-cell.task { --c:var(--gold); }
  .gp-ic { width:30px; height:30px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center;
    color:var(--c); background:color-mix(in srgb, var(--c) 16%, transparent); font-size:17px; }
  .gp-tx { flex:1; min-width:0; }
  .gp-d { font-size:11.5px; color:var(--ink-soft); white-space:nowrap; }
  .gp-m { font-size:14px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gp-in { flex:0 0 auto; font-family:var(--font-display); font-size:17px; color:var(--c); }

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
  .ic { display:inline-flex; width:1em; height:1em; flex:0 0 auto; }
  .ic svg { width:100%; height:100%; }
  .gd-row .nm { display:flex; align-items:center; gap:6px; }
  .gd-row .ic.kind { font-size:13px; }
`;

const kindIcon = (k) => { const e = icon(KIND_ICON[k], 'kind'); e.style.color = KINDS[k].color; return e; };
const tip = (p) => `${p.n}${p.pos.length > 1 ? ' ×2' : ''} · pod ${p.pos.join(' & ')} · sprouts ${rangeTxt(p.sp)} · `
  + `${p.k === 'flower' ? 'first blooms' : 'first cut'} ${rangeTxt(p.m)}`;
const bar = (h, cls, a, b, c) => h('div', { class: cls, style: { left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, background: c } });

// One plant = one row (sprout window faint, first bloom / cut window solid).
function row(h, p, day) {
  const c = KINDS[p.k].color;
  const st = plantStatus(p, day);
  const ready = st.phase === 'ready' || st.phase === 'ongoing';
  return h('div', { class: `gd-row${ready ? ' ready' : ''}`, title: tip(p) },
    h('div', { class: 'nm' }, kindIcon(p.k), p.n + (p.pos.length > 1 ? ' ×2' : '')),
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
    h('div', { class: 'nm' }, kindIcon(kind), `${KINDS[kind].label} ×${plants.length}`),
    h('div', { class: 'tr' },
      ...plants.map((p) => bar(h, 'mw', p.m[0], p.m[1], c)),
      day >= 0 && day <= AXIS_DAYS ? h('div', { class: 'now', style: { left: pct(day) } }) : null),
    h('div', { class: 'rt' }, ready ? 'ready' : `${first - day}d`));
}

// "in 3 days" / "today" / "tomorrow" / "overdue 2d".
const inDays = (d, day) => (d === day ? 'today' : d === day + 1 ? 'tomorrow' : d > day ? `in ${d - day} days` : `${day - d}d overdue`);

// The two answers the wall must always give, side by side: the next watering
// (with its food amount) and the next task. Icons carry the meaning; details are
// in the tooltips.
const daysTxt = (d, day) => (d === day ? 'today' : d < day ? `${day - d}d late` : `${d - day}d`);
function planBlock(h, day, log) {
  const w = waterPlan(day, 1, log)[0];
  const t = nextTask(day, log);
  const cell = (cls, ic, d, main, badge, title) => h('div', { class: `gp-cell ${cls}`, title },
    h('div', { class: 'gp-ic' }, icon(ic)),
    h('div', { class: 'gp-tx' }, h('div', { class: 'gp-d' }, fmtDay(d)), h('div', { class: 'gp-m' }, main)),
    h('div', { class: 'gp-in' }, badge));
  return h('div', { class: 'gp' },
    w ? cell('water', WATER_ICON[w.kind], w.d, w.amt, daysTxt(w.d, day), `${w.t} — ${w.s}`) : null,
    t ? cell('task', t.ic, t.d, t.short, day >= t.d ? 'now' : daysTxt(t.d, day), `${t.t} — ${t.s}`) : null);
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

// The care log lives on the wall server (so ✓ Done survives reloads). Shared by the
// tile and the fullscreen view; any change notifies both.
let LOG = DEFAULT_LOG;
async function loadLog() {
  try { const r = await fetch('/api/gardyn', { cache: 'no-store' }); if (r.ok) LOG = (await r.json()).log || LOG; } catch { /* keep last */ }
  return LOG;
}
async function record(body) {
  const r = await fetch('/api/gardyn/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`log ${r.status}`);
  LOG = (await r.json()).log;
  window.dispatchEvent(new Event('gardyn:log'));
}

function build(h, body, tz, log = LOG) {
  const day = todayIndex(tz);
  body.replaceChildren(h('div', { class: 'gd' },
    h('div', { class: 'gd-top' },
      h('div', { class: 'gd-day' }, h('small', {}, 'DAY'), String(Math.max(0, day))),
      h('div', { class: 'gd-st' }, gardenStage(day)),
      h('div', { class: 'gd-light', title: 'Lights 14 h/day Sep 20–22, 16 h/day since Sep 23 (Gardyn recommends 14–16 h)' }, `${LIGHT_HOURS}h ☀`)),
    planBlock(h, day, log),
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
    loadLog().then(() => build(h, body, tz));
    const onLog = () => { if (body.isConnected) build(h, body, tz); else window.removeEventListener('gardyn:log', onLog); };
    window.addEventListener('gardyn:log', onLog);
    // The day only changes at midnight — an hourly refresh is plenty (text + divs only).
    ctx.interval(() => loadLog().then(() => build(h, body, tz)), 60 * 60 * 1000);
  },

  // Fullscreen: headline milestones, the full trajectory, the pod tower and
  // what's coming up. Deliberately light on text — details live in tooltips.
  async openFull(body, ctx) {
    const { h } = ctx;
    const tz = (ctx.config && ctx.config.tz) || 'America/Los_Angeles';
    ctx.style(STYLE + FULL_STYLE);
    await loadLog();
    const render = () => renderFull(h, body, todayIndex(tz), LOG);
    render();
    const onLog = () => { if (body.isConnected) render(); else window.removeEventListener('gardyn:log', onLog); };
    window.addEventListener('gardyn:log', onLog);
  },
};

// ✓ Done / undo button: records to the server, then both views re-render.
function actBtn(h, label, payload, cls = '', title = 'Mark done') {
  const b = h('button', { class: `gx-btn ${cls}`, type: 'button', title, 'aria-label': title }, label);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await record(payload); } catch { b.disabled = false; b.classList.add('err'); }
  });
  return b;
}

function renderFull(h, body, day, log) {
  {

    // Milestone tiles: when each kind first pays off, plus the next care step.
    const firstOf = (k) => Math.min(...PLANTS.filter((p) => p.k === k).map((p) => p.m[0]));
    const tile = (ic, title, d, color, what) => {
      const left = d - day;
      return h('div', { class: 'gx-tile', style: { '--c': color }, title },
        h('div', { class: 'l' }, icon(ic)),
        h('div', { class: 'v' }, left > 0 ? String(left) : '✓', left > 0 ? h('small', {}, 'd') : null),
        h('div', { class: 's' }, left > 0 ? `${what} · ${fmtShort(d)}` : `${what} · now`));
    };
    const plan = waterPlan(day, 4, log);
    const w0 = plan[0];
    const tiles = h('div', { class: 'gx-tiles' },
      tile('leaf', 'First harvest (greens)', firstOf('green'), KINDS.green.color, 'greens'),
      tile('flower', 'First bloom (petunias)', firstOf('flower'), KINDS.flower.color, 'petunias'),
      tile('sprig', 'Herbs ready', firstOf('herb'), KINDS.herb.color, 'herbs'),
      w0 ? tile(WATER_ICON[w0.kind], `Next watering — ${w0.s}`, w0.d, '#5fb6ff', w0.kind === 'refresh' ? 'refresh' : 'top off') : null);

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
        kindIcon(p.k),
        h('span', { class: 'n' }, p.n.replace(/^(Purple|Yellow) (?=Snapdragon|Swiss)/, '')),
        h('span', { class: 'ps' }, side + (i + 1)));
    }));

    // Water & food: the next waterings, each with its exact food amount.
    // Only the NEXT watering can be marked done (it re-anchors the rest).
    const waterRows = plan.map((w, i) => h('div', { class: `gx-row ${w.kind}${i === 0 ? ' next' : ''}`, title: `${w.t} — ${w.s}` },
      h('div', { class: 'ri' }, icon(WATER_ICON[w.kind])),
      h('div', { class: 'rt' }, h('div', { class: 'd' }, fmtDay(w.d)), h('div', { class: 'm' }, w.amt)),
      h('div', { class: 'rn' }, daysTxt(w.d, day)),
      i === 0 ? actBtn(h, icon('check'), w.kind === 'dose' ? { id: 'sprout', action: 'done' } : { id: 'water', kind: w.kind, action: 'done' }) : h('div', { class: 'gx-btn-sp' })));
    // Tasks: the next one-off steps, then what's already done.
    const taskRows = tasks(log).filter((c) => c.done == null && endOf(c) >= day).sort((a, b) => a.d - b.d).slice(0, 4).map((c) => {
      const now = day >= c.d && day <= endOf(c);
      return h('div', { class: `gx-row task${now ? ' now' : ''}`, title: `${c.t} — ${c.how}. ${c.s}` },
        h('div', { class: 'ri' }, icon(c.ic)),
        h('div', { class: 'rt' }, h('div', { class: 'd' }, c.to != null ? `${fmtShort(c.d)}–${fmtShort(c.to).replace(/^\w+ /, '')}` : fmtShort(c.d)),
          h('div', { class: 'm' }, c.short)),
        h('div', { class: 'rn' }, now ? 'now' : daysTxt(c.d, day)),
        // Done only once a task is due or close (no ticking off things weeks away).
        c.d - day <= 3 ? actBtn(h, icon('check'), { id: c.id, action: 'done' }) : h('div', { class: 'gx-btn-sp' }));
    });
    const doneRows = doneLog(log).slice(-3).map((c) => h('div', { class: 'gx-row done', title: `Done ${fmtShort(c.d)}` },
      h('div', { class: 'ri' }, icon('check')),
      h('div', { class: 'rt' }, h('div', { class: 'd' }, fmtShort(c.d)), h('div', { class: 'm' }, c.t)),
      h('div', { class: 'rn' }, ''),
      actBtn(h, icon('refresh'), c.id === 'water' ? { id: 'water', date: c.date, action: 'undo' } : { id: c.id, action: 'undo' }, 'ghost', 'Undo')));

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
        h('section', { class: 'gx-sec water' },
          h('div', { class: 'gx-h' }, h('span', {}, 'Water & food')),
          h('div', { class: 'gx-evs' }, ...waterRows),
          // Feed strength ramp as three chips + the spoon key; the "mix food into the
          // water first" rule lives in each row's tooltip.
          h('div', { class: 'gx-ramp', title: 'Food always goes in the water: mix it into each gallon before pouring. The white Gardyn spoon is 1 tsp.' },
            h('span', { class: 'chip on' }, icon('spoon'), '¼'),
            h('span', { class: 'chip' }, '½ ', h('small', {}, fmtShort(TRUE_LEAVES))),
            h('span', { class: 'chip' }, '1 ', h('small', {}, fmtShort(MATURE))),
            h('span', { class: 'per' }, 'tsp / gal'))),
        h('section', { class: 'gx-sec' },
          h('div', { class: 'gx-h' }, h('span', {}, 'Tasks')),
          h('div', { class: 'gx-evs' }, ...taskRows, ...doneRows))),
      h('section', { class: 'gx-sec' },
        h('div', { class: 'gx-h' }, h('span', {}, 'The tower'), h('span', { class: 'key' }, 'top → bottom')),
        h('div', { class: 'gx-tower' }, col('L'), h('div', { class: 'spine' }), col('R'))),
      h('div', { class: 'gf-src' }, 'Gardyn’s published ranges from sow day, scaled by your light hours (14 h → 16 h on Sep 23) — estimates, not sensor readings.')));
  }
}

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
        min-width:0; }
  .gx-tile.care { --c: #5fb6ff; }
  .gx-tile .l { font-size:22px; color:var(--c); display:flex; }
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
  .gx-tower { display:grid; grid-template-columns:minmax(0,1fr) 2px minmax(0,1fr); gap:0 10px; max-width:520px; margin:0 auto; }
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
  .gx-ev .dt { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); white-space:nowrap; }
  .gx-sec.water .gx-ev { grid-template-columns:72px 1fr auto; }
  .gx-ev .t { font-size:16px; color:var(--ink); }
  .gx-ev .how { font-size:12.5px; color:var(--ink-soft); margin-top:2px; }
  .gx-ev .in { font-family:var(--font-mono); font-size:11px; color:var(--ink-soft); }
  .gx-ev.now .dt, .gx-ev.now .t, .gx-ev.now .in { color:var(--gold); }
  .gx-sec.water .gx-h > span:first-child { color:#5fb6ff; }
  .gx-ev.next .dt, .gx-ev.next .t, .gx-ev.next .in { color:#5fb6ff; }
  .gx-ev.refresh .t::after { content:' ↻'; color:var(--ink-faint); }
  .gx-ev.done .t { color:var(--mint); }
  .gx-ev .act { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .gx-btn { font-family:var(--font); font-size:13px; font-weight:600; color:#042018; background:var(--mint);
    border:none; border-radius:999px; padding:6px 13px; cursor:pointer; white-space:nowrap; }
  .gx-sec.water .gx-btn { background:#5fb6ff; }
  .gx-btn.ghost { background:transparent; color:var(--ink-soft); border:1px solid var(--stroke); padding:4px 11px; font-weight:400; }
  .gx-btn:disabled { opacity:.6; }
  .gx-ev.done { opacity:.7; }
  .gx-routine { margin-top:12px; display:flex; flex-direction:column; gap:5px; font-size:13px; color:var(--ink-soft); }
  .gx-routine b { color:var(--ink); font-weight:600; margin-right:4px; }
  .gf-src { font-size:11px; color:var(--ink-faint); }
  /* icon rows (water / tasks / done) */
  .gx-row { display:grid; grid-template-columns:34px 1fr auto 34px; gap:10px; align-items:center;
    padding:9px 0; border-bottom:1px solid var(--stroke); }
  .gx-row .ri { width:34px; height:34px; border-radius:50%; display:grid; place-items:center; font-size:17px;
    color:var(--c, var(--ink-soft)); background:color-mix(in srgb, var(--c, #fff) 13%, transparent); }
  .gx-row.top, .gx-row.refresh, .gx-row.dose { --c:#5fb6ff; }
  .gx-row.task { --c:var(--gold); }
  .gx-row.done { --c:var(--mint); opacity:.7; }
  .gx-row:not(.next):not(.now):not(.done) .ri { opacity:.6; }
  .gx-row .d { font-size:12px; color:var(--ink-soft); }
  .gx-row .m { font-size:16px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gx-row .rn { font-family:var(--font-display); font-size:18px; color:var(--ink-soft); }
  .gx-row.next .rn, .gx-row.now .rn { color:var(--c); }
  .gx-btn { width:34px; height:34px; padding:0; display:grid; place-items:center; font-size:17px; border-radius:50%; }
  .gx-btn.err { background:var(--rose); }
  .gx-btn.ghost { padding:0; font-size:15px; }
  .gx-btn-sp { width:34px; }
  .gx-ramp { display:flex; align-items:center; gap:6px; margin-top:14px; font-size:15px; color:var(--ink-soft); }
  .gx-ramp .chip { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px;
    background:rgba(255,255,255,.05); color:var(--ink-soft); }
  .gx-ramp .chip.on { background:color-mix(in srgb, #5fb6ff 18%, transparent); color:#5fb6ff; }
  .gx-ramp .chip small { font-size:11px; color:var(--ink-faint); }
  .gx-ramp .per { margin-left:4px; font-size:12px; color:var(--ink-faint); }
  .gx-pod .ic.kind { font-size:13px; }
`;
