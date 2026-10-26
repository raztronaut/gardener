// game.state — the renderer's view of the core, rebuilt from the WRAM image on demand.
// Plain JSON-serialisable data; documented in STATE.md. Nothing here feeds back into the
// logic (the authoritative state is game.mem; game.save()/load() serialise that).
import { r8, r16, s16 } from './mem.js';
import { SETS } from './animdata.js';

export const ITEM_NAMES = {
  0x00: 'bomb_up', 0x02: 'fire_up', 0x04: 'pierce', 0x06: 'full_fire', 0x08: 'bomb_pass',
  0x0A: 'skull', 0x0E: 'remote', 0x20: 'wall_pass', 0x22: 'speed_up', 0x24: 'kick',
  0x26: 'glove', 0x28: 'rubber_bomb', 0x2A: 'power_bomb', 0x40: 'heart',
};
const FACING = { 2: 'right', 4: 'left', 8: 'down', 0x10: 'up' };
const DISEASES = [null, 'blink', 'diarrhea', 'constipation', 'fast', 'slow', 'weak'];
const BOMB_TYPES = { 0: 'normal', 1: 'remote', 2: 'power', 4: 'pierce', 8: 'rubber' };
const STAGE_OF_ID = { 0: 1, 1: 2, 2: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 0xA: 9, 0xB: 10 };
const r24 = (a) => r8(a) | (r8(a + 1) << 8) | (r8(a + 2) << 16);

