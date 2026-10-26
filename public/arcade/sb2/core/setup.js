// Match settings and round initialisation, transliterated from the original's round
// entry C0FAA9 (C00D55, C0F3E4, C01EB1, C01D91, C00B8A, C01B9B, C13517, C1226F) and the
// between-rounds code (C00BD6 / C00B05, scoreboard CC4C7D, CC273E, CC26FC, CC0377).
import { r8, r16, w8, w16, OBJ } from './mem.js';
import { buildLayout, STAGE_IDS } from './layout.js';
import { emit } from './events.js';

// menu variables (bank $00 low RAM) — the battle reads copies of them (CC0377)
const M_LEVEL = 0x1CA5, M_BATTLE = 0x1CA7, M_TIME = 0x1CA9, M_GOLD = 0x1CAB;
const M_CHAMP = 0x1CAF, M_BONUS = 0x1CB1;
const TIME_IDX = { 1: 0, 2: 1, 3: 2, 5: 3 };     // minutes -> $5C54 (4 = infinite)
const MINUTES = [1, 2, 3, 5, 0xFFFF];            // $C5EE53
const DIGIT = [0x288F, 0x2886, 0x2887, 0x2888, 0x2889, 0x288A, 0x288B, 0x288C, 0x288D, 0x288E]; // $C5D432

// $2BF0 tile-animation list built by C135A6 for stage id 7 (stage 6 teleporter pads)
const ANIM_LIST_7 = '0046040010FFFFFFFFFFFFFFFFFFFFFF80828486FEFFFFFFFFFFFFFFFFFFFFFF002A040010FFFFFFFFFFFFFFFFFFFFFF88' +
  '8A8C8EFFFFFFFFFFFFFFFFFFFFFFFFFF00';

// ---- settings ----------------------------------------------------------------------
// opts: { stage 1..10, players: [{type:'human'|'cpu', level?}] x4,
//         rules: { wins 1..5, time 1|2|3|5|Infinity, gbomber bool, comLevel 1..9,
//                  champion slot|null, bonus 0..5 }, seed }
export function applySettings(opts = {}) {
  const rules = opts.rules || {};
  const stage = opts.stage || 1;
  if (stage < 1 || stage > 10) throw new Error('stage must be 1..10');
  const players = opts.players || [{ type: 'human' }, { type: 'cpu' }, { type: 'cpu' }, { type: 'cpu' }];
  const level = rules.comLevel || 5;
  const wins = rules.wins || 3;
  const time = rules.time === undefined ? 2 : rules.time;
  w16(0x1A, STAGE_IDS[stage - 1]);
  w16(0xB9, 0x8000);                              // battle mode
  w16(M_LEVEL, level - 1);
  w16(M_BATTLE, wins - 1);
  w16(M_TIME, time === Infinity || time === 0 ? 4 : (TIME_IDX[time] ?? 1));
  w16(M_GOLD, rules.gbomber === false ? 0 : 1);
  const champ = rules.champion == null ? 0xFFFF : rules.champion;
  w16(M_CHAMP, champ);
  w16(M_BONUS, champ === 0xFFFF ? 0xFFFF : (rules.bonus || 0));
  w16(0x1C68, 0);                                  // hidden full-spiral option: off
  for (let i = 0; i < 4; i++) {
    const p = players[i] || { type: 'cpu' };
    w16(0x5C4C + i * 2, p.type === 'human' ? 0 : 1);   // MAN/COM per slot
    w16(0x5C44 + i * 2, i);                            // bomber colour per slot
    w16(0x5E66 + i * 2, 0);                            // win counters
  }
  w16(0x5C40, 0);
  w16(0xD6, (opts.seed || 0) & 0xFFFF);
  copySettings();
}

