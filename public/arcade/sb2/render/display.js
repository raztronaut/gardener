// Super Bomberman 2 · Tall — the display side of the original, driven by the core's WRAM.
//
// The JS core (../core/) keeps the original's WRAM layout and runs only the game logic;
// everything the original does just for the picture is reproduced here from the same
// memory, routine by routine (addresses in the comments), and fed to the PPU (ppu.js):
//   C0F60E  BG2 tilemap rows 3.. <- the tile mirror $7FA0C0 (every NMI)
//   C11D41  HUD clock digits ($5E0A..), C1195D win digits, C11356.. dead faces
//   C1348D  animated characters (stages 5/6: the core queues them at $5EEE..)
//   C00617  item-icon border colour 95 ($5C60 b4), C006B7.. bomber palettes (skull
//           flash / gold), C03EB6 / C0406E / C041A0 stage 9 / 8 palette cycles
//   C020FA + C09C7B  OAM: bombers (poses streamed from ROM C5, fixed slots +08),
//           movers (fixed VRAM tiles, free slots from $50), C10CAF effect objects at
//           $7EF000 (the "Hurry!" banner C10BCC / C10C3C, falling blocks C10761) from
//           slot $14, each animated by the C0249D script interpreter
//   $2100   master brightness ($30: fade-in / forced blank)
// Display-only state lives in this module (the core's memory is only read).
import { createPPU } from './ppu.js';

const BG2_MAP = 0x8000, BG3_MAP = 0xB800;      // byte addresses (sc_base words $4000 / $5C00)
const FACE_COL = [3, 8, 19, 24];
const FACE_BASE = [0x2060, 0x2062, 0x2464, 0x2466];
const WIN_COL = [6, 11, 22, 27];
const DIGIT = [0x288F, 0x2886, 0x2887, 0x2888, 0x2889, 0x288A, 0x288B, 0x288C, 0x288D, 0x288E]; // $C5D432

