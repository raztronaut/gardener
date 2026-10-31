// Super Bomberman 2 · Tall — a small SNES PPU for the battle screen (mode 1).
//
// No DOM: runs in the browser and in Node (tools/sb2/conformance/visual.py). The display
// logic (display.js) writes tilemaps / characters into `vram`, colours into `cgram`, and
// fills the OAM list; render() composes one 256 x H frame into a Uint32Array (RGBA bytes
// in memory order, i.e. ImageData layout) with the hardware rules this screen uses:
//   - BG1/BG2 4bpp 16x16 tiles, BG3 2bpp 8x8 tiles with the BG3 priority bit ($2105 b3);
//   - main-screen order BG3hi > OBJ3 > BG1hi > BG2hi > OBJ2 > BG1lo > BG2lo > OBJ1 >
//     OBJ0 > BG3lo > backdrop; among sprites the lowest OAM index wins (then its
//     priority is compared with the backgrounds);
//   - window 1 (inverted) masks BG1/BG2/OBJ on main and sub per line (HDMA table
//     $C5FD61 -> $7E3730: lines 0..23 fully masked, else only x 0 and 255);
//   - colour math: half-add on BG2 pixels whose sub-screen pixel (BG3 / OBJ) is opaque
//     ($2130 = $02, $2131 = $42); a transparent sub screen adds the fixed colour (0)
//     without halving;
//   - master brightness ($2100) applied after the math.
// The BG layers are cached per tile (re-rendered only when their tilemap word or one of
// their characters changes) and composed per 8x8 block; sprites are drawn per frame.
// Nothing is allocated per frame.

const W = 256;
// main-screen ranks (higher = in front)
const R_BACK = 0, R_BG3LO = 2, R_BG2LO = 6, R_BG1LO = 7, R_BG2HI = 9, R_BG1HI = 10, R_BG3HI = 12;
const OBJ_RANK = [3, 5, 8, 11];

export function expand5(c) { return (c << 3) | (c >> 2); }