function copySettings() {                          // CC0377
  w16(0x5C5A, r16(M_BATTLE) + 1);
  w16(0x5C58, r16(M_LEVEL));
  w16(0x5C54, r16(M_TIME));
  w16(0x5C5C, r16(M_GOLD));
  if (r16(M_GOLD)) {
    w16(0x5C42, r16(M_BONUS));
    w16(0x5C3C, r16(M_CHAMP));
  } else {
    w16(M_BONUS, 0xFFFF); w16(0x5C42, 0xFFFF);
    w16(M_CHAMP, 0xFFFF); w16(0x5C3C, 0xFFFF);
  }
}

// ---- C00D55: round globals ------------------------------------------------------------
function roundGlobals() {
  w16(0x5D3C, 0x00FF);                    // position masks (C0A146): y, x
  w16(0x5D3E, 0x00FF);
  w16(0x5D42, r16(0x1A));
  let b9 = r16(0xB9) | 1;
  if (b9 & 0x1000) b9 = 0x9000;
  b9 &= 0xB7FF;
  w16(0xB9, b9);
  w16(0x16, 0); w16(0xC0, 0);
  w16(0x5C56, 0xFFFF);
  const m = MINUTES[r16(0x5C54)];
  w16(0x5E10, m); w16(0x5E04, m);
  for (const a of [0x5E12, 0x5E06, 0x5E08, 0x5E14]) w16(a, 0);
  // C119EE: clock digit tiles
  if (r16(0x5C54) !== 4) {
    const t = r16(0x5C54);
    w16(0x5E0A, t === 0 ? 0x2886 : t === 1 ? 0x2887 : t === 2 ? 0x2888 : 0x288A);
    w16(0x5E0C, 0x288F); w16(0x5E0E, 0x288F);
  }
  w16(0x5CCC, 0xC0);
  for (const a of [0x5CB4, 0x5CB6, 0x5CCE, 0x5CE0, 0x5CE4, 0x5CE6, 0x5CE8, 0x5CEA, 0x5CEC, 0x5CBE,
    0x5D0E, 0x5D12, 0x5D14, 0x5D58, 0x5D60, 0x5D0C, 0x5D7E, 0x5DDC, 0x5E20, 0x5E28, 0x5E2A,
    0x5E32, 0x5E34, 0x5E36, 0x5E38, 0x5E3A, 0x5E3C, 0x5E54]) w16(a, 0);
  w8(0x30, 0); w8(0x38, 0); w8(0x3A, 0);   // 8-bit stores (brightness 0)
  for (const a of [0x5CDE, 0x5CE2, 0x5CF2, 0x5CF4, 0x5CF6, 0x5CF8, 0x5CC4, 0x5CC6, 0x3B48,
    0x2FF0, 0x30F0, 0x0500, 0x0600, 0x0700, 0x0800]) w16(a, 0xFFFF);
}

// ---- objects ---------------------------------------------------------------------------
function clearObjects() {                 // C01EB1 / C01ED5
  for (let a = 0x8000; a < 0x10000; a++) w8(a, 0);
  w16(0x32, 0); w16(0x34, 0);
  for (let a = 0x2620; a < 0x2A20; a += 2) w16(a, 0xFFFF);
}

function createBombers() {                // C01D91 -> C02153 / C02196 / C02401 / C021B0 / C021DC
  for (let s = 0; s < 4; s++) {
    const p = OBJ + s * 0x100;
    w16(p + 0x0A, s);
    w16(p, 0x8000);
    w16(p + 0x04, 0x0600);
    w16(p + 0x7E, 0);
    w16(p + 0x06, s); w16(p + 0x2A, s);
    w16(p + 0x50, 0);
    w16(p + 0x0C, 0); w16(p + 0x0E, 0); w16(p + 0x52, 0);
    w16(p + 0x6C, 0); w16(p + 0x6E, 0);
    // animation script pointers ($C201A5 / $C201CD by +50 = 0)
    w8(p + 0x76, 0x75); w8(p + 0x77, 0x03); w8(p + 0x78, 0xC2);
    w8(p + 0x70, 0x99); w8(p + 0x71, 0x03); w8(p + 0x72, 0xC2);
  }
}

