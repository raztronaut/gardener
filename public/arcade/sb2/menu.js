// Super Bomberman 2 · Tall — the ORIGINAL battle menus, re-laid out for the wall's 256 x 455.
//
// The pictures are the original's: its VRAM / CGRAM / sprites (data/sb2/assets/menus/,
// tools/sb2/extract/menus.py, NOTES-menus.md, packed by menupack.py) run through the same
// small PPU as the battle (render/ppu.js: BG1 / BG2 16x16 tiles, sprites, the menus'
// subtractive shadows). Only the tilemaps are re-laid out, cell by cell (16 px), to fill
// the taller screen: more stone wall / sky, the panels and the bottom strip at the same
// pixel scale, nothing stretched. Behaviour and timings are the measured ones:
//   title     NORMAL GAME / BATTLE GAME / PASSWORD (only BATTLE GAME goes on), UP/DOWN clamp
//             with $51, A/START $52: the bomb bursts, 15-frame fade, 148 black frames,
//             fade-in 1 step / 2 frames into the mode screen with the menu song
//   mode      SINGLE MATCH / TAG MATCH (TAG does nothing here), switch +2 frames
//   players   1P/2P MAN > COM > OFF, 3P/4P COM <> OFF (LEFT runs backwards), $51; B back
//   rules     COM LEVEL 1-9 and ★ (the wall's own CPU, core/ai_smart.js; level 10, drawn like
//             the silver digits: menupack.py STAR), BATTLE 1-5, TIME 2:00 > 3:00 > 5:00 > inf
//             > 1:00, G-BOMBER
//   stage     STAGE 1-10 (silent, the preview mosaic: 46 frames), and the wall's extra row
//             under the preview: the arena TALL / CLASSIC (UP/DOWN picks the row; the
//             active row's arrows animate). TALL shows the real tall arena in miniature.
//             A/START: $52, the bombers' "go" (98 frames), fade-out, black, the match
//             (+331 frames to the first bright battle frame, like the original).
// Held d-pad: acts at once, again after 19 frames, then every 17 (measured).
//
//   const mp = await loadMenuPack();
//   const menu = createMenu(mp, { audio, settings, onStart(settings), onExit() });
//   per SNES frame: menu.frame(heldBits) -> menu.out (Uint32 RGBA 256 x 455)
//   menu.press(bit) on a button edge; menu.show('title' | 'mode' | 'results', ...)
import { createPPU } from './render/ppu.js';
import { ASSET_BASE, fetchIO } from './render/pack.js';

const W = 256, H = 455, ROWS = 29;
const BT = { B: 1, Y: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, A: 256, X: 512, L: 1024, R: 2048 };
const BG1_MAP = 0x8000, BG2_MAP = 0xA000;
const SFX_CURSOR = 0x51, SFX_CONFIRM = 0x52;
// tall rows (16 px cells) of the re-laid out screens
const MENU_T = 8;            // panel rows of mode / players / rules: original rows 1..9 at 8..16
const STRIP_SHIFT = 15;      // original rows 10..13 (wall top, kerb, road) -> 25..28
const ST_T = 2;              // stage select panel: rows 2..18
const ST_HOLE = 3;           // preview hole rows from 3 (13 tall, 7 classic), cols 2..8
const ST_LAYOUT_ROW = 17;    // the arena row (TALL / CLASSIC)
const ST_SKIN_ROW = 19;      // the skin row (GARDEN / CLASSIC), when the wall has both skins
const TITLE_D = 6;           // title: logo / items / sprites 6 rows lower, buildings at rows 24..28
const SCREEN_COL = { mode: 0, players: 16, rules: 32, stage: 48 };
const GREEN = 0x12EC;
const CURSOR = [0x1280, 0x1264, 0x1268, 0x126C];       // 8 frames each (elements.cursor_anim)
const ITEM_ROWS = { mode: [4, 6], players: [2, 4, 6, 8], rules: [2, 4, 6, 8] };   // original rows
const TIMES = [2, 3, 5, Infinity, 1];                  // TIME order (RIGHT)
const TIME_VAR = { 1: '1min', 2: '2min', 3: '3min', 5: '5min' };

function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      res({ w: im.width, h: im.height, px: new Uint32Array(g.getImageData(0, 0, im.width, im.height).data.buffer) });
    };
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function loadMenuPack(io = fetchIO()) {
  const manifest = await io.json('pack/menu.json');
  const bin = new Uint8Array(await io.bin('pack/' + manifest.bin));
  const blob = (n) => { const e = manifest.blobs[n]; if (!e) throw new Error('menu pack: no ' + n); return bin.subarray(e[0], e[0] + e[1]); };
  const mini = typeof Image !== 'undefined' ? await loadImage(ASSET_BASE + 'pack/' + manifest.mini.atlas) : null;
  return { manifest, blob, mini };
}