// opts.classic (the wall): every bomb drawn in the BLACK owner's colours and every flame /
// burning block / burning item in the RED owner's (classic Bomberman), instead of the
// owner's colours the original uses (the default, kept for the visual conformance).
export function createDisplay(pack, opts = {}) {
  const tall = opts.layout === 'tall';
  let classic = !!opts.classic;
  const H = tall ? 455 : 224;
  const ppu = createPPU(H);
  const out = new Uint32Array(256 * H);
  const { rom8, rom16, rom24 } = pack;
  // a skin (render/skin.js: the Garden Edition) may bring its own item-border colours and
  // the classic held / moving bomb palette; none for the original pack
  const SK = (pack.manifest && pack.manifest.skin) || {};
  const BORDER95 = SK.border95 || [0x00BF, 0x7D83];
  let st = null;               // stage pack
  let M = null;                // game.mem
  const r8 = (a) => M[a];
  const r16 = (a) => M[a] | (M[a + 1] << 8);
  const s8 = (v) => (v << 24) >> 24;

  // ---- graphics: bomber poses come from ROM bank C5 (C09EDA copies C5:tile*32) --------
  const romGfx = new Map();
  function romTile(t, size) {
    const key = t * 2 + (size === 16 ? 1 : 0);
    let g = romGfx.get(key);
    if (g !== undefined) return g;
    const px = new Uint8Array(size * size);
    for (let ty = 0; ty < size; ty += 8) for (let tx = 0; tx < size; tx += 8) {
      const base = 0xC50000 + (((t + (ty << 1) + (tx >> 3)) & 0x7FF) << 5);
      for (let r = 0; r < 8; r++) {
        const a = base + r * 2;
        const p0 = rom8(a), p1 = rom8(a + 1), p2 = rom8(a + 16), p3 = rom8(a + 17);
        for (let x = 0; x < 8; x++) {
          const s = 7 - x;
          px[(ty + r) * size + tx + x] = ((p0 >> s) & 1) | (((p1 >> s) & 1) << 1) | (((p2 >> s) & 1) << 2) | (((p3 >> s) & 1) << 3);
        }
      }
    }
    g = ppu.addGfx(px, size, size);
    romGfx.set(key, g);
    return g;
  }

  // ---- OAM (128 slots, built like the original each tick) ---------------------------------
  const S = {
    used: new Uint8Array(128),       // written this tick
    free: new Uint8Array(128),       // $7E2000 free list (1 = taken)
    x: new Int16Array(128), y: new Int16Array(128), attr: new Uint8Array(128),
    large: new Uint8Array(128), gfx: new Int32Array(128), xpal: new Uint8Array(128),
  };
  function oamClear() { S.used.fill(0); S.free.fill(0); S.xpal.fill(0); }
  function oamWrite(slot, x, y, attr, large, gfx) {
    slot &= 0x7F;
    S.used[slot] = 1; S.x[slot] = x; S.y[slot] = y; S.attr[slot] = attr; S.large[slot] = large; S.gfx[slot] = gfx;
  }

  // one object's pieces (bombers C09D03, movers C09D36, effects C14DCF). A = the memory
  // holding the object (the core's WRAM, or an effect object's 256 bytes), p = its address.
  // kind 0 = bomber (streamed ROM graphics, slots from base = +08), 1 = mover, 2 = effect
  function drawObject(A, p, kind, base) {
    let pose = A[p + 0x79] | (A[p + 0x7A] << 8) | (A[p + 0x7B] << 16);
    let n = rom8(pose); pose++;
    const ox = A[p + 0x10] | (A[p + 0x11] << 8), oy = A[p + 0x18] | (A[p + 0x19] << 8);
    const f04 = A[p + 4] | (A[p + 5] << 8), f06 = A[p + 6] | (A[p + 7] << 8), f52 = A[p + 0x52] | (A[p + 0x53] << 8);
    const f08 = A[p + 8] | (A[p + 9] << 8);
    let slot;
    if (kind === 0) slot = base;
    else if (kind === 1) slot = f08 === 0 ? 0x50 : 0;
    else slot = rom16(0xC5D862 + ((f08 << 1) & 0xFFFF));
    for (; n > 0; n--, pose += 5) {
      if (kind !== 0) { while (slot < 128 && S.free[slot]) slot++; if (slot >= 128) return; S.free[slot] = 1; }
      const x = (ox + s8(rom8(pose))) & 0xFFFF, y = (oy + s8(rom8(pose + 1))) & 0xFFFF;
      const b2 = rom8(pose + 2), b3 = rom8(pose + 3), b4 = rom8(pose + 4);
      const large = (b3 & 0x80) ? 1 : 0;
      const size = large ? 16 : 8;
      let attr, gfx, xp = 0, gfxTile = -1;
      if (kind === 0) {
        attr = b2 & 0xFE;
        const tid = ((b3 & 0x0F) << 8) | b4;
        // classic: the bomb in a bomber's lift / carry / throw poses (tiles $3C0..$3C9 =
        // the held bomb's type, +42) is a piece of the bomber in the bomber's palette
        if (classic && tid >= 0x3C0 && tid < 0x3CA) xp = 1;
        if (tid >= 0x3C0) {                       // C09DBB: fixed VRAM tiles
          const a = tid < 0x3CA ? rom16(0xC5FC17 + ((A[p + 0x42] << 1) & 0x1FF)) : tid;
          let t = rom8(0xC5FC07 + (a & 0x0F));
          if (a & 0x20) t = (t & 0x0F) | 0x40;
          gfx = ppu.vramObj(t, size);
        } else gfx = romTile(tid, size);
      } else {
        attr = b2 | (b3 & 1);
        const t = ((attr & 1) << 8) | ((kind === 2 ? b4 + A[p + 0x88] : b4) & 0xFF);
        gfx = ppu.vramObj(t, size);
        gfxTile = t;
      }
      if (!(f06 & 0x8000)) attr = (attr & 0xF1) | ((f06 << 1) & 0x0E);   // C0A056
      if (!(f04 & 0x40)) {                         // C09F9A: hidden objects write nothing
        if (kind !== 2 && (f52 & 1) && (f52 & 0x100) && !(f52 & 0x1000)) attr &= 0xCF;
        oamWrite(slot, x, y, attr, large, gfx);
        // classic: a kicked / thrown / bouncing / conveyed bomb (mover mode 1) and a held
        // bomb (above) in black's healthy palette
        if (xp || (classic && kind === 1 && (A[p + 0x7F] & 0x0F) === 1)) S.xpal[slot & 0x7F] = 1;
        // a skin's own bomb picture: a bomb mover in mode 2 (drawn in the pose's palette 0)
        // takes the bomb palette too
        else if (classic && SK.objPal8 && kind === 1 && (A[p + 0x7F] & 0x0F) === 2 && (gfxTile & 0x1F0) === 0x20 && (gfxTile & 0x0F) < 10) S.xpal[slot & 0x7F] = 1;
      }
      if (kind === 0) slot++;
    }
  }

  const g8 = (a) => M[a], g16 = (a) => M[a] | (M[a + 1] << 8);
  const sortY = new Int32Array(4), sortI = new Int32Array(4), tallRank = new Int32Array(4);

  function buildOAM() {
    oamClear();                                   // C020FA
    if (tall) {
      // tall: the original sorts the bombers' OAM bases by the LOW byte of y (C028A7);
      // with y beyond 255 that would draw a lower bomber behind a higher one, so the
      // tall screen sorts by the full y (largest y in front), same slots $30..$48.
      for (let i = 0; i < 4; i++) { sortI[i] = i; sortY[i] = g16(0x8000 + 0x100 * i + 0x18); }
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        if (sortY[j] > sortY[i]) { let t = sortY[i]; sortY[i] = sortY[j]; sortY[j] = t; t = sortI[i]; sortI[i] = sortI[j]; sortI[j] = t; }
      }
      for (let r = 0; r < 4; r++) tallRank[sortI[r]] = r;
    }
    // bombers and movers in the order of the active list $7E2620, which the core rebuilds
    // at the start of the tick (C028F6): an object created during the tick is not drawn
    // until the next one, like in the original
    for (let x = 0; x < 64; x += 2) {
      const p = g16(0x2620 + x);
      if (p === 0xFFFF || p < 0x8000 || p >= 0xA000) break;
      const k = (p - 0x8000) >> 8;
      const f = g16(p);
      if (!(f & 0x8000) || (f & 0x2000)) continue;
      if (k < 4) drawObject(M, p, 0, tall ? 0x30 + tallRank[k] * 8 : g16(p + 8));
      else drawObject(M, p, 1, 0);
    }
    // effect objects (C10CAF -> C14DBB)
    for (let k = 0; k < 16; k++) {
      const e = fx[k];
      const f = e16(e, 0);
      if (!(f & 0x8000) || (f & 0x2000)) continue;
      drawObject(e, 0, 2, 0);
    }
    // emit to the PPU in slot order (front first)
    const o = ppu.oam;
    let n = 0;
    for (let s = 0; s < 128; s++) {
      if (!S.used[s]) continue;
      const a = S.attr[s], size = S.large[s] ? 16 : 8;
      let x = S.x[s] & 0x1FF; if (x >= 256) x -= 512;
      let y = S.y[s];
      if (tall) { y = (y << 16) >> 16; if (y >= 0x1E0) y -= 0x200; }
      else { y &= 0xFF; if (y + size > 256) y -= 256; }
      o.x[n] = x; o.y[n] = y; o.w[n] = size; o.h[n] = size;
      o.pal[n] = S.xpal[s] ? 8 : (a >> 1) & 7; o.prio[n] = (a >> 4) & 3; o.hf[n] = (a >> 6) & 1; o.vf[n] = (a >> 7) & 1;
      o.gfx[n] = S.gfx[s];
      n++;
    }
    o.n = n;
  }

  // ---- effect objects ($7EF000 + $100k, 16 slots; display only) -----------------------------
  const fx = Array.from({ length: 16 }, () => new Uint8Array(256));
  const e16 = (e, a) => e[a] | (e[a + 1] << 8);
  const ew16 = (e, a, v) => { e[a] = v & 0xFF; e[a + 1] = (v >> 8) & 0xFF; };
  const ew24 = (e, a, v) => { e[a] = v & 0xFF; e[a + 1] = (v >> 8) & 0xFF; e[a + 2] = (v >> 16) & 0xFF; };
  const e24 = (e, a) => e[a] | (e[a + 1] << 8) | (e[a + 2] << 16);
  function fxCreate(k, x, y, anim) {             // C10BCC / C10761
    const e = fx[k];
    e.fill(0);
    ew16(e, 0, 0x9000); ew16(e, 4, 0x0C00); ew16(e, 0x10, x); ew16(e, 0x18, y);
    ew16(e, 0x2A, 6); ew16(e, 6, 6); ew16(e, 0x88, 0);
    ew24(e, 0x90, 0xC22C80); ew16(e, 0x6A, anim);
  }
  // C0249D on an effect object (scripts decoded from ROM; see gen_animdata.py)
  function fxStep(e) {
    let a = e24(e, 0x70);
    for (let guard = 0; guard < 64; guard++) {
      const x = rom16(a), n = x >> 12;
      if (n === 0 || n === 3) { a += 2; continue; }
      if (n === 1) { ew16(e, 0x0C, x & 0xFFF); a += 2; ew24(e, 0x70, a); return; }
      if (n === 2) { a += 2; continue; }
      if (n === 6) { ew24(e, 0x79, (rom24(a + 2) & 0xFFFF) | (a & 0xFF0000)); a += 4; continue; }
      if (n === 4) {
        const sub = (x >> 8) & 0xF;
        if (sub === 0) { a = rom24(a + 2); continue; }
        if (sub === 1) {
          const d = e[0x4F];
          if (d >= 5) { a += 5; continue; }
          ew24(e, 0x40 + 3 * (d & 0xF), (a & 0xFF0000) | ((a + 5) & 0xFFFF)); e[0x4F] = d + 1; a = rom24(a + 2); continue;
        }
        if (sub === 2) { const d = (e[0x4F] - 1) & 0xFF; e[0x4F] = d; a = e24(e, 0x40 + 3 * (d & 0xF)); continue; }
        if (sub === 3) {
          const k = e[0x59];
          if (k >= 3) { a += 2; continue; }
          ew16(e, 0x5A + 2 * (k & 0xF), x & 0xFF); a += 2; ew24(e, 0x50 + 3 * (k & 0xF), a); e[0x59] = k + 1; continue;
        }
        if (sub === 4) {
          const k = ((e[0x59] & 0xF) - 1) & 0xFFFF;
          const ca = 0x5A + ((k << 1) & 0xFF);
          let c = e16(e, ca);
          if (!(c & 0x8000)) { c = (c - 1) & 0xFFFF; ew16(e, ca, c); if (c === 0) { a += 2; e[0x59] = e[0x59] - 1; continue; } }
          a = e24(e, 0x50 + 3 * k); continue;
        }
        if (sub === 5) { a += (x & 0xFF) ? 12 : 2; continue; }
        return;
      }
      return;                                      // 5xxx / 7xxx..: stop
    }
  }
  function fxTick() {                              // C10CAF
    for (let k = 0; k < 16; k++) {
      const e = fx[k];
      if (!(e16(e, 0) & 0x8000)) continue;
      if (e16(e, 0x0C) === 0x0FFF) { ew16(e, 0, 0); continue; }
      if (!(e16(e, 0x68) & 0x8000)) {              // C14E82: start the script
        const tbl = e24(e, 0x90);                    // (+50 = 0: the first table)
        const sp = (tbl & 0xFF0000) | rom16((tbl & 0xFF0000) | ((tbl + e16(e, 0x6A)) & 0xFFFF));
        ew24(e, 0x70, sp); ew16(e, 0x0C, 0); ew16(e, 0x68, e16(e, 0x68) | 0x8000);
      }
      const t = e16(e, 0x0C);                      // C153D4
      if (t === 0) fxStep(e);
      else if (t !== 0x0FFF) { ew16(e, 0x0C, t - 1); if (t - 1 === 0) fxStep(e); }
    }
  }

  // ---- palettes ---------------------------------------------------------------------------
  function loadPal(dst, src) { for (let i = 0; i < 16; i++) ppu.cgram[dst + i] = rom16(src + 2 * i); }
  const pal = { c60: 0, ph8a: -1, ph8b: -1, ph9: -1 };
  function bomberPalette(i, flash) {               // C00676.. / C01037.. (healthy) for slot i
    const gold = g16(0x8000 + 0x100 * i + 4) & 0x100;
    const col = g16(0x5C44 + 2 * i) & 0xFF;
    let src;
    if (flash) src = gold ? 0xC1DD1C : (0xC10000 | rom16(0xC1D7DA + 2 * col));
    else if (gold) src = 0xC1DCFC;
    else src = 0xC10000 | rom16(0xC1D7B0 + 2 * col);
    loadPal(128 + 16 * i, src);
  }
  function palettesAfterTick() {
    const c60 = g16(0x5C60);
    // C00617: item border colour 95, toggled with $5C60 b4
    ppu.cgram[95] = (c60 & 0x10) ? BORDER95[1] : BORDER95[0];
    // C006B7 / C0076B / C0081D / C008CF: bomber palettes
    for (let i = 0; i < 4; i++) {
      const on = 0x0800 >> i, tg = 0x0008 >> i;
      if ((c60 & on) && !(pal.c60 & on)) bomberPalette(i, false);          // cured / healthy (once)
      else if (!(c60 & on) && ((c60 ^ pal.c60) & tg)) bomberPalette(i, !!(c60 & tg));   // flash toggle
    }
    pal.c60 = c60;
    const id = g16(0x1A);
    if (id === 9) {                                // stage 8: C0406E / C041A0
      const a = g16(0x5CBA) & 3, b = g16(0x5CC2) & 1;
      if (a !== pal.ph8a) { if (pal.ph8a >= 0) loadPal(96, 0xC1DBFE + a * 32); pal.ph8a = a; }
      if (b !== pal.ph8b) { if (pal.ph8b >= 0) loadPal(112, 0xC1DC7E + b * 32); pal.ph8b = b; }
    } else if (id === 0xA) {                       // stage 9: C03EB6
      const a = g16(0x5CC2) & 3;
      if (a !== pal.ph9) { if (pal.ph9 >= 0) loadPal(96, 0xC1DB7E + a * 32); pal.ph9 = a; }
    }
  }

  // ---- background maps ------------------------------------------------------------------------
  const v = ppu.vram;
  const vw16 = (a, val) => { v[a & 0xFFFF] = val & 0xFF; v[(a + 1) & 0xFFFF] = (val >> 8) & 0xFF; };
  const burnMark = new Uint8Array(0x1000);
  function bg2FromMirror() {                       // C0F60E: $7FA0C0.. -> VRAM $4060..
    const last = tall ? 29 : 15;
    if (!classic) {
      for (let row = 3; row <= last; row++) {
        const src = 0x1A000 + row * 0x40, dst = BG2_MAP + row * 64;
        for (let k = 0; k < 64; k++) v[dst + k] = M[src + k];
      }
      return;
    }
    // classic colours: the owner palettes are BG rows 1..4 (white, black, red, blue);
    // bomb cells ($43) -> row 2 (black), fire ($01 / $41) and burning blocks -> row 3 (red)
    burnMark.fill(0);
    for (let e = 0; e < 32; e++) {
      const a = 0x10000 + 16 * e;
      if (!(g16(a) & 0x8000)) burnMark[g16(a + 2) & 0xFFF] = 1;
    }
    for (let row = 3; row <= last; row++) {
      const src = 0x1A000 + row * 0x40, dst = BG2_MAP + row * 64;
      for (let k = 0; k < 64; k += 2) {
        let lo = M[src + k], hi = M[src + k + 1];
        const pl = (hi >> 2) & 7;
        if (pl >= 1 && pl <= 4) {
          const gi = row * 0x80 + k, c = M[0x1C000 + gi];      // cell (k / 2, row)
          const want = c === 0x43 ? 2 : (c === 0x01 || c === 0x41 || burnMark[gi]) ? 3 : 0;
          if (want) hi = (hi & 0xE3) | (want << 2);
        }
        v[dst + k] = lo; v[dst + k + 1] = hi;
      }
    }
  }
  const hud = { bombers: new Int32Array(4) };
  function hudUpdate(newFrame) {
    // C11D41: clock (unless stopped; infinite time keeps the start digits)
    if (!(g16(0x5E20) & 0x8000) && g16(0x5C54) !== 4) {
      const row = BG3_MAP + 32 * 2;
      vw16(row + 14 * 2, 0x2800 | (g16(0x5E0A) & 0xFF));
      vw16(row + 15 * 2, 0x2882);
      vw16(row + 16 * 2, 0x2800 | (g16(0x5E0C) & 0xFF));
      vw16(row + 17 * 2, 0x2800 | (g16(0x5E0E) & 0xFF));
    }
    if (newFrame) return;                          // C11356 runs only when no bomber DMA ($BB)
    for (let i = 0; i < 4; i++) {                  // C1195D: win digits
      vw16(BG3_MAP + (32 + WIN_COL[i]) * 2, 0x2800 | (DIGIT[g16(0x5E66 + 2 * i) & 0x0F] & 0xFF));
    }
    for (let i = 0; i < 4; i++) {                  // C113EE..: dead faces
      const p = 0x8000 + 0x100 * i;
      if ((g16(p) & 0x2800) !== 0x2800) continue;
      const c = FACE_COL[i], b = FACE_BASE[i];
      vw16(BG3_MAP + c * 2, 0x28D0); vw16(BG3_MAP + (c + 1) * 2, 0x28D1);
      vw16(BG3_MAP + (32 + c) * 2, b); vw16(BG3_MAP + (33 + c) * 2, b + 1);
      vw16(BG3_MAP + (64 + c) * 2, b + 0x10); vw16(BG3_MAP + (65 + c) * 2, b + 0x11);
    }
  }

  // tall stage 5: BG1 holds the 8 white plates around the original centre (cy 5..12).
  // The tall layout copies the original's rows 0..8 at the top and rows 9..14 at
  // cy 23..28 (tall.js rowOf), so the plates follow the same split: the upper four stay,
  // the lower four move down 14 rows, and the stretched middle has none.
  function tallPlates() {
    const base = 0xB000;                         // BG1 map (sc_base word $5800), 32x32
    const orig = v.slice(base, base + 0x800);
    const empty = orig[2 * 0] | (orig[1] << 8);   // map cell (0,0): no plate
    for (let r = 0; r < 32; r++) {
      const sr = r <= 8 ? r : (r >= 23 && r <= 28 ? r - 14 : -1);
      for (let c = 0; c < 32; c++) {
        const val = sr < 0 ? empty : orig[(sr * 32 + c) * 2] | (orig[(sr * 32 + c) * 2 + 1] << 8);
        vw16(base + (r * 32 + c) * 2, val);
      }
    }
  }

  // ---- skin cell art (ppu.setArt; render/skin.js, NOTES-garden.md) ----------------------------
  // The skin's arena: per map cell a static ground (picture stacks, shaded where a wall
  // casts its shadow), picture layers for the cells that come and go (variants by a stable
  // per-cell hash), and the original's own characters (fire, burning blocks, items) drawn
  // over the ground where they are not the original's floor (masks measured on the
  // ORIGINAL pack at run time: nothing of the original is in the skin).
  const artCache = new Map();
  function artHash(x, y, salt) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function artPick(L, tx, ty) {
    const d = L.n > 1 ? artHash((tx / L.w) | 0, (ty / L.h) | 0, L.salt) % L.n : 0;
    return L.pics[d * L.w * L.h + (tx % L.w) + (ty % L.h) * L.w];
  }
  function stageArt(n) {
    const A = SK.art, S = A && A.stages[n];
    if (!S) return null;
    if (artCache.has(n)) return artCache.get(n);
    const bin = SK.artBin;
    const pic = (id) => bin.subarray(A.pics[0] + id * 256, A.pics[0] + id * 256 + 256);
    const shade = bin.subarray(S.shade, S.shade + 256);
    const shadePic = new Set(S.shadePics);
    // the static ground of this layout
    const under = new Uint8Array(512 * 512);
    let o = S.stat[tall ? 'tall' : 'original'];
    for (let cell = 0; cell < 1024; cell++) {
      const cnt = bin[o++], ub = (cell >> 5) * 16 * 512 + (cell & 31) * 16;
      for (let k = 0; k < cnt; k++, o += 2) {
        const id = bin[o] | (bin[o + 1] << 8), p = pic(id), sh = shadePic.has(id);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = p[y * 16 + x];
          if (!v) continue;
          const i = ub + y * 512 + x;
          under[i] = sh ? shade[under[i]] : v;
        }
      }
    }
    const mode = new Uint8Array(4096), row = new Uint8Array(4096), layers = [], mask = [];
    for (const [key, m, rw, ls] of S.cls) {
      mode[key] = m; row[key] = rw;
      if (ls) layers[key] = ls.map(([w, h, salt, ids]) => ({ w, h, salt, n: ids.length / (w * h), pics: ids.map(pic) }));
    }
    // the original's fire / burning blocks / items: which of their pixels are its floor
    const O = SK.origStage ? SK.origStage(n) : null;
    if (O) {
      const chr = (O.ppu.bg2_char_base * 2) & 0xFFFF;
      const cellCols = (e) => {
        const out = new Int32Array(256), t = e & 0x3FF, pl = (e >> 10) & 7, hf = (e >> 14) & 1, vf = (e >> 15) & 1;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const sx = hf ? 15 - x : x, sy = vf ? 15 - y : y;
          const ch = t + (sy >= 8 ? 16 : 0) + (sx >= 8 ? 1 : 0), a = (chr + ch * 32 + (sy & 7) * 2) & 0xFFFF, s = 7 - (sx & 7);
          const v = ((O.vram[a] >> s) & 1) | (((O.vram[a + 1] >> s) & 1) << 1) | (((O.vram[a + 16] >> s) & 1) << 2) | (((O.vram[a + 17] >> s) & 1) << 3);
          out[y * 16 + x] = v ? (O.cgram[2 * (pl * 16 + v)] | (O.cgram[2 * (pl * 16 + v) + 1] << 8)) : -1;
        }
        return out;
      };
      const refs = (S.maskRefs || []).map(cellCols);
      const stack = new Int32Array(256);
      for (const [key, e] of S.masks || []) {
        const c = cellCols(e);
        let best = null, bn = -1;
        for (const r of refs) { let k = 0; for (let i = 0; i < 256; i++) if (c[i] === r[i]) k++; if (k > bn) { bn = k; best = r; } }
        const m = new Uint8Array(256);
        if (best) {
          // the floor = matching pixels connected to the cell's edge
          let sp = 0;
          for (let i = 0; i < 256; i++) {
            const x = i & 15, y = i >> 4;
            if ((x === 0 || y === 0 || x === 15 || y === 15) && c[i] === best[i]) { m[i] = 1; stack[sp++] = i; }
          }
          while (sp) {
            const i = stack[--sp], x = i & 15, y = i >> 4;
            const nb = [x > 0 ? i - 1 : -1, x < 15 ? i + 1 : -1, y > 0 ? i - 16 : -1, y < 15 ? i + 16 : -1];
            for (const j of nb) if (j >= 0 && !m[j] && c[j] === best[j]) { m[j] = 1; stack[sp++] = j; }
          }
        }
        mask[key] = m;
      }
    }
    const a = { under, mode, row, layers, mask, pick: artPick };
    artCache.set(n, a);
    return a;
  }

  // ---- rounds and ticks ----------------------------------------------------------------------
  const animPrev = new Int32Array(4).fill(-1);
  const pendingPuffs = [];
  const pendingHas = (k) => { for (let q = 0; q < pendingPuffs.length; q += 3) if (pendingPuffs[q] === k) return true; return false; };
  let lastTick = -1, lastSD = 0;
  const stats = { fx: 0, newFrame: 0 };          // per tick, read by the pacing model
  function beginRound(game) {
    M = game.mem;
    const id = g16(0x1A);
    const stage = { 0: 1, 1: 2, 2: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 0xA: 9, 0xB: 10 }[id] || opts.stage || 1;
    st = pack.stage(stage);
    ppu.vram.set(st.vram);
    for (let k = 0; k < 256; k++) ppu.cgram[k] = st.cgram[2 * k] | (st.cgram[2 * k + 1] << 8);
    ppu.configure(st.ppu);
    // tall: BG3 (the HUD) is a 256-line map; it would wrap and repeat below line 256
    if (tall) ppu.L[3].maxY = 256;
    if (tall && id === 6) tallPlates();
    ppu.setArt(SK.art ? stageArt(stage) : null);
    ppu.setObjBase((st.ppu.obj_name_base * 2) & 0xFFFF, (st.ppu.obj_name_base2 * 2) & 0xFFFF);
    ppu.forceAll();
    for (const e of fx) e.fill(0);
    pal.c60 = g16(0x5C60) ^ 0x0F00;                // re-derive every bomber palette once
    for (let i = 0; i < 4; i++) bomberPalette(i, false);
    if (SK.objPal8) for (let i = 0; i < 16; i++) ppu.cgram[256 + i] = SK.objPal8[i];
    else loadPal(256, 0xC10000 | rom16(0xC1D7B0 + 2 * 1));   // classic: black's healthy OBJ palette (8)
    pal.c60 = g16(0x5C60);
    pal.ph8a = pal.ph8b = pal.ph9 = -1;
    if (id === 9) { pal.ph8a = g16(0x5CBA) & 3; pal.ph8b = g16(0x5CC2) & 1; }
    if (id === 0xA) pal.ph9 = g16(0x5CC2) & 3;
    animPrev.fill(-1);
    lastTick = g16(0x32);
    lastSD = g16(0x5D14);
    frame(game, null);
  }

  // After every game.tick(): everything the original's NMI and display routines did.
  function frame(game, events) {
    M = game.mem;
    const tick = g16(0x32);
    if (st === null || tick < lastTick) { lastTick = tick; beginRound(game); return; }
    lastTick = tick;
    // animated characters (C1340A queued by the core, uploaded by C1348D)
    if (M[0x5EEE] === 1) {
      for (let k = 0; k < 2; k++) {                // two 64-byte DMAs: chars n, n+1 and n+16, n+17
        const dst = (g16(k ? 0x5EF4 : 0x5EEF) * 2) & 0xFFFF, src = g16(k ? 0x5EF6 : 0x5EF1) - st.wramBase;
        if (src >= 0 && src + 0x40 <= st.wram.length) ppu.writeVram(dst, st.wram.subarray(src, src + 0x40));
      }
    }
    palettesAfterTick();
    // effects: "Hurry!" (C10C3C moves it 2 px/tick to the left; C10BCC creates it)
    const ban = fx[0];
    if (e16(ban, 0) & 0x8000) {
      const x = (e16(ban, 0x10) - 2) & 0xFFFF;
      ew16(ban, 0x10, x);
      if ((x & 0x1F0) === 0x1A0) ewipe(ban);
    }
    // (tall: the banner crosses the middle of the taller arena, 116 lines lower)
    if (events) for (const ev of events) if (ev.type === 'hurry') fxCreate(0, 0x140, tall ? 0x70 + 0x74 : 0x70, 0);
    // falling block (C10761 at every sudden-death step: slot 1, the cell centre)
    const sd = g16(0x5D14);
    if (sd !== lastSD && sd !== 0) {
      const gi = g16(0x5D16);
      const x = (((gi & 0x7F) << 3) - g16(0x5F01) + 8) & 0x1FF;
      const y = (((gi & 0xF80) >> 3) - g16(0x5EFB) + 7) & 0x1FF;
      fxCreate(1, x, y, 2);
    }
    lastSD = sd;
    fxTick();
    // for the pacing model (../pacing.js): effect objects C10CAF ran this tick
    let nfx = 0;
    for (let k = 0; k < 16; k++) if (e16(fx[k], 0) & 0x8000) nfx++;
    stats.fx = nfx;
    // item-scatter puffs (C09689 -> C096B9): created after C10CAF, so first drawn next tick
    if (events) for (const ev of events) {
      if (ev.type !== 'itemScattered') continue;
      let k = 2;
      while (k < 16 && ((e16(fx[k], 0) & 0x8000) || pendingHas(k))) k++;
      if (k >= 16) continue;
      const gi = ev.cy * 0x80 + ev.cx * 2;
      pendingPuffs.push(k, (((gi & 0x7F) << 3) - g16(0x5F01) + 8) & 0x1FF, (((gi & 0xF80) >> 3) - g16(0x5EFB) + 7) & 0x1FF);
    }
    // did any bomber step its animation this tick (C09E7D sets $BB -> C11356 skipped)?
    let newFrame = false;
    for (let i = 0; i < 4; i++) {
      const p = 0x8000 + 0x100 * i;
      const t = g16(p + 0x0C);
      const prev = animPrev[i];
      if ((g16(p) & 0xA000) === 0x8000 && prev >= 0 && !(prev === 0x0FFF && t === 0x0FFF) && !(prev > 0 && prev !== 0x0FFF && t === prev - 1)) newFrame = true;
      animPrev[i] = t;
    }
    stats.newFrame = newFrame ? 1 : 0;
    bg2FromMirror();
    hudUpdate(newFrame);
    buildOAM();
    for (let q = 0; q < pendingPuffs.length; q += 3) fxCreate(pendingPuffs[q], pendingPuffs[q + 1], pendingPuffs[q + 2], 4);
    pendingPuffs.length = 0;
    const b30 = M[0x30];
    ppu.brightness = b30 & 0x80 ? 0 : b30 & 0x0F;
    blank = !!(b30 & 0x80);
  }
  function ewipe(e) { e.fill(0); }
  let blank = false;

  function render() {
    ppu.render(out);
    if (blank) out.fill(0xFF000000);
    return out;
  }

  // switch the classic colours (the next frame() redraws the arena)
  function setClassic(on) { classic = !!on; }
  return { ppu, H, W: 256, out, tall, beginRound, frame, render, stats, setClassic };
}