function goldBomber() {                   // C00B8A
  if (!(r16(0xB9) & 0x8000) || (r16(0xB9) & 0x2000) || !r16(0x5C5C)) return;
  let a = r16(0x5C3C) | 0x0080;
  a = ((a & 0xFF) << 8) | (a >> 8);       // XBA
  w16(0x5C3C, a);
  if (a === 0xFFFF) return;
  w16(a + 0x04, r16(a + 0x04) | 0x0100);  // C00BC1
  w16(a + 0x50, 2);
}

function initBombers(G) {                 // C01B9B
  for (let k = 0; k < 40; k++) w16(0x12000 + k * 0x100, 0);   // C01D7A
  for (let a = 0; a < 0x200; a += 2) { w16(0x10000 + a, 0xFFFF); w16(0x3D88 + a, 0xFFFF); } // C01D63
  // C01A38: C0190D start stats (all stages but id 4)
  if (r16(0x1A) !== 4) {
    for (let s = 0; s < 4; s++) {
      const p = OBJ + s * 0x100;
      w16(p + 0xE0, 0x0101); w16(p + 0xF0, 0x0101);
      w16(p + 0xE2, 0x0001); w16(p + 0xF2, 0x0001);
      w8(p + 0xE4, 1);
    }
  }
  goldBonus();                            // C019CB
  spawns();                               // C01AF3
  const lvl = G && G.levels;
  for (let s = 0; s < 4; s++) {
    const p = OBJ + s * 0x100;
    w8(p + 0xF6, 0); w8(p + 0xF3, 0);
    w16(p + 0xD2, lvl && lvl[s] != null ? lvl[s] : r16(0x5C58));
    const f = (r16(p + 4) & 0xFFFC) | r16(0x5C4C + s * 2);
    w16(p + 4, f);
    if (f & 0x0002) {                     // empty slot: parked off-field
      w16(p, r16(p) | 0xA800);
      w16(p + 0x10, 0); w16(p + 0x18, 0xF0);
    }
  }
}

function goldBonus() {                    // C019CB, table $C5D5C2 (byte fields)
  if (!r16(0x5C5C)) return;
  const champ = r16(0x5C3C);
  if (champ === 0xFFFF) return;
  const T = [0xF1, 0xE1, 0xF0, 0xE0, 0xFE, 0xFE, 0xFF, 0xFF, 0xEF, 0xEF, 0xF0, 0xE0];
  const X = (r16(0x5C42) << 2) & 0xFFFF;  // byte offset into the word table
  const k = X >> 1;
  if (X === 0x14) {                       // 5: speed down (current and base)
    w8(champ + T[k], (r8(champ + T[k]) - 1) & 0xFF);
    w8(champ + T[k + 1], (r8(champ + T[k + 1]) - 1) & 0xFF);
    return;
  }
  w8(champ + T[k], (r8(champ + T[k]) + 1) & 0xFF);   // 0 bomb, 1 speed, 2 glove, 3 kick, 4 shield
  if (X < 8) w8(champ + T[k + 1], (r8(champ + T[k + 1]) + 1) & 0xFF);
}

const SPAWN = [0x20, 0x30, 0xE0, 0xD0, 0xE0, 0x30, 0x20, 0xD0];    // $C5E51C
const SPAWN4 = [0x60, 0x70, 0xA0, 0x90, 0xA0, 0x70, 0x60, 0x90];   // $C5E52C (stage id 5)
function spawns() {                       // C01AF3
  const t = r16(0x1A) === 5 ? SPAWN4 : SPAWN;
  for (let s = 0; s < 4; s++) {
    w16(OBJ + s * 0x100 + 0x10, t[s * 2]);
    w16(OBJ + s * 0x100 + 0x18, t[s * 2 + 1]);
  }
}