export function createPPU(H) {
  const N = W * H;
  const vram = new Uint8Array(0x10000);
  // 256 CGRAM words + one extra OBJ palette (8, words 256..271) the wall's classic bomb
  // colours use (display.js classic); the original has no such palette
  const cgram = new Uint16Array(272);
  const lut = new Uint32Array(272);
  let brightness = 15, lutKey = -1;
  const cgShadow = new Uint16Array(272);
  const bmul = new Uint8Array(32);          // 5-bit channel -> 8-bit after brightness

  // ---- background layers ---------------------------------------------------------------
  // per layer: config + screen-space index buffer (CGRAM index, 0 = transparent) + priority
  function mkLayer(id) {
    return { id, on: false, sc: 0, size: 0, chr: 0, bpp: 4, t16: false, hofs: 0, vofs: 0,
      idx: new Uint8Array(N), pri: new Uint8Array(N), shadow: null, cols: 0, rows: 0, force: true, maxY: H };
  }
  const L = [null, mkLayer(1), mkLayer(2), mkLayer(3)];
  const BW = W >> 3, BH = (H + 7) >> 3;
  const blockDirty = new Uint8Array(BW * BH);
  let allDirty = true;
  // characters rewritten since the last frame (4bpp char number = byte address >> 5)
  const charDirty = new Uint8Array(0x10000 >> 4);   // per 16-byte unit (covers 2bpp too)
  let anyCharDirty = false;

  function configure(ppu) {
    const tile16 = (n) => !!(ppu.bgmode_raw & (0x08 << n));
    for (let n = 1; n <= 3; n++) {
      const l = L[n];
      l.on = !!(ppu.tm & (1 << (n - 1)));
      l.sub = !!(ppu.ts & (1 << (n - 1)));
      l.sc = ppu[`bg${n}_sc_base`] * 2;            // byte address
      l.size = ppu[`bg${n}_sc_size`];
      l.chr = ppu[`bg${n}_char_base`] * 2;
      l.bpp = n === 3 ? 2 : 4;
      l.t16 = tile16(n);
      l.hofs = ppu[`bg${n}_hofs`] & 0x3FF;
      l.vofs = ppu[`bg${n}_vofs`] & 0x3FF;
      const ts = l.t16 ? 16 : 8;
      l.cols = (W >> (l.t16 ? 4 : 3)) + 2;
      l.rows = Math.ceil(H / ts) + 2;
      l.shadow = new Int32Array(l.cols * l.rows).fill(-1);
      l.force = true;
    }
    state.bg3prio = !!ppu.bg3_priority;
    state.objOn = !!(ppu.tm & 0x10);
    state.objSub = !!(ppu.ts & 0x10);
    state.mathBG2 = !!(ppu.cgadsub & 0x02);
    state.mathBG1 = !!(ppu.cgadsub & 0x01);
    state.mathSubtract = !!(ppu.cgadsub & 0x80);
    state.mathHalf = !!(ppu.cgadsub & 0x40);
    allDirty = true;
  }

  // window 1 per line: masked x range = outside [left, right] (inverted window)
  const winL = new Int16Array(H), winR = new Int16Array(H);
  function setWindowLines(fn) { for (let y = 0; y < H; y++) { const [l, r] = fn(y); winL[y] = l; winR[y] = r; } allDirty = true; }
  setWindowLines((y) => (y < 24 ? [255, 0] : [1, 254]));

  const state = { bg3prio: true, objOn: true, objSub: true, mathBG2: true, mathHalf: true, snes9x565: false,
    mathBG1: false, mathSubtract: false };

  function mapEntry(l, tx, ty) {
    // tx, ty in tiles (wrapped by the screen size), returns the tilemap word
    const shift = l.t16 ? 4 : 3;
    const mw = (l.size & 1) ? 64 : 32, mh = (l.size & 2) ? 64 : 32;
    tx &= mw - 1; ty &= mh - 1;
    let a = l.sc + ((ty & 31) * 32 + (tx & 31)) * 2;
    if (tx & 32) a += 0x800;
    if (ty & 32) a += (l.size & 1) ? 0x1000 : 0x800;
    return vram[a & 0xFFFF] | (vram[(a + 1) & 0xFFFF] << 8);
  }

  // decode one 8x8 char row into dst (8 colour indices) — bpp 2 or 4
  function charRow(base, bpp, row, dst, o) {
    const a = base + row * 2;
    const p0 = vram[a & 0xFFFF], p1 = vram[(a + 1) & 0xFFFF];
    let p2 = 0, p3 = 0;
    if (bpp === 4) { p2 = vram[(a + 16) & 0xFFFF]; p3 = vram[(a + 17) & 0xFFFF]; }
    for (let x = 0; x < 8; x++) {
      const s = 7 - x;
      dst[o + x] = ((p0 >> s) & 1) | (((p1 >> s) & 1) << 1) | (((p2 >> s) & 1) << 2) | (((p3 >> s) & 1) << 3);
    }
  }
  const rowBuf = new Uint8Array(8);

  function tileUsesDirtyChar(l, e) {
    const csz = l.bpp * 8;
    const t = e & 0x3FF;
    const list = l.t16 ? [t, t + 1, t + 16, t + 17] : [t];
    for (const c of list) {
      const a = (l.chr + (c & 0x3FF) * csz) & 0xFFFF;
      for (let u = 0; u < csz; u += 16) if (charDirty[(a + u) >> 4]) return true;
    }
    return false;
  }

  function renderLayer(l) {
    if (!l.on && !l.sub) return;
    const ts = l.t16 ? 16 : 8, shift = l.t16 ? 4 : 3;
    // screen y = bg y - vofs - 1 (measured in the harness; OAM y has no offset)
    const by0 = (l.vofs + 1) & 0x3FF, bx0 = l.hofs;
    const tx0 = bx0 >> shift, ty0 = by0 >> shift;
    const csz = l.bpp * 8;
    const palMul = l.bpp === 4 ? 16 : 4;
    for (let r = 0; r < l.rows; r++) {
      for (let c = 0; c < l.cols; c++) {
        const e = mapEntry(l, tx0 + c, ty0 + r);
        const k = r * l.cols + c;
        if (!l.force && l.shadow[k] === e && !(anyCharDirty && tileUsesDirtyChar(l, e))) continue;
        l.shadow[k] = e;
        // tile top-left on screen
        const sx0 = ((tx0 + c) << shift) - bx0, sy0 = ((ty0 + r) << shift) - by0;
        const t = e & 0x3FF, pal = (e >> 10) & 7, pr = (e >> 13) & 1, hf = (e >> 14) & 1, vf = (e >> 15) & 1;
        if (art !== null && l.id === 2) {
          const key = t | ((e >> 4) & 0xC00), mode = art.mode[key];
          if (mode !== 0) { artTile(l, e, key, mode, tx0 + c, ty0 + r, sx0, sy0, pr); continue; }
        }
        const pbase = pal * palMul;
        for (let y = 0; y < ts; y++) {
          const sy = sy0 + y;
          if (sy < 0 || sy >= l.maxY) continue;
          const ty = vf ? ts - 1 - y : y;
          for (let half = 0; half < (l.t16 ? 2 : 1); half++) {
            // which 8x8 char: t + (ty>=8 ? 16 : 0) + (tx>=8 ? 1 : 0) with hflip
            const cx = hf ? (l.t16 ? 1 - half : 0) : half;
            const ch = (t + (ty >= 8 ? 16 : 0) + cx) & 0x3FF;
            charRow((l.chr + ch * csz) & 0xFFFF, l.bpp, ty & 7, rowBuf, 0);
            for (let x = 0; x < 8; x++) {
              const sx = sx0 + half * 8 + x;
              if (sx < 0 || sx >= W) continue;
              const v = rowBuf[hf ? 7 - x : x];
              const i = sy * W + sx;
              l.idx[i] = v ? pbase + v : 0;
              l.pri[i] = pr;
            }
          }
        }
        markBlocks(sx0, sy0, ts);
      }
    }
    l.force = false;
  }
  // mark the 8x8 screen blocks a tile covers
  function markBlocks(sx0, sy0, ts) {
    for (let by = Math.max(0, sy0 >> 3); by <= Math.min(BH - 1, (sy0 + ts - 1) >> 3); by++) {
      for (let bx = Math.max(0, sx0 >> 3); bx <= Math.min(BW - 1, (sx0 + ts - 1) >> 3); bx++) blockDirty[by * BW + bx] = 1;
    }
  }

  // ---- skin cell art (BG2 only; null for the original pictures) ----------------------------
  // A skin may paint the arena per map cell instead of per character (display.js builds it
  // from the overlay, render/skin.js): art.under = the cell's static ground (CGRAM indices,
  // 512 x 512 = the 32 x 32 map), art.mode[key] (key = tile | flips << 10):
  //   1 = the ground only, 2 = picture layers over the ground (a variant per cell by a
  //   stable hash), 3 = the characters over the ground (art.row[key] = their palette row,
  //   255 = the entry's own; art.maskOf(key) = pixels that show the ground instead).
  let art = null;
  const cellBuf = new Uint8Array(256);
  function setArt(a) { art = a; L[2].force = true; allDirty = true; }
  function artTile(l, e, key, mode, tx, ty, sx0, sy0, pr) {
    const mtx = tx & 31, mty = ty & 31;
    const U = art.under, ub = mty * 16 * 512 + mtx * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) cellBuf[y * 16 + x] = U[ub + y * 512 + x];
    if (mode === 2) {
      const layers = art.layers[key];
      for (let k = 0; k < layers.length; k++) {
        const pic = art.pick(layers[k], mtx, mty);
        for (let i = 0; i < 256; i++) if (pic[i]) cellBuf[i] = pic[i];
      }
    } else if (mode === 3) {
      const m = art.maskOf(key), rw = art.row[key];
      const pbase = (rw === 255 ? (e >> 10) & 7 : rw) * 16;
      const t = e & 0x3FF, hf = (e >> 14) & 1, vf = (e >> 15) & 1;
      for (let y = 0; y < 16; y++) {
        const ty2 = vf ? 15 - y : y;
        for (let half = 0; half < 2; half++) {
          const cx = hf ? 1 - half : half;
          const ch = (t + (ty2 >= 8 ? 16 : 0) + cx) & 0x3FF;
          charRow((l.chr + ch * 32) & 0xFFFF, 4, ty2 & 7, rowBuf, 0);
          for (let x = 0; x < 8; x++) {
            const v = rowBuf[hf ? 7 - x : x], i = y * 16 + half * 8 + x;
            if (v && !(m && m[i])) cellBuf[i] = pbase + v;
          }
        }
      }
    }
    for (let y = 0; y < 16; y++) {
      const sy = sy0 + y;
      if (sy < 0 || sy >= l.maxY) continue;
      for (let x = 0; x < 16; x++) {
        const sx = sx0 + x;
        if (sx < 0 || sx >= W) continue;
        const i = sy * W + sx;
        l.idx[i] = cellBuf[y * 16 + x];
        l.pri[i] = pr;
      }
    }
    markBlocks(sx0, sy0, 16);
  }

  // ---- composed background (BG layers + backdrop, colour math with BG3) ------------------
  const baseIdx = new Uint8Array(N);
  const baseRank = new Uint8Array(N);
  const baseSub = new Uint8Array(N);   // sub-screen colour index for a BG2 half-add (0 = none)
  const baseSubOn = new Uint8Array(N); // 1 = a sub pixel exists (math applies)

  function composeBlock(bx, by) {
    const l1 = L[1], l2 = L[2], l3 = L[3];
    const y1 = Math.min(H, by * 8 + 8);
    for (let y = by * 8; y < y1; y++) {
      const wl = winL[y], wr = winR[y];
      for (let x = bx * 8, x1 = bx * 8 + 8; x < x1; x++) {
        const i = y * W + x;
        const masked = x < wl || x > wr;
        let rank = R_BACK, idx = 0;
        const c3 = l3.on ? l3.idx[i] : 0;
        const c1 = (l1.on && !masked) ? l1.idx[i] : 0;
        const c2 = (l2.on && !masked) ? l2.idx[i] : 0;
        if (c3 && l3.pri[i] && state.bg3prio) { rank = R_BG3HI; idx = c3; }
        else if (c1 && l1.pri[i]) { rank = R_BG1HI; idx = c1; }
        else if (c2 && l2.pri[i]) { rank = R_BG2HI; idx = c2; }
        else if (c1) { rank = R_BG1LO; idx = c1; }
        else if (c2) { rank = R_BG2LO; idx = c2; }
        else if (c3) { rank = R_BG3LO; idx = c3; }
        baseIdx[i] = idx; baseRank[i] = rank;
        // colour math: main = BG2 and the sub screen has BG3 (OBJ handled per frame)
        const s3 = l3.sub ? l3.idx[i] : 0;
        if ((rank === R_BG2LO || rank === R_BG2HI) && state.mathBG2 && s3) { baseSub[i] = s3; baseSubOn[i] = 1; }
        else { baseSub[i] = 0; baseSubOn[i] = 0; }
      }
    }
  }

  // ---- palette ---------------------------------------------------------------------------
  function rebuildLut() {
    // master brightness: c * b / 15 rounded (measured on the harness fade-in, every level)
    for (let c = 0; c < 32; c++) bmul[c] = expand5(brightness >= 15 ? c : Math.round((c * brightness) / 15));
    for (let k = 0; k < 272; k++) {
      const v = cgram[k];
      lut[k] = (0xFF << 24) | (bmul[(v >> 10) & 31] << 16) | (bmul[(v >> 5) & 31] << 8) | bmul[v & 31];
      cgShadow[k] = v;
    }
    lutKey = brightness;
  }
  function subtract(a, b) {          // 15-bit colours -> RGBA, a - b per channel (clamped), then brightness
    const r = Math.max(0, (a & 31) - (b & 31)), g = Math.max(0, ((a >> 5) & 31) - ((b >> 5) & 31));
    const bl = Math.max(0, ((a >> 10) & 31) - ((b >> 10) & 31));
    return (0xFF << 24) | (bmul[bl] << 16) | (bmul[g] << 8) | bmul[r];
  }
  function blend(a, b) {             // 15-bit colours -> RGBA, half-add, then brightness
    const r = (((a & 31) + (b & 31)) >> 1), bl = ((((a >> 10) & 31) + ((b >> 10) & 31)) >> 1);
    let g;
    if (state.snes9x565) {
      // snes9x adds in RGB565 with green's low bit = its top bit (pixform.h), so the
      // halved green rounds up when both inputs are >= 16: an emulator artefact the
      // conformance run reproduces on request (the hardware halves 5-bit values).
      const ga = (a >> 5) & 31, gb = (b >> 5) & 31;
      const a6 = (ga << 1) | (ga >> 4), b6 = (gb << 1) | (gb >> 4);
      g = ((((a6 & ~1) + (b6 & ~1)) >> 1) + (a6 & b6 & 1)) >> 1;
    } else g = ((((a >> 5) & 31) + ((b >> 5) & 31)) >> 1);
    return (0xFF << 24) | (bmul[bl] << 16) | (bmul[g] << 8) | bmul[r];
  }

  // ---- sprites ---------------------------------------------------------------------------
  // OAM list (front first). gfx = id into the graphics registry (unflipped colour indices).
  const MAXO = 256;
  const oam = {
    n: 0,
    x: new Int16Array(MAXO), y: new Int16Array(MAXO), w: new Uint8Array(MAXO), h: new Uint8Array(MAXO),
    pal: new Uint8Array(MAXO), prio: new Uint8Array(MAXO), hf: new Uint8Array(MAXO), vf: new Uint8Array(MAXO),
    gfx: new Int32Array(MAXO),
  };
  const gfxList = [];
  function addGfx(pixels, w, h) { gfxList.push({ p: pixels, w, h }); return gfxList.length - 1; }
  // OBJ characters from VRAM (fixed tiles): tile number 0..511, size 8 or 16
  const objCache = new Map();
  let objBase = 0xC000, objBase2 = 0xE000;
  function vramObj(tile, size) {
    const key = tile * 2 + (size === 16 ? 1 : 0);
    let g = objCache.get(key);
    if (g !== undefined) return g;
    const px = new Uint8Array(size * size);
    for (let ty = 0; ty < size; ty += 8) for (let tx = 0; tx < size; tx += 8) {
      // 16x16: tiles n, n+1, n+16, n+17 (column wraps inside the 16-tile row)
      const n = (tile & 0x100) | ((tile + (ty << 1)) & 0xF0) | ((tile + (tx >> 3)) & 0x0F);
      const base = (n & 0x100 ? objBase2 + (n & 0xFF) * 32 : objBase + n * 32) & 0xFFFF;
      for (let r = 0; r < 8; r++) charRow(base, 4, r, px, (ty + r) * size + tx);
    }
    g = addGfx(px, size, size);
    objCache.set(key, g);
    return g;
  }
  function clearObjCache() { objCache.clear(); }

  const stamp = new Uint32Array(N);
  let frameNo = 0;

  function drawSprites(out) {
    frameNo = (frameNo + 1) >>> 0;
    if (frameNo === 0) { stamp.fill(0); frameNo = 1; }
    if (!state.objOn) return;
    for (let k = 0; k < oam.n; k++) {
      const g = gfxList[oam.gfx[k]];
      const sw = oam.w[k], sh = oam.h[k];
      const x0 = oam.x[k], y0 = oam.y[k];
      if (x0 >= W || x0 + sw <= 0 || y0 >= H || y0 + sh <= 0) continue;
      const hf = oam.hf[k], vf = oam.vf[k];
      const pbase = 128 + oam.pal[k] * 16;
      const rank = OBJ_RANK[oam.prio[k]];
      for (let y = 0; y < sh; y++) {
        const sy = y0 + y;
        if (sy < 0 || sy >= H) continue;
        const wl = winL[sy], wr = winR[sy];
        const gy = vf ? sh - 1 - y : y;
        const grow = gy * g.w;
        for (let x = 0; x < sw; x++) {
          const sx = x0 + x;
          if (sx < wl || sx > wr || sx < 0 || sx >= W) continue;
          const v = g.p[grow + (hf ? sw - 1 - x : x)];
          if (!v) continue;
          const i = sy * W + sx;
          if (stamp[i] === frameNo) continue;
          stamp[i] = frameNo;
          const br = baseRank[i];
          if (rank > br) out[i] = lut[pbase + v];
          else if ((br === R_BG2LO || br === R_BG2HI) && state.mathBG2 && state.objSub) {
            out[i] = state.mathHalf ? blend(cgram[baseIdx[i]], cgram[pbase + v]) : lut[baseIdx[i]];
          } else if ((br === R_BG1LO || br === R_BG1HI) && state.mathBG1 && state.objSub && state.mathSubtract) {
            // the menus' shadows (CGADSUB $81): a sprite hidden under BG1 on the main screen
            // is the sub-screen pixel, subtracted from BG1
            out[i] = subtract(cgram[baseIdx[i]], cgram[pbase + v]);
          }
        }
      }
    }
  }

  // ---- frame -----------------------------------------------------------------------------
  function render(out) {
    let palChanged = brightness !== lutKey;
    if (!palChanged) for (let k = 0; k < 272; k++) if (cgram[k] !== cgShadow[k]) { palChanged = true; break; }
    if (palChanged) rebuildLut();
    for (let n = 1; n <= 3; n++) renderLayer(L[n]);
    if (anyCharDirty) { charDirty.fill(0); anyCharDirty = false; }
    if (allDirty) { blockDirty.fill(1); allDirty = false; }
    for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
      const k = by * BW + bx;
      if (blockDirty[k]) { blockDirty[k] = 0; composeBlock(bx, by); }
    }
    for (let i = 0; i < N; i++) out[i] = baseSubOn[i] ? blend(cgram[baseIdx[i]], cgram[baseSub[i]]) : lut[baseIdx[i]];
    drawSprites(out);
    return out;
  }

  // writes into VRAM (bytes) that may touch characters: call this instead of vram.set
  function writeVram(addr, bytes) {
    for (let k = 0; k < bytes.length; k++) {
      const a = (addr + k) & 0xFFFF;
      if (vram[a] !== bytes[k]) { vram[a] = bytes[k]; charDirty[a >> 4] = 1; anyCharDirty = true; }
    }
  }
  function forceAll() { for (let n = 1; n <= 3; n++) L[n].force = true; allDirty = true; clearObjCache(); }

  return {
    W, H, vram, cgram, oam, L, state,
    configure, setWindowLines, render, writeVram, forceAll, addGfx, vramObj, clearObjCache, setArt,
    gfx: (id) => gfxList[id],          // (read-only, for audits: a sprite's colour indices)
    set brightness(b) { brightness = b & 15; }, get brightness() { return brightness; },
    setObjBase(a, b) { objBase = a; objBase2 = b; clearObjCache(); },
  };
}