export function createMenu(mp, opts = {}) {
  const M = mp.manifest, blob = mp.blob;
  const audio = opts.audio || null;
  const sfx = (id) => { if (audio) audio.playSfx(id); };
  const ppu = createPPU(H);
  const out = new Uint32Array(W * H);
  const v = ppu.vram;
  const set = opts.settings;      // shared, mutated: players[4], level, wins, time, gbomber, stage, layout

  // ---- VRAM groups ----------------------------------------------------------------------
  const mapAddr = (base, tx, ty) => base + ((ty & 31) * 32 + (tx & 31)) * 2 + (tx & 32 ? 0x800 : 0) + (ty & 32 ? 0x1000 : 0);
  const rd = (vr, base, tx, ty) => { const a = mapAddr(base, tx, ty); return vr[a] | (vr[a + 1] << 8); };
  const put = (base, tx, ty, e) => { const a = mapAddr(base, tx, ty); v[a] = e & 0xFF; v[a + 1] = e >> 8; };
  // the original maps, kept before the re-layout overwrites columns 0..15
  const vtitle = blob('vram.title'), vmenu = blob('vram.menu');
  const orig = { title1: [], title2: [], menu: {} };
  for (let r = 0; r < 14; r++) {
    orig.title1.push(Array.from({ length: 16 }, (_, c) => rd(vtitle, BG1_MAP, 16 + c, r)));
    orig.title2.push(Array.from({ length: 16 }, (_, c) => rd(vtitle, BG2_MAP, c, r)));
  }
  for (const k of Object.keys(SCREEN_COL)) {
    orig.menu[k] = [];
    for (let r = 0; r < 14; r++) orig.menu[k].push(Array.from({ length: 16 }, (_, c) => rd(vmenu, BG1_MAP, SCREEN_COL[k] + c, r)));
  }
  let group = '', groupStage = 0;
  function loadGroup(g, stage) {
    if (g === group && (g !== 'menu' || stage === groupStage)) return;
    const cg = g === 'title' ? blob('cgram.title') : stage ? blob('cgram.' + String(stage).padStart(2, '0')) : blob('cgram.menu');
    if (g !== group) {
      v.set(g === 'title' ? vtitle : vmenu);
      const regs = { ...M.ppu[g === 'title' ? 'title' : 'stage'] };
      regs.bg1_hofs = 0; regs.bg1_vofs = 1023; regs.bg3_sc_base = 0; regs.tm = (regs.tm & ~4); regs.ts = regs.ts & ~4;
      if (g === 'title') { regs.bg2_hofs = 0; regs.bg2_vofs = 1023; }
      ppu.configure(regs);
      ppu.setWindowLines(() => [0, 255]);
      ppu.setObjBase((regs.obj_name_base * 2) & 0xFFFF, (regs.obj_name_base2 * 2) & 0xFFFF);
    }
    if (g === 'menu' && stage) ppu.writeVram(0, blob('chars.' + String(stage).padStart(2, '0')));
    for (let k = 0; k < 256; k++) ppu.cgram[k] = cg[2 * k] | (cg[2 * k + 1] << 8);
    ppu.forceAll();
    group = g; groupStage = g === 'menu' ? stage : 0;
  }

  // ---- sprite pieces (strip, go) ------------------------------------------------------------
  const pieceBytes = blob('pieces');
  // per menu instance (the wall keeps one menu per skin; the pieces' objects are shared)
  const gfxOf = new Map();
  const pieceGfx = (p) => {
    let g = gfxOf.get(p);
    if (g === undefined) { g = ppu.addGfx(pieceBytes.subarray(p.i * 256, p.i * 256 + p.w * p.h), p.w, p.h); gfxOf.set(p, g); }
    return g;
  };
  const o = ppu.oam;
  function spr(x, y, w, h, pal, prio, gfx, hf = 0, vf = 0) {
    if (o.n >= 256) return;
    const k = o.n++;
    o.x[k] = x; o.y[k] = y; o.w[k] = w; o.h[k] = h; o.pal[k] = pal; o.prio[k] = prio; o.hf[k] = hf; o.vf[k] = vf; o.gfx[k] = gfx;
  }

  // ---- stone wall / sky rows for the taller screens ------------------------------------------
  const STONE = [0x12CE, 0x12CE, 0x12CE, 0x12AC, 0x12CE, 0x12E2, 0x12CE, 0x12E6, 0x12CE, 0x124E];
  const stoneAt = (r, c) => { const h = ((r * 7919 + c * 104729) ^ (r * c * 31)) >>> 0; return STONE[(h >> 3) % STONE.length]; };

  function menuRows(screen) {            // 29 rows of 16 BG1 entries
    const s = orig.menu[screen], rows = [];
    for (let r = 0; r < ROWS; r++) {
      if (r >= MENU_T && r <= MENU_T + 8) rows.push(s[r - MENU_T + 1].slice());
      else if (r >= 10 + STRIP_SHIFT) rows.push(s[r - STRIP_SHIFT].slice());
      else rows.push(Array.from({ length: 16 }, (_, c) => stoneAt(r, c)));
    }
    // stone either side of the panel, like the original's columns 0 and 15
    for (let r = MENU_T; r <= MENU_T + 8; r++) { rows[r][0] = stoneAt(r, 0); rows[r][15] = stoneAt(r, 15); }
    // item rows without the cursor: the panel side + the divider (the cursor is animated)
    for (const r of ITEM_ROWS[screen]) { rows[r - 1 + MENU_T][1] = 0x1222; rows[r - 1 + MENU_T][2] = 0x1202; }
    return rows;
  }
  function stageRows() {
    const s = orig.menu.stage, rows = [];
    const bottom = skinRow ? ST_SKIN_ROW + 1 : ST_T + 16;
    for (let r = 0; r < ROWS; r++) {
      if (r >= 10 + STRIP_SHIFT) { rows.push(s[r - STRIP_SHIFT].slice()); continue; }
      const row = Array.from({ length: 16 }, (_, c) => stoneAt(r, c));
      if (r === ST_T) for (let c = 1; c <= 14; c++) row[c] = s[1][c];
      else if (r > ST_T && r < bottom) {
        row[1] = 0x1222; row[14] = 0x1224;
        for (let c = 2; c <= 13; c++) row[c] = GREEN;
        if (r === ST_LAYOUT_ROW - 1 || (skinRow && r === ST_SKIN_ROW - 1)) { row[1] = 0x1244; row[14] = 0x1242; for (let c = 2; c <= 13; c++) row[c] = 0x1200; }
      } else if (r === bottom) for (let c = 1; c <= 14; c++) row[c] = s[9][c];
      rows.push(row);
    }
    // the right column: STAGE label (orig row 2) and the number row (orig row 4)
    for (let c = 9; c <= 13; c++) { rows[ST_HOLE][c] = s[2][c]; rows[ST_HOLE + 2][c] = s[4][c]; }
    return rows;
  }
  const CLOUDS_TOP = [[1, 6, [0x124A, 0x124C]], [3, 10, [0x1202, 0x1204, 0x1206]], [4, 10, [0x1208, 0x120A, 0x120C]]];
  const CLOUDS_MID = [[17, 12, [0x124A, 0x124C]], [19, 2, [0x1202, 0x1204, 0x1206]], [20, 2, [0x1208, 0x120A, 0x120C]], [22, 9, [0x124A, 0x124C]]];
  function titleRows() {
    const b1 = [], b2 = [];
    for (let r = 0; r < ROWS; r++) {
      const o1 = r - TITLE_D;
      b1.push(o1 >= 0 && o1 < 14 ? orig.title1[o1].slice() : new Array(16).fill(0x2000));
      if (r >= 24) b2.push(orig.title2[Math.min(13, r - 14)].slice());     // buildings + the ground row
      else if (o1 >= 0 && o1 < 10) b2.push(orig.title2[o1].slice());
      else b2.push(new Array(16).fill(0x1200));
    }
    for (const [r, c, es] of [...CLOUDS_TOP, ...CLOUDS_MID]) es.forEach((e, k) => { b2[r][c + k] = e; });
    return { b1, b2 };
  }
  function writeRows(base, rows) { for (let r = 0; r < ROWS; r++) for (let c = 0; c < 16; c++) put(base, c, r, rows[r][c]); }

  // ---- state ---------------------------------------------------------------------------------
  let screen = 'title', frameNo = 0;
  let cursor = 1;                 // title: on BATTLE GAME (NORMAL GAME / PASSWORD do nothing here)
  let bright = 15, fade = null;   // fade: { from, to, step frames, at }
  let busy = 0;                   // frames of ignored input (switches, transitions)
  const timers = [];              // [frame, fn]
  const later = (n, fn) => timers.push([frameNo + n, fn]);
  let stageRow = 0;               // stage select: 0 = STAGE, 1 = the arena row, 2 = the skin row
  // the skin row (GARDEN / CLASSIC): only when the wall has both skins and the pack has the word
  const skinRow = !!(opts.skins && opts.skins.length > 1 && M.words.GARDEN);
  let trans = null;               // preview transition { f, oldStage, oldLayout }
  let going = -1;                 // "go" frames after START on stage select
  let titleConfirm = -1;
  let held = 0, rptBit = 0, rptAt = 0;
  let rowsCache = null;

  function fadeTo(to, every, done) { fade = { to, every, n: 0, done }; }

  // ---- screens ------------------------------------------------------------------------------
  function enter(name, { keepCursor = false } = {}) {
    screen = name;
    if (!keepCursor) cursor = name === 'title' ? 1 : 0;
    if (name === 'title') {
      loadGroup('title');
      const { b1, b2 } = titleRows();
      writeRows(BG1_MAP, b1); writeRows(BG2_MAP, b2);
    } else {
      loadGroup('menu', name === 'stage' ? set.stage : 0);
      rowsCache = name === 'stage' ? stageRows() : menuRows(name === 'results' ? 'players' : name);
      holeShown = '';
      writeRows(BG1_MAP, rowsCache);
      if (name === 'stage') stageBG2();
      else {
        // BG2 shows through the panel on the mode screen (its text layer): the original's
        // scroll, moved down with the panel (original row 1 -> MENU_T)
        const r = M.ppu[name === 'results' ? 'players' : name];
        ppu.L[2].hofs = r.bg2_hofs & 0x3FF; ppu.L[2].vofs = (r.bg2_vofs - (MENU_T - 1) * 16) & 0x3FF; ppu.L[2].force = true;
      }
    }
    refresh();
  }
  function stageBG2(stage = set.stage, dx = 0, dy = 0, empty = false) {
    const st = M.stages[stage - 1];
    ppu.L[2].hofs = (st.bg2_hofs + dx) & 0x3FF;
    ppu.L[2].vofs = ((empty ? 767 : st.bg2_vofs - (ST_HOLE - 2) * 16) + dy) & 0x3FF;
    ppu.L[2].force = true;
  }

  // values -> map cells
  const variants = (list, item) => { const e = list.find((x) => x.item === item); const m = {}; for (const x of e.variants) m[x.name] = x.entries; return m; };
  const PV = [0, 1, 2, 3].map((i) => variants(M.elements.players_values, i));
  const RV = [0, 1, 2, 3].map((i) => variants(M.elements.rules_values, i));
  const ptype = (i) => { const t = set.players[i]; return t === 'human' ? 'MAN' : t === 'off' ? 'OFF' : 'COM'; };
  function rowsOf(name) { return name === 'stage' ? null : ITEM_ROWS[name === 'results' ? 'players' : name].map((r) => r - 1 + MENU_T); }
  let results = null;           // { wins[4], winner (slot | null), matchOver, figure }
  function refresh() {
    if (screen === 'players') for (let i = 0; i < 4; i++) cells(rowsOf('players')[i], 11, PV[i][ptype(i)]);
    if (screen === 'rules') {
      const rr = rowsOf('rules');
      cells(rr[0], 11, set.level === 10 && M.words.STAR ? [GREEN, M.words.STAR[0], GREEN] : RV[0][String(Math.min(9, set.level))]);
      cells(rr[1], 11, RV[1][String(set.wins)]);
      cells(rr[2], 11, RV[2][set.time === Infinity ? 'inf' : TIME_VAR[set.time]]);
      cells(rr[3], 11, RV[3][set.gbomber ? 'ON' : 'OFF']);
    }
    if (screen === 'results' && results) {
      const rr = rowsOf('players');
      for (let i = 0; i < 4; i++) {
        const w = results.wins[i] || 0;
        cells(rr[i], 11, set.players[i] === 'off' ? PV[i].OFF : w === 0 ? [GREEN, M.words.DIGIT0[0], GREEN] : RV[1][String(Math.min(5, w))] || [GREEN, 0x1160 + 2 * (w - 1), GREEN]);
      }
    }
    if (screen === 'stage') {
      put(BG1_MAP, 11, ST_HOLE + 2, M.stage_select.number_cell.entries[String(set.stage)]);
      hole(trans ? trans.oldLayout : set.layout);
      const word = M.words[set.layout === 'tall' ? 'TALL' : 'CLASSIC'];
      for (let c = 2; c <= 13; c++) put(BG1_MAP, c, ST_LAYOUT_ROW, GREEN);
      const c0 = 8 - (word.length >> 1);
      word.forEach((e, k) => put(BG1_MAP, c0 + k, ST_LAYOUT_ROW, e));
      layoutArrowCols = [c0 - 1, c0 + word.length];
      if (skinRow) {
        const sw = M.words[set.skin === 'classic' ? 'CLASSIC' : 'GARDEN'];
        for (let c = 2; c <= 13; c++) put(BG1_MAP, c, ST_SKIN_ROW, GREEN);
        const s0 = 8 - (sw.length >> 1);
        sw.forEach((e, k) => put(BG1_MAP, s0 + k, ST_SKIN_ROW, e));
        skinArrowCols = [s0 - 1, s0 + sw.length];
      }
    }
  }
  let layoutArrowCols = [5, 10], skinArrowCols = [4, 11];
  let holeShown = '';
  // the preview hole: 7 x 13 cells (TALL) or 7 x 7 + panel green below (CLASSIC)
  function hole(layout) {
    if (layout === holeShown) return;
    holeShown = layout;
    for (let r = ST_HOLE; r < ST_HOLE + 13; r++) for (let c = 2; c <= 8; c++) put(BG1_MAP, c, r, layout === 'tall' || r < ST_HOLE + 7 ? 0 : GREEN);
  }
  function cells(row, col, entries) { entries.forEach((e, k) => put(BG1_MAP, col + k, row, e)); }

  // ---- animations -----------------------------------------------------------------------------
  function animate() {
    // the mode screen's text shows BG2 through it, scrolled 1 px every 4 frames (measured)
    if (screen === 'mode' && (frameNo & 3) === 0) { ppu.L[2].hofs = (ppu.L[2].hofs + 1) & 0x3FF; }
    if (screen === 'mode' || screen === 'players' || screen === 'rules' || screen === 'results') {
      const rr = screen === 'mode' ? ITEM_ROWS.mode.map((r) => r - 1 + MENU_T) : rowsOf(screen);
      const e = CURSOR[(frameNo >> 3) & 3];
      const at = screen === 'results' ? (results && results.winner != null ? results.winner : -1) : cursor;
      rr.forEach((r, k) => {
        if (k === at) { put(BG1_MAP, 1, r, e); put(BG1_MAP, 2, r, e + 2); }
        else { put(BG1_MAP, 1, r, rowsCache[r][1]); put(BG1_MAP, 2, r, rowsCache[r][2]); }
      });
    }
    if (screen === 'stage') {
      const A = M.stage_select.arrows_anim.slice(1, 5);
      const a = A[(frameNo >> 3) & 3];
      // the active row's arrows animate; the other row's stay still
      const still = A[0];
      const s = stageRow === 0 ? a : still, l = stageRow === 1 ? a : still, k = stageRow === 2 ? a : still;
      if (skinRow) { put(BG1_MAP, skinArrowCols[0], ST_SKIN_ROW, k.left); put(BG1_MAP, skinArrowCols[1], ST_SKIN_ROW, k.right); }
      put(BG1_MAP, 10, ST_HOLE + 2, s.left); put(BG1_MAP, 12, ST_HOLE + 2, s.right);
      put(BG1_MAP, layoutArrowCols[0], ST_LAYOUT_ROW, l.left); put(BG1_MAP, layoutArrowCols[1], ST_LAYOUT_ROW, l.right);
    }
  }

  function sprites() {
    o.n = 0;
    if (screen === 'title') {
      // the cursor (sprite 0) first, then the static ones; everything 96 px lower
      const dy = TITLE_D * 16;
      const tc = M.title_cursor;
      if (titleConfirm >= 0) {
        const f = tc.confirm[titleConfirm];
        if (f) spr(f.x, f.y + dy + cursor * 16, 16, 16, f.pal, 3, ppu.vramObj(f.tile, 16));
      } else {
        const idle = tc.idle;
        let t = frameNo % 53, k = 0, acc = 0;
        const cyc = [[2, 9], [4, 15], [2, 13], [0, 16]];
        for (k = 0; k < 4; k++) { acc += cyc[k][1]; if (t < acc) break; }
        const tile = cyc[Math.min(k, 3)][0];
        spr(idle[0].x, 144 + cursor * 16 + dy, 16, 16, 0, 3, ppu.vramObj(tile, 16));
      }
      for (const s of M.title_sprites) if (s.y < 224) spr(s.x, s.y + dy, s.w, s.h, s.pal, s.prio, ppu.vramObj(s.tile, s.w), s.hflip ? 1 : 0, s.vflip ? 1 : 0);
      return;
    }
    // the bottom strip (every menu screen), 240 px lower; the "go" run after START
    const dy = STRIP_SHIFT * 16;
    if (going >= 0) {
      const fr = M.go.runs[0].frames;
      const list = fr[Math.min(going, fr.length - 1)];
      for (const [id, x, y, prio] of list) { const p = M.go.pieces[id]; spr(x, y + dy, p.w, p.h, p.pal, prio, pieceGfx(p)); }
      return;
    }
    const st = M.strip;
    let t = frameNo % st.period, f = 0;
    for (; f < st.frames.length; f++) { if (t < st.frames[f].duration) break; t -= st.frames[f].duration; }
    const fr = st.frames[Math.min(f, st.frames.length - 1)];
    for (const [id, x, y, prio] of fr.pieces) { const p = st.pieces[id]; spr(x, y + dy, p.w, p.h, p.pal, prio, pieceGfx(p)); }
  }

  // ---- the stage preview: transition, mini map, mosaic ------------------------------------------
  const CH = M.stage_select.change_transition;
  function previewStep() {
    if (!trans) { stageBG2(); return { mosaic: 0, showMini: set.layout === 'tall' || !!mp.miniOrig, layout: set.layout, stage: set.stage, dx: 0, dy: 0 }; }
    const e = CH[Math.min(trans.f, CH.length - 1)];
    const phase = trans.f <= 20 ? 'old' : trans.f <= 30 ? 'empty' : 'new';
    const stage = phase === 'old' ? trans.oldStage : set.stage;
    const layout = phase === 'old' ? trans.oldLayout : set.layout;
    const base = M.stages[(phase === 'empty' ? set.stage : stage) - 1];
    const dx = phase === 'empty' ? 0 : e.bg2_hofs - (phase === 'old' ? M.stages[0].bg2_hofs : M.stages[1].bg2_hofs);
    const dy = phase === 'empty' ? 0 : e.bg2_vofs - 479;
    if (phase === 'new' && groupStage !== set.stage) loadGroup('menu', set.stage);
    stageBG2(stage, dx, dy, phase === 'empty');
    if (phase !== 'empty') hole(layout);
    if (phase === 'old' && layout === 'classic' && set.layout === 'tall') { /* old 7x7 stays */ }
    trans.f++;
    if (trans.f >= 46) { trans = null; }
    return { mosaic: e.mosaic_size, showMini: phase !== 'empty' && (layout === 'tall' || !!mp.miniOrig), layout, stage, dx, dy, empty: phase === 'empty' };
  }
  const bmul = new Uint8Array(32);
  function holePost(pv) {
    const x0 = 32, y0 = ST_HOLE * 16, hw = 112, hh = pv.layout === 'tall' ? 208 : 112;
    const m = pv.mosaic ? pv.mosaic + 1 : 1;
    // mosaic blocks aligned like the original's (its hole was at (32, 32))
    const gx = x0 - 32, gy = y0 - 32;
    // the TALL preview is the port's own mini map; a skin may bring one for CLASSIC too
    const mini = pv.layout === 'tall' ? mp.mini : mp.miniOrig;
    const b = bright;
    for (let c = 0; c < 32; c++) bmul[c] = ((b >= 15 ? c : Math.round(c * b / 15)) << 3) | ((b >= 15 ? c : Math.round(c * b / 15)) >> 2);
    if (pv.showMini && mini) {
      const mx = (pv.stage - 1) * 112;
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const sx = x0 + x, sy = y0 + y;
        let ux = m > 1 ? (sx - gx) - ((sx - gx) % m) + gx : sx, uy = m > 1 ? (sy - gy) - ((sy - gy) % m) + gy : sy;
        ux = Math.min(hw - 1, Math.max(0, ux - x0 + (pv.dx | 0))); uy = Math.min(hh - 1, Math.max(0, uy - y0 + (pv.dy | 0)));
        let c = mini.px[uy * mini.w + mx + ux];
        if (b < 15) c = scaleRGBA(c, b);
        out[sy * W + sx] = c;
      }
    } else if (m > 1) {
      const idx = ppu.L[2].idx, cg = ppu.cgram;
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const sx = x0 + x, sy = y0 + y;
        const ux = (sx - gx) - ((sx - gx) % m) + gx, uy = (sy - gy) - ((sy - gy) % m) + gy;
        const k = idx[Math.max(0, Math.min(H - 1, uy)) * W + Math.max(0, Math.min(W - 1, ux))];
        const cv = cg[k];
        out[sy * W + sx] = 0xFF000000 | (bmul[(cv >> 10) & 31] << 16) | (bmul[(cv >> 5) & 31] << 8) | bmul[cv & 31];
      }
    }
  }
  // the between-round figure (sprites/screen_bombers.png, the game's own frames and
  // timings) standing on the stone wall above the panel
  function blitFigure(fig) {
    const fr = fig.frames;
    if (!fr || !fr.length || !fig.atlas) return;
    let t = frameNo % fig.period, k = 0;
    for (; k < fr.length; k++) { if (t < fr[k][4]) break; t -= fr[k][4]; }
    const [fx, fy, fw, fh] = fr[Math.min(k, fr.length - 1)];
    const A = fig.atlas, x0 = (W - fw) >> 1, y0 = MENU_T * 16 - 8 - fh;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const c = A.px[(fy + y) * A.w + fx + x];
      if ((c >>> 24) < 128) continue;
      const sy = y0 + y, sx = x0 + x;
      if (sy >= 0 && sy < H && sx >= 0 && sx < W) out[sy * W + sx] = bright < 15 ? scaleRGBA(c, bright) : c;
    }
  }
  function scaleRGBA(c, b) {
    const f = b / 15;
    return 0xFF000000 | ((((c >> 16) & 255) * f) << 16) | ((((c >> 8) & 255) * f) << 8) | ((c & 255) * f);
  }

  // ---- input --------------------------------------------------------------------------------
  const DIRS = BT.UP | BT.DOWN | BT.LEFT | BT.RIGHT;
  function press(bit) {
    if (bit & DIRS) { rptBit = bit; rptAt = frameNo + 19; }
    act(bit);
  }
  function act(bit) {
    if (busy > 0 || fade || going >= 0 || titleConfirm >= 0) return;
    const up = bit === BT.UP, down = bit === BT.DOWN, ok = bit === BT.A || bit === BT.START;
    const d = bit === BT.RIGHT ? 1 : bit === BT.LEFT ? -1 : 0;
    if (screen === 'title') {
      if (up && cursor > 0) { cursor--; sfx(SFX_CURSOR); }
      else if (down && cursor < 2) { cursor++; sfx(SFX_CURSOR); }
      else if (ok && cursor === 1) {
        sfx(SFX_CONFIRM);
        titleConfirm = 0;
        later(1, () => fadeTo(0, 1, () => {
          if (audio) audio.stopMusic(0.05);
          later(117, () => { if (audio) audio.playMusic('menu'); });
          later(148, () => { titleConfirm = -1; bright = 0; enter('mode'); fadeTo(15, 2, null); });
        }));
      } else if (bit === BT.B && opts.onExit) opts.onExit();
      return;
    }
    if (screen === 'mode') {
      if (up && cursor > 0) { cursor--; sfx(SFX_CURSOR); }
      else if (down && cursor < 1) { cursor++; sfx(SFX_CURSOR); }
      else if (ok && cursor === 0) { sfx(SFX_CONFIRM); busy = 2; later(2, () => enter('players')); }
      return;
    }
    if (screen === 'players' || screen === 'rules') {
      if (up && cursor > 0) { cursor--; sfx(SFX_CURSOR); }
      else if (down && cursor < 3) { cursor++; sfx(SFX_CURSOR); }
      else if (d) { if (change(screen, cursor, d)) { sfx(SFX_CURSOR); refresh(); save(); } }
      else if (ok) { sfx(SFX_CONFIRM); busy = 3; later(3, () => { if (screen === 'players') enter('rules'); else { enter('stage'); stageRow = 0; startTrans(set.stage, set.layout); busy = 43; } }); }
      else if (bit === BT.B) { busy = 2; later(2, () => enter(screen === 'players' ? 'mode' : 'players', { keepCursor: false })); }
      return;
    }
    if (screen === 'results') {
      if (ok || bit === BT.B) { if (results && results.onDone) { const f = results.onDone; results.onDone = null; f(); } }
      return;
    }
    if (screen === 'stage') {
      if (trans) return;
      if (up || down) {
        const r = Math.max(0, Math.min(skinRow ? 2 : 1, stageRow + (up ? -1 : 1)));
        if (r !== stageRow) { stageRow = r; sfx(SFX_CURSOR); }
        return;
      }
      if (d && stageRow === 2) {
        // the skin: the wall swaps the whole picture (menus included) to the other skin
        const order = opts.skins;
        set.skin = order[(order.indexOf(set.skin) + d + order.length) % order.length];
        sfx(SFX_CURSOR); save();
        if (opts.onSkin) opts.onSkin(set.skin);
        return;
      }
      if (d && stageRow === 0) {
        const old = set.stage;
        set.stage = ((set.stage - 1 + d + 10) % 10) + 1;
        startTrans(old, set.layout); refresh(); save();
      } else if (d && stageRow === 1) {
        const old = set.layout;
        set.layout = set.layout === 'tall' ? 'classic' : 'tall';
        startTrans(set.stage, old); refresh(); save();
      } else if (ok) {
        later(2, () => sfx(SFX_CONFIRM));
        going = 0;
        later(98, () => fadeTo(0, 1, () => {
          if (audio) audio.stopMusic(0.1);
          later(204, () => { going = -1; if (opts.onStart) opts.onStart(set); });
        }));
      } else if (bit === BT.B) { busy = 3; later(3, () => enter('rules', { keepCursor: false })); }
    }
  }
  function startTrans(oldStage, oldLayout) { trans = { f: 0, oldStage, oldLayout }; }
  function change(scr, item, d) {
    if (scr === 'players') {
      const seq = item < 2 ? ['human', 'cpu', 'off'] : ['cpu', 'off'];
      const k = seq.indexOf(set.players[item]);
      set.players[item] = seq[(Math.max(0, k) + d + seq.length) % seq.length];
      return true;
    }
    if (item === 0) { const n = M.words.STAR ? 10 : 9; set.level = ((Math.min(n, set.level) - 1 + d + n) % n) + 1; }   // 1..9, ★
    else if (item === 1) set.wins = ((set.wins - 1 + d + 5) % 5) + 1;
    else if (item === 2) { const k = TIMES.indexOf(set.time); set.time = TIMES[(Math.max(0, k) + d + TIMES.length) % TIMES.length]; }
    else set.gbomber = !set.gbomber;
    return true;
  }
  const save = () => { if (opts.onChange) opts.onChange(set); };

  // ---- one frame (60.0988 Hz) -----------------------------------------------------------------
  function frame(heldBits) {
    held = heldBits;
    frameNo++;
    if (busy > 0) busy--;
    for (let k = timers.length - 1; k >= 0; k--) if (timers[k][0] <= frameNo) { const fn = timers[k][1]; timers.splice(k, 1); fn(); }
    // held d-pad: again after 19 frames, then every 17
    if (rptBit && (held & rptBit) && frameNo >= rptAt) { rptAt = frameNo + 17; act(rptBit); }
    else if (rptBit && !(held & rptBit)) rptBit = 0;
    if (fade) {
      if (++fade.n >= fade.every) {
        fade.n = 0;
        bright += bright < fade.to ? 1 : bright > fade.to ? -1 : 0;
        if (bright === fade.to) { const f = fade; fade = null; if (f.done) f.done(); }
      }
    }
    if (titleConfirm >= 0 && titleConfirm < M.title_cursor.confirm.length) titleConfirm++;
    if (going >= 0) going++;
    animate();
    sprites();
    const pv = screen === 'stage' ? previewStep() : null;
    ppu.brightness = bright;
    ppu.render(out);
    if (pv) holePost(pv);
    if (screen === 'results' && results && results.figure) blitFigure(results.figure);
    return out;
  }

  enter(opts.start || 'title');
  return {
    out, W, H, frame, press,
    get screen() { return screen; },
    show(name, o = {}) { trans = null; going = -1; titleConfirm = -1; busy = 0; timers.length = 0; fade = null; bright = 15; enter(name); if (name === 'stage') stageRow = o.row || 0; },
    fadeIn(name) { trans = null; going = -1; titleConfirm = -1; timers.length = 0; bright = 0; enter(name); fadeTo(15, 2, null); },
    // after a round / the match: the player table with each one's wins, the winner marked
    // (the original's cursor) and his cheering figure; A / START / B -> r.onDone()
    showResults(r) {
      results = r;
      if (r.figure) r.figure.period = r.figure.frames.reduce((a, f) => a + f[4], 0) || 1;
      trans = null; going = -1; titleConfirm = -1; timers.length = 0; busy = 30;
      bright = 0; enter('results'); fadeTo(15, 1, null);
    },
    get busy() { return busy > 0 || !!fade || going >= 0 || titleConfirm >= 0 || !!trans; },
    _ppu: ppu,
  };
}
