// Super Bomberman 2 · Tall — the port's front end on the Gardener wall (the Arcade).
//
//   import { bootSB2 } from '/arcade/sb2/app.js';
//   const ctl = await bootSB2(hostElement, { onExit });   // ctl.raw(edge) / ctl.stop()
//
// Screens (fade only, nothing slides; every screen keeps its size while loading):
//   picker   stage (10 tall thumbnails rendered by the port), layout tall/original, CPU
//            level, wins to take the match — d-pad / A / B on the SN30 Pro
//   match    the core (./core) ticked once per display frame (rAF + accumulator, at most
//            one catch-up tick per frame), drawn by ./render at 256x455 (tall) or 256x224
//            and scaled to the wall's width with crisp pixels; P1 = white = the pad,
//            P2..P4 = CPUs
//   tally    after each round: the HUD faces and win digits extracted from the game
//   victory  the match winner, then back to the picker
// Input: the wall's raw pad edges (jb<idx><d|u>, jx<l|c|r>, jy<u|c|d>, src/pad.mjs),
// mapped to the core's bits. Select+Start: match -> picker -> Arcade shelf.
// The page being hidden pauses the game and its sound.
import { createGame } from './core/index.js';
import { loadPack, ASSET_BASE } from './render/pack.js';
import { createDisplay } from './render/display.js';
import { createAudio } from './audio.js';

export const SB2_TITLE = 'Super Bomberman 2 · Tall';
export const SB2_COVER = ASSET_BASE + 'pack/cover.png';

const BT = { B: 1, Y: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, A: 256, X: 512, L: 1024, R: 2048 };
// SN30 Pro raw button index -> core bit (same layout as the Arcade's RAWPAD: A0 B1 X3 Y4 L6 R7 Select10 Start11)
const PADMAP = { 0: BT.A, 1: BT.B, 3: BT.X, 4: BT.Y, 6: BT.L, 7: BT.R, 10: BT.SELECT, 11: BT.START };
const KEYMAP = { ArrowUp: BT.UP, ArrowDown: BT.DOWN, ArrowLeft: BT.LEFT, ArrowRight: BT.RIGHT,
  KeyX: BT.A, KeyZ: BT.B, KeyS: BT.X, KeyA: BT.Y, KeyQ: BT.L, KeyW: BT.R, Enter: BT.START, ShiftLeft: BT.SELECT, ShiftRight: BT.SELECT };
const STEP_MS = 1000 / 60.0988;          // the original's tick = one NTSC frame

const STAGES = [
  ['Classic', 'Soft blocks and pillars'], ['Ice', 'Slippery floor, holes that launch you'],
  ['Beach', 'Tunnels under the wall'], ['Barrels', 'A fuse track, start in the middle'],
  ['Garden', 'Power tiles, plates to hide under'], ['Warp', 'Teleporter pads'],
  ['Race', 'Speed pads and a stop pad'], ['Factory', 'Conveyor belts and switches'],
  ['Arrows', 'Arrow panels steer the bombs'], ['Forest', 'Mushrooms grow back, Y jumps'],
];
const COLOURS = ['White', 'Black', 'Red', 'Blue'];
const SETTINGS_KEY = 'garden.sb2.settings';

let packPromise = null;
const displays = new Map();    // layout -> { d, img }: kept for the page's life (see startMatch)
export function preloadSB2() {
  if (!packPromise) packPromise = loadPack().catch((e) => { packPromise = null; throw e; });
  return packPromise;
}