export function buildState(game) {
  const tall = !!(game.layout && game.layout.tall);
  const rows = tall ? [2, 30] : [2, 16];       // incl. the border ring (+ tunnel rows)
  const cols = [0, 16];
  const b9 = r16(0xB9);
  const stageId = r16(0x1A);

  // ---- grid ---------------------------------------------------------------------
  const W = cols[1] - cols[0] + 1, H = rows[1] - rows[0] + 1;
  const code = new Array(W * H), under = new Array(W * H), tile = new Array(W * H);
  const items = [], fire = [];
  for (let y = rows[0]; y <= rows[1]; y++) for (let x = cols[0]; x <= cols[1]; x++) {
    const g = y * 0x80 + x * 2, t = y * 0x40 + x * 2, k = (y - rows[0]) * W + (x - cols[0]);
    code[k] = r8(0x1C000 + g); under[k] = r8(0x1D000 + g); tile[k] = r16(0x1A000 + t);
    if (code[k] === 0x44) items.push({ cx: x, cy: y, tile: tile[k], kind: ITEM_NAMES[tile[k] & 0xFF] || null });
    if (code[k] === 0x01 || code[k] === 0x41) fire.push({ cx: x, cy: y, tile: tile[k], burningItem: code[k] === 0x41 });
  }

  // ---- bombers ------------------------------------------------------------------
  const wins = [0, 1, 2, 3].map((i) => r16(0x5E66 + 2 * i));
  const bombers = [];
  for (let i = 0; i < 4; i++) {
    const p = 0x8000 + 0x100 * i;
    const f = r16(p), s52 = r16(p + 0x52), f04 = r16(p + 4);
    const x = r16(p + 0x10), y = r16(p + 0x18);
    bombers.push({
      slot: i, active: !!(f & 0x8000), dying: !!(f & 0x0800), gone: !!(r16(p + 0x60) & 0x0800),
      x, y, xf: r16(p + 0x12), yf: r16(p + 0x1A),
      cx: (x + 8) >> 4, cy: (y + 23) >> 4,
      // screen position of the sprite's bottom-centre in arena pixels: (x, y + 16) top-left
      facing: FACING[r16(p + 0x5E)] || null, moving: !!(r16(p + 0x0E) & 0x1000),
      input: r16(p + 0x6E),
      anim: { set: r16(p + 0x50), id: r16(p + 0x6A), timer: r16(p + 0x0C), script: r24(p + 0x70), pose: r24(p + 0x79) },
      state: s52, busy: !!(s52 & 1), carrying: (s52 & 0x7F) === 6 || !!(s52 & 2), lifting: (s52 & 0x7F) === 3,
      stunned: (s52 & 0xFF) === 0x81, jumping: !!(r16(p + 0x52) & 0x1000),
      com: !!(f04 & 1), level: r16(p + 0xD2) + 1, gold: !!(f04 & 0x100),
      hidden: !!(f04 & 0x40), flicker: !!(f04 & 0x20), offscreen: !!(f & 0x2000),
      speedLevel: r8(p + 0xF0), speedBase: r8(p + 0xE0), bombsCap: r8(p + 0xE1), bombsHand: r8(p + 0xF1),
      bombsOut: r8(p + 0xF8), fire: r8(p + 0xF2), bombType: BOMB_TYPES[r8(p + 0xF3)] || r8(p + 0xF3),
      kick: !!r8(p + 0xFF), glove: !!r8(p + 0xFE), wallPass: !!r8(p + 0xFB), bombPass: !!r8(p + 0xFA),
      shield: r8(p + 0xEF), disease: DISEASES[r8(p + 0xF5)] || null, wins: wins[i],
    });
  }

  // ---- bombs ----------------------------------------------------------------------
  const bombs = [];
  for (let k = 0; k < 40; k++) {
    const b = 0x12000 + 0x100 * k, fl = r16(b);
    if (!(fl & 0x8000)) continue;
    const g = r16(b + 0x0A);
    bombs.push({
      slot: k, cx: (g & 0x7F) >> 1, cy: g >> 7, owner: r8(b + 6), fuse: r8(b + 4), range: r8(b + 7),
      type: BOMB_TYPES[fl & 0x0F] || fl & 0x0F, exploding: !!(fl & 0x4000), moving: !!(fl & 0x1000),
      triggered: !!(fl & 0x0040), timer: r8(b + 8), frame: r8(b + 9), tile: r16(b + 2), flags: fl,
    });
  }

  // ---- other objects (kicked / thrown bombs, flying items, pushed blocks …) -----------
  const movers = [];
  for (let s = 4; s < 32; s++) {
    const p = 0x8000 + 0x100 * s, f = r16(p);
    if (!(f & 0x8000)) continue;
    const mode = (r16(p + 0x7E) >> 8) & 0x0F;
    movers.push({
      slot: s, kind: ['object', 'bomb', 'item', 'block'][mode] || 'object', x: r16(p + 0x10), y: r16(p + 0x18),
      height: s16(p + 0x9C) || 0, state: r16(p + 0x52), facing: FACING[r16(p + 0x5E)] || null,
      anim: { set: r16(p + 0x50), id: r16(p + 0x6A), timer: r16(p + 0x0C), pose: r24(p + 0x79) },
      bomb: r16(p + 0x40) >= 0x2000 ? (r16(p + 0x40) - 0x2000) >> 8 : null,
    });
  }

  // ---- burning blocks ------------------------------------------------------------------
  const burning = [];
  for (let e = 0; e < 32; e++) {
    const a = 0x10000 + 16 * e;
    if (r16(a) & 0x8000) continue;     // free entry ($FFFF / negative)
    const g = r16(a + 2);
    burning.push({ cx: (g & 0x7F) >> 1, cy: g >> 7, item: r8(a + 4) === 4, frame: r8(a + 6), timer: r8(a + 5), owner: r8(a + 7) });
  }

  // ---- round ---------------------------------------------------------------------------
  const roundOver = !!(b9 & 0x4000);
  const winner = r16(0x5C3E);
  return {
    tick: r16(0x32), rng: r16(0xD6),
    stage: STAGE_OF_ID[stageId] || null, stageId, layout: tall ? 'tall' : 'original',
    brightness: r8(0x30) & 0x0F, frozen: (r8(0x30) & 0x0F) !== 0x0F,
    clock: { min: r16(0x5E10), sec: r16(0x5E12), sub: r16(0x5E14), infinite: r16(0x5C54) === 4,
      timeUp: r16(0x5C56) === 0, stopped: !!(r16(0x5E20) & 0x8000) },
    hurry: !!(r16(0x5E34) & 0x8000), suddenDeath: !!(r16(0x5D0E) & 1),
    roundOver, overTicksLeft: roundOver ? r16(0xBE) : null, finished: roundOver && r16(0xBE) === 0,
    winner: roundOver && r16(0xBE) === 0 ? (winner === 0xFFFF ? 'draw' : winner) : null,
    wins,
    grid: { cols, rows, width: W, height: H, code, under, tile },
    items, fire, burning, bombers, bombs, movers,
    events: game.events,
  };
}