function animLists() {                    // C13517 / C13547 / C135A6
  for (let a = 0x2BF0; a < 0x2FF0; a += 2) w16(a, 0xFFFF);
  w8(0x5EEE, 0);
  if (r16(0x1A) === 7) for (let i = 0; i < ANIM_LIST_7.length / 2; i++) w8(0x2BF0 + i, parseInt(ANIM_LIST_7.substr(i * 2, 2), 16));
}

// ---- C0FAA9: one round's initialisation ------------------------------------------------
export function roundInit(G) {
  w16(0x18, 0xFFFF);
  roundGlobals();                         // C00D55
  w16(0x5D62, 0x1C00); w16(0x5D64, 0x1C00);   // C01EE8 / C02024 (BG base, display only)
  buildLayout(r16(0x1A));                 // C0F1E0 graphics + C0F3E4 layout chain
  clearObjects();                         // C01EB1
  w16(0x32, 0);
  createBombers();                        // C01D91
  goldBomber();                           // C00B8A
  initBombers(G);                         // C01B9B
  animLists();                            // C13517
  for (let a = 0x18000; a < 0x1A000; a += 2) w16(a, 0);   // C1226F danger map
  w16(0x18, 0);
  emit('roundStart', { stage: STAGE_IDS.indexOf(r16(0x1A)) + 1 });
}

// ---- between rounds --------------------------------------------------------------------
// C00BD6 (winner, fade-out), scoreboard CC4C7D (win counter), CC273E / CC26FC.
// Returns { winner: slot|null (draw), wins: [4], matchOver, champion }.
export function finishRound() {
  const b9 = r16(0xB9) | 0x0800;          // C0FBAB
  w16(0xB9, b9);
  w16(0x16, 0);
  // C00B05: first bomber not flagged dying, or $FFFF = draw
  let win = 0xFFFF;
  if (!(b9 & 0x2000)) {
    for (let i = 0; i < 4; i++) if (!(r16(OBJ + i * 0x100) & 0x0800)) { win = i; break; }
    w16(0x5C3E, win);
  }
  w8(0x30, 0x80);                         // faded out, forced blank
  w16(0x16, 1);
  let matchOver = false;
  if (win !== 0xFFFF) {                   // CC4C7D: scoreboard adds the win
    const a = 0x5E66 + (win & 3) * 2;
    const n = r16(a) + 1;
    w16(a, n);
    if (n >= r16(0x5C5A)) matchOver = true;
  }
  // CC273E: back up $B9, champion/bonus copies
  w16(0x1CAD, r16(0xB9));
  w16(0xB9, 0x1000);
  w16(0x5C42, r16(M_BONUS));
  w16(0x5C3C, r16(M_CHAMP));
  w16(0x16, 0);
  const wins = [0, 1, 2, 3].map((i) => r16(0x5E66 + i * 2));
  emit('roundResult', { winner: win === 0xFFFF ? null : win, draw: win === 0xFFFF, wins, sfx: win === 0xFFFF ? 0x46 : undefined });
  if (matchOver) {
    emit('matchOver', { winner: win, wins });
  } else {
    w16(0x5C40, 0);                       // CC26FC
    w16(0xB9, r16(0x1CAD));
    w16(0xC0, 0);
  }
  return { winner: win === 0xFFFF ? null : win, wins, matchOver };
}

// A new match after the previous one ended (VICTORY / roulette screens): the champion
// plays as the gold bomber if G-BOMBER is on; `bonus` = the roulette result 0..5.
export function newMatch({ champion = null, bonus = 0, stage } = {}) {
  if (stage) w16(0x1A, STAGE_IDS[stage - 1]);
  w16(M_CHAMP, champion == null ? 0xFFFF : champion);
  w16(M_BONUS, champion == null ? 0xFFFF : bonus);
  for (let i = 0; i < 4; i++) w16(0x5E66 + i * 2, 0);
  w16(0xB9, 0x8000);
  w16(0x5C40, 0);
  copySettings();
}