const CSS = `
.sb2 { position:absolute; inset:0; overflow:hidden; background:#000; color:var(--ink); font-family:var(--font);
  opacity:0; transition:opacity .4s linear; user-select:none; }
.sb2.ready { opacity:1; }
.sb2 * { box-sizing:border-box; }
.sb2-scr { position:absolute; inset:0; opacity:0; transition:opacity .28s linear; pointer-events:none; }
.sb2-scr.on { opacity:1; pointer-events:auto; }
.sb2-dark { background:radial-gradient(120% 70% at 50% 0%, #0b2c22 0%, #061a14 45%, #030c09 100%); }
/* picker */
.sb2-pick { display:flex; flex-direction:column; padding:64px 44px 40px; }
.sb2-kicker { font-size:15px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; color:var(--mint); }
.sb2-title { font-family:var(--font-display); font-weight:400; font-size:62px; line-height:1.02; margin-top:12px; color:#fff; }
.sb2-title b { font-weight:400; color:var(--mint); }
.sb2-grid { margin-top:38px; display:grid; grid-template-columns:repeat(5, 160px); grid-auto-rows:285px; gap:20px 12px; justify-content:center; }
.sb2-tile { position:relative; width:160px; height:285px; border-radius:12px; overflow:hidden; background:#02080a;
  box-shadow:0 10px 24px rgba(0,0,0,.45); opacity:.5; transition:opacity .15s linear; display:flex; align-items:center; justify-content:center; }
.sb2-tile img { width:160px; height:auto; display:block; }
.sb2-tile .n { position:absolute; left:0; bottom:0; min-width:34px; height:30px; padding:0 9px; border-radius:0 10px 0 0; background:rgba(2,10,8,.82);
  font-family:var(--font-display); font-size:22px; line-height:30px; color:#fff; text-align:center; }
.sb2-grid.dim .sb2-tile.sel { opacity:.8; }
.sb2-tile.sel { opacity:1; box-shadow:0 0 0 3px var(--mint), 0 14px 34px rgba(0,0,0,.6); }
.sb2-stage { margin-top:34px; text-align:center; min-height:84px; }
.sb2-stage .t { font-family:var(--font-display); font-size:40px; color:#fff; line-height:1.05; }
.sb2-stage .d { margin-top:6px; font-size:19px; color:var(--ink-soft); }
.sb2-opts { margin-top:26px; display:flex; flex-direction:column; gap:10px; }
.sb2-opt { display:flex; align-items:center; justify-content:space-between; height:62px; padding:0 22px; border-radius:16px;
  border:1px solid var(--stroke); font-size:21px; color:var(--ink-soft); }
.sb2-opt .v { display:flex; align-items:center; gap:14px; font-family:var(--font-display); font-size:30px; color:var(--ink); }
.sb2-opt .v i { font-style:normal; font-family:var(--font); font-size:22px; color:var(--ink-faint); opacity:0; }
.sb2-opt.sel { border-color:var(--mint); color:var(--ink); background:rgba(116,247,176,.07); }
.sb2-opt.sel .v i { opacity:1; color:var(--mint); }
.sb2-play { margin-top:28px; height:72px; border-radius:999px; display:flex; align-items:center; justify-content:center; gap:14px;
  font-size:24px; font-weight:600; color:#04140e; background:var(--mint); opacity:.8; }
.sb2-play.sel { opacity:1; box-shadow:0 10px 30px rgba(116,247,176,.28); }
.sb2-play kbd { font-family:var(--font); font-size:15px; font-weight:600; border:1.5px solid rgba(4,20,14,.45); border-radius:7px; padding:1px 8px; }
.sb2-hint { margin-top:auto; text-align:center; font-size:16px; color:var(--ink-faint); line-height:1.6; }
/* match */
.sb2-match { display:flex; align-items:center; justify-content:center; background:#000; }
.sb2-match canvas { display:block; width:100%; height:auto; image-rendering:pixelated; image-rendering:crisp-edges; }
.sb2-pause { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;
  background:rgba(2,8,6,.72); opacity:0; transition:opacity .2s linear; pointer-events:none; }
.sb2-pause.on { opacity:1; }
.sb2-pause .t { font-family:var(--font-display); font-size:72px; color:#fff; }
.sb2-pause .d { font-size:20px; color:var(--ink-soft); }
/* tally / victory */
.sb2-res { display:flex; flex-direction:column; align-items:center; padding:150px 50px 60px; text-align:center; }
.sb2-res .k { font-size:17px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; color:var(--mint); }
.sb2-res .h { font-family:var(--font-display); font-size:66px; line-height:1.05; color:#fff; margin-top:16px; }
.sb2-rows { margin-top:70px; display:flex; flex-direction:column; gap:22px; width:640px; }
.sb2-row { display:flex; align-items:center; gap:26px; height:124px; padding:0 28px; border-radius:22px; border:1px solid var(--stroke); }
.sb2-row.win { border-color:var(--gold); background:rgba(255,217,138,.07); }
.sb2-face { width:64px; height:64px; background-repeat:no-repeat; image-rendering:pixelated; flex:none; }
.sb2-row .nm { flex:1; text-align:left; font-size:26px; color:var(--ink); }
.sb2-row .nm small { display:block; font-size:16px; color:var(--ink-faint); margin-top:2px; }
.sb2-digit { width:32px; height:32px; background-repeat:no-repeat; image-rendering:pixelated; flex:none; }
.sb2-pips { display:flex; gap:8px; }
.sb2-pips span { width:16px; height:16px; border-radius:50%; border:2px solid var(--stroke-strong); }
.sb2-pips span.on { background:var(--gold); border-color:var(--gold); }
.sb2-foot { margin-top:auto; font-size:18px; color:var(--ink-faint); }
.sb2-champbox { margin-top:56px; width:240px; height:272px; display:flex; align-items:flex-end; justify-content:center; }
.sb2-champ { background-repeat:no-repeat; image-rendering:pixelated; }
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function preloadImg(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }

export async function bootSB2(host, { onExit } = {}) {
  if (!document.getElementById('sb2-style')) { const st = el('style'); st.id = 'sb2-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = el('div', 'sb2');
  host.appendChild(root);
  let stopped = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); timers.add(t); return t; };

  // ---- settings ---------------------------------------------------------------------------
  const set = { stage: 1, layout: 'tall', level: 5, wins: 3 };
  try { Object.assign(set, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* defaults */ }
  const saveSet = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(set)); } catch { /* ignore */ } };

  // ---- assets (nothing is shown until everything is in; then the whole thing fades in) --
  const pack = await preloadSB2();
  if (stopped) return null;
  const audio = createAudio(pack.audio);
  const thumbs = (layout) => Array.from({ length: 10 }, (_, i) => `${ASSET_BASE}pack/thumb_${layout === 'tall' ? 'tall' : 'orig'}_${String(i + 1).padStart(2, '0')}.png`);
  await Promise.all([...thumbs('tall'), ...thumbs('original'), ASSET_BASE + 'hud/faces.png', ASSET_BASE + 'hud/glyphs.png'].map(preloadImg)
    .concat([audio.preloadSfx(), document.fonts ? document.fonts.ready : null]));

  // ---- input --------------------------------------------------------------------------------
  let held = 0, latched = 0, prevHeld = 0;
  let onPress = null;                       // per-screen edge handler (bit)
  function down(bit) {
    if (!bit) return;
    const was = held;
    held |= bit; latched |= bit;
    if (!(was & bit)) {
      if ((held & (BT.SELECT | BT.START)) === (BT.SELECT | BT.START)) { selectStart(); return; }
      if (onPress) onPress(bit);
      repeatArm(bit);
    }
  }
  function up(bit) { held &= ~bit; if (bit === repeatBit) repeatBit = 0; }
  // held d-pad repeat for menus
  let repeatBit = 0, repeatAt = 0;
  const DIRS = BT.UP | BT.DOWN | BT.LEFT | BT.RIGHT;
  function repeatArm(bit) { if (bit & DIRS) { repeatBit = bit; repeatAt = performance.now() + 320; } }
  function repeatPoll(now) {
    if (repeatBit && (held & repeatBit) && now >= repeatAt && onPress) { repeatAt = now + 115; onPress(repeatBit); }
  }
  function raw(a) {
    if (stopped || typeof a !== 'string') return;
    if (a[1] === 'b') {
      const bit = PADMAP[a.charCodeAt(2) - 97];
      if (bit) { if (a[3] === 'd') down(bit); else up(bit); }
      return;
    }
    if (a[1] === 'x') { up(BT.LEFT); up(BT.RIGHT); if (a[2] === 'l') down(BT.LEFT); else if (a[2] === 'r') down(BT.RIGHT); return; }
    if (a[1] === 'y') { up(BT.UP); up(BT.DOWN); if (a[2] === 'u') down(BT.UP); else if (a[2] === 'd') down(BT.DOWN); }
  }
  const onKeyDown = (e) => { const b = KEYMAP[e.code]; if (b) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) down(b); } };
  const onKeyUp = (e) => { const b = KEYMAP[e.code]; if (b) { e.preventDefault(); e.stopPropagation(); up(b); } };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  // ---- screens ------------------------------------------------------------------------------
  let screen = null;
  function show(scr) {
    if (screen === scr) return;
    if (screen) screen.classList.remove('on');
    screen = scr;
    later(() => { if (screen === scr) scr.classList.add('on'); }, screen ? 120 : 0);
  }

  // ---- picker -------------------------------------------------------------------------------
  const pick = el('div', 'sb2-scr sb2-dark sb2-pick');
  pick.appendChild(el('div', 'sb2-kicker', 'Arcade · Battle'));
  pick.appendChild(el('div', 'sb2-title', 'Super Bomberman 2 <b>·</b> Tall'));
  const grid = el('div', 'sb2-grid');
  const tiles = [];
  for (let i = 0; i < 10; i++) {
    const t = el('div', 'sb2-tile');
    const img = el('img'); img.alt = ''; img.decoding = 'async';
    t.append(img, el('div', 'n', String(i + 1)));
    grid.appendChild(t); tiles.push({ t, img });
  }
  pick.appendChild(grid);
  const stageLine = el('div', 'sb2-stage');
  pick.appendChild(stageLine);
  const opts = el('div', 'sb2-opts');
  const optRow = (label) => { const r = el('div', 'sb2-opt'); const v = el('div', 'v'); r.append(el('span', null, label), v); opts.appendChild(r); return { r, v }; };
  const oLayout = optRow('Arena');
  const oLevel = optRow('CPU level');
  const oWins = optRow('Wins to take the match');
  pick.appendChild(opts);
  const play = el('div', 'sb2-play', 'Play <kbd>A</kbd>');
  pick.appendChild(play);
  pick.appendChild(el('div', 'sb2-hint', 'D-pad to choose · A to play · B back to the Arcade<br>In a match: Select + Start comes back here'));
  root.appendChild(pick);
  // focus: 0 = the stage grid, 2 = arena, 3 = CPU level, 4 = wins, 5 = play
  let focus = 0;
  function pickRender() {
    const th = thumbs(set.layout);
    tiles.forEach(({ t, img }, i) => {
      if (img.getAttribute('src') !== th[i]) img.src = th[i];
      t.classList.toggle('sel', i === set.stage - 1);
    });
    const [nm, note] = STAGES[set.stage - 1];
    stageLine.innerHTML = `<div class="t">Stage ${set.stage} · ${nm}</div><div class="d">${note}</div>`;
    const arrows = (txt) => `<i>‹</i>${txt}<i>›</i>`;
    oLayout.v.innerHTML = arrows(set.layout === 'tall' ? 'Tall 13 × 25' : 'Original 13 × 11');
    oLevel.v.innerHTML = arrows(String(set.level));
    oWins.v.innerHTML = arrows(String(set.wins));
    [oLayout, oLevel, oWins].forEach((o, k) => o.r.classList.toggle('sel', focus === k + 2));
    play.classList.toggle('sel', focus === 5);
    grid.classList.toggle('dim', focus !== 0);
  }
  function pickPress(bit) {
    if (bit === BT.B) { exit(); return; }
    if (bit === BT.A || bit === BT.START) { startMatch(); return; }
    const d = bit === BT.RIGHT ? 1 : bit === BT.LEFT ? -1 : 0;
    if (focus === 0) {
      // left / right walk the 10 stages (row to row), down goes to the options
      if (bit === BT.DOWN) focus = 2;
      else if (d) set.stage = ((set.stage - 1 + d + 10) % 10) + 1;
      else return;
    } else if (bit === BT.UP) focus = focus === 2 ? 0 : focus - 1;
    else if (bit === BT.DOWN) focus = Math.min(5, focus + 1);
    else if (d && focus === 2) set.layout = set.layout === 'tall' ? 'original' : 'tall';
    else if (d && focus === 3) set.level = Math.min(9, Math.max(1, set.level + d));
    else if (d && focus === 4) set.wins = Math.min(5, Math.max(1, set.wins + d));
    else return;
    saveSet();
    pickRender();
  }
  function showPicker() {
    stopLoop();
    audio.stopMusic(0.3);
    game = null;
    focus = 0;
    pickRender();
    onPress = pickPress;
    show(pick);
  }

  // ---- match --------------------------------------------------------------------------------
  const match = el('div', 'sb2-scr sb2-match');
  const canvas = el('canvas');
  const pauseEl = el('div', 'sb2-pause', '<div class="t">Paused</div><div class="d">Start to play on · Select + Start for the stage list</div>');
  match.append(canvas, pauseEl);
  root.appendChild(match);
  const c2d = canvas.getContext('2d', { alpha: false });
  let game = null, disp = null, img = null, paused = false, ended = false;
  let raf = 0, last = 0, acc = 0;
  const perf = { ticks: 0, tickMs: 0, drawMs: 0, frames: 0, worst: 0 };

  function startMatch() {
    saveSet();
    const layout = set.layout, stage = set.stage;
    game = createGame({
      stage, layout, seed: (Math.random() * 65536) | 0,
      players: [{ type: 'human' }, ...[1, 2, 3].map(() => ({ type: 'cpu', level: set.level }))],
      rules: { wins: set.wins, time: 3, gbomber: false, comLevel: set.level },
    });
    // one display per layout for the session: no per-match allocation, and the JIT keeps
    // its optimised render path (a fresh display per match measured 2.5x slower)
    let dv = displays.get(layout);
    if (!dv) {
      const d = createDisplay(pack, { layout, stage });
      dv = { d, img: new ImageData(new Uint8ClampedArray(d.out.buffer), 256, d.H) };
      displays.set(layout, dv);
    }
    disp = dv.d; img = dv.img;
    canvas.width = 256; canvas.height = disp.H;
    disp.beginRound(game);
    drawFrame();
    paused = false; pauseEl.classList.remove('on');
    ended = false;
    held = 0; latched = 0;
    onPress = matchPress;
    audio.playMusic('battle_stage' + String(stage).padStart(2, '0'));
    show(match);
    startLoop();
  }
  function matchPress(bit) {
    if (bit === BT.START && !(held & BT.SELECT)) { paused = !paused; pauseEl.classList.toggle('on', paused); if (paused) audio.suspend(); else audio.wake(); }
  }
  function selectStart() {
    if (screen === match || screen === tally || screen === victory) showPicker();
    else if (screen === pick) exit();
  }

  function tick() {
    const t0 = performance.now();
    const pads = [held | latched, null, null, null];
    latched = 0;
    game.tick(pads);
    const ev = game.events;
    disp.frame(game, ev);
    audio.events(ev);
    for (const e of ev) if (e.type === 'roundEnd') audio.stopMusic(0.6);
    perf.ticks++; perf.tickMs += performance.now() - t0;
    if (game.finished && !ended) { ended = true; later(roundOver, 300); }
  }
  function drawFrame() {
    const t0 = performance.now();
    disp.render();
    c2d.putImageData(img, 0, 0);
    const dt = performance.now() - t0;
    perf.frames++; perf.drawMs += dt;
  }
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    repeatPoll(ts);
    if (!game || paused || ended) { last = ts; return; }
    let dt = last ? ts - last : STEP_MS;
    last = ts;
    if (Math.abs(dt - STEP_MS) < 2.5) dt = STEP_MS;   // locked to a ~60 Hz display: one tick per frame
    acc += dt;
    let n = 0;
    while (acc >= STEP_MS && n < 2 && !ended) { tick(); acc -= STEP_MS; n++; }   // at most one catch-up tick
    if (acc >= STEP_MS) acc = 0;                       // a hiccup never fast-forwards
    if (n) drawFrame();
  }
  function startLoop() { if (!raf) { last = 0; acc = 0; raf = requestAnimationFrame(loop); } }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  // the picker also needs the rAF poll for the d-pad repeat
  function menuLoop(ts) { menuRaf = requestAnimationFrame(menuLoop); if (!raf) repeatPoll(ts); }
  let menuRaf = requestAnimationFrame(menuLoop);

  // ---- tally / victory ---------------------------------------------------------------------
  const tally = el('div', 'sb2-scr sb2-dark sb2-res');
  const victory = el('div', 'sb2-scr sb2-dark sb2-res');
  root.append(tally, victory);
  // HUD faces (hud/faces.png: 16x24 each, alive/dead per colour, 18 px apart); rows 4..19 = the face
  const faceCss = (i, dead, scale) => `background-image:url(${ASSET_BASE}hud/faces.png);background-size:${144 * scale}px ${24 * scale}px;background-position:-${(2 * i + (dead ? 1 : 0)) * 18 * scale}px -${4 * scale}px`;
  // HUD digits (hud/glyphs.png: 8x16 = the digit tile + the bar's lower border): the top 8x8
  const digitCss = (d, scale) => `background-image:url(${ASSET_BASE}hud/glyphs.png);background-size:${88 * scale}px ${16 * scale}px;background-position:-${d * 8 * scale}px 0`;
  let roundNo = 1;
  // the between-round figures extracted from the game (sprites/screen_bombers.png, real
  // palettes): cheering winner / loser loops, frame lengths in video frames
  const FIG = (pack.manifest.figures && pack.manifest.figures.anims) || {};
  const COLKEY = ['white', 'black', 'red', 'blue'];
  let figTimer = 0;
  function animateFigure(elm, i, kind, scale) {
    clearTimeout(figTimer);
    const fr = (FIG[COLKEY[i]] || {})[kind] || [];
    if (!elm || !fr.length) return;
    elm.style.backgroundImage = `url(${ASSET_BASE}${pack.manifest.figures.atlas})`;
    elm.style.backgroundSize = `${768 * scale}px ${770 * scale}px`;
    let k = 0;
    const step = () => {
      if (stopped || !elm.isConnected) return;
      const [x, y, w, h, d] = fr[k];
      elm.style.width = w * scale + 'px'; elm.style.height = h * scale + 'px';
      elm.style.backgroundPosition = `-${x * scale}px -${y * scale}px`;
      k = (k + 1) % fr.length;
      figTimer = setTimeout(step, Math.max(16, d * 1000 / 60.0988));
    };
    step();
  }
  function rowsHtml(wins, winner) {
    return wins.map((w, i) => {
      const pips = Array.from({ length: set.wins }, (_, k) => `<span class="${k < w ? 'on' : ''}"></span>`).join('');
      return `<div class="sb2-row${i === winner ? ' win' : ''}"><div class="sb2-face" style="${faceCss(i, winner != null && winner !== 'draw' && i !== winner, 4)}"></div>
        <div class="nm">${COLOURS[i]}<small>${i === 0 ? 'You' : 'CPU · level ' + set.level}</small></div>
        <div class="sb2-pips">${pips}</div><div class="sb2-digit" style="${digitCss(Math.min(9, w), 4)}"></div></div>`;
    }).join('');
  }
  function roundOver() {
    stopLoop();
    const res = game.nextRound();            // scoreboard bookkeeping (+ next round unless the match is over)
    const draw = res.winner == null || res.winner === 0xFFFF || res.winner === 'draw';
    const winner = draw ? null : res.winner;
    tally.innerHTML = `<div class="k">Round ${roundNo}</div><div class="h">${draw ? 'Draw' : COLOURS[winner] + ' wins the round'}</div>
      <div class="sb2-rows">${rowsHtml(res.wins, winner)}</div>
      <div class="sb2-foot">First to ${set.wins} win${set.wins === 1 ? '' : 's'} takes the match · A to go on</div>`;
    onPress = (bit) => { if (bit === BT.A || bit === BT.START) next(); };
    if (draw) audio.playMusic('draw', { loop: false });
    show(tally);
    const tmo = later(next, draw ? 6500 : 5000);
    let done = false;
    function next() {
      if (done) return; done = true; clearTimeout(tmo); timers.delete(tmo);
      if (res.matchOver) { showVictory(res, winner); return; }
      roundNo++;
      disp.beginRound(game);
      drawFrame();
      ended = false; held = 0; latched = 0;
      onPress = matchPress;
      audio.playMusic('battle_stage' + String(set.stage).padStart(2, '0'));
      show(match);
      startLoop();
    }
  }
  function showVictory(res, winner) {
    const w = winner != null ? winner : res.wins.indexOf(Math.max(...res.wins));
    victory.innerHTML = `<div class="k">Match over</div><div class="h">${COLOURS[w]} wins the match</div>
      <div class="sb2-champbox"><div class="sb2-champ"></div></div>
      <div class="sb2-rows" style="margin-top:60px">${rowsHtml(res.wins, w)}</div>
      <div class="sb2-foot">A for the stage list</div>`;
    animateFigure(victory.querySelector('.sb2-champ'), w, 'winner', 8);
    audio.playMusic('victory', { loop: false });
    onPress = (bit) => { if (bit === BT.A || bit === BT.START || bit === BT.B) back(); };
    show(victory);
    const tmo = later(back, 12000);
    let done = false;
    function back() { if (done) return; done = true; clearTimeout(tmo); timers.delete(tmo); roundNo = 1; showPicker(); }
  }

  // ---- lifecycle ------------------------------------------------------------------------------
  function onVis() {
    if (document.hidden) { stopLoop(); audio.suspend(); }
    else if (!stopped) { audio.wake(); if (screen === match && game && !ended) startLoop(); }
  }
  document.addEventListener('visibilitychange', onVis);
  function exit() { if (onExit) onExit(); }
  function stop() {
    if (stopped) return;
    stopped = true;
    stopLoop();
    cancelAnimationFrame(menuRaf);
    clearTimeout(figTimer);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('visibilitychange', onVis);
    audio.close();
    root.remove();
    if (window.__SB2 && window.__SB2.stop === stop) window.__SB2 = null;
  }

  showPicker();
  root.classList.add('ready');
  const ctl = {
    raw, stop,
    inGame: () => !stopped,
    get screen() { return screen === pick ? 'picker' : screen === match ? 'match' : screen === tally ? 'tally' : screen === victory ? 'victory' : null; },
    get state() { return game ? game.state : null; },
    perf,
    // QA hooks (headless tests, tools/sb2/qa/)
    _game: () => game, _disp: () => disp, _set: set, _audio: audio,
  };
  window.__SB2 = ctl;
  return ctl;
}
