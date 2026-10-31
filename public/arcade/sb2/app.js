// Super Bomberman 2 · Tall — the port's front end on the Gardener wall (the Arcade).
//
//   import { bootSB2 } from '/arcade/sb2/app.js';
//   const ctl = await bootSB2(hostElement, { onExit });   // ctl.raw(edge) / ctl.stop()
//
// Screens (all pixel pictures at 256 x 455 = the wall's 900 x 1600 at 3.52x, crisp):
//   menu     the ORIGINAL battle menus re-laid out for portrait (./menu.js): title, SINGLE
//            MATCH, player table, rules, stage select (+ the arena row TALL / CLASSIC)
//   match    the core (./core) at the original's real speed: one tick per SNES frame
//            (60.0988 Hz, never two ticks in one display frame), except the original's LAG
//            frames (./pacing.js: the frames its CPU overran) — no tick, no input, the old
//            picture stays; drawn by ./render at 256x455 (tall) or 256x224 and scaled to
//            the wall's width with crisp pixels; P1 = white = the pad
//   results  after each round / the match: the player table with the wins and the winner
//            (menu.js showResults), then the next round / back to SINGLE MATCH
// Input: the wall's raw pad edges (jb<idx><d|u>, jx<l|c|r>, jy<u|c|d>, src/pad.mjs),
// mapped to the SNES buttons exactly like the original (A/B/X/Y/L/R/Select/Start, d-pad).
// Select+Start: in a match -> the menus; in the menus -> the Arcade shelf. B on the title
// -> the shelf. The page being hidden pauses the game and its sound.
import { createGame } from './core/index.js';
import { loadPack, ASSET_BASE } from './render/pack.js';
import { createDisplay } from './render/display.js';
import { createAudio } from './audio.js';
import { createPacer } from './pacing.js';
import { loadMenuPack, createMenu } from './menu.js';
import { loadSkin, skinPack, skinMenuPack, GARDEN_BASE } from './render/skin.js';

export const SB2_TITLE = 'Super Bomberman: The Garden Edition';
export const SB2_COVER = GARDEN_BASE + 'cover.png';

const BT = { B: 1, Y: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, A: 256, X: 512, L: 1024, R: 2048 };
// SN30 Pro raw button index -> SNES bit (same layout as the Arcade's RAWPAD: A0 B1 X3 Y4 L6 R7 Select10 Start11)
const PADMAP = { 0: BT.A, 1: BT.B, 3: BT.X, 4: BT.Y, 6: BT.L, 7: BT.R, 10: BT.SELECT, 11: BT.START };
const KEYMAP = { ArrowUp: BT.UP, ArrowDown: BT.DOWN, ArrowLeft: BT.LEFT, ArrowRight: BT.RIGHT,
  KeyX: BT.A, KeyZ: BT.B, KeyS: BT.X, KeyA: BT.Y, KeyQ: BT.L, KeyW: BT.R, Enter: BT.START, ShiftLeft: BT.SELECT, ShiftRight: BT.SELECT };
const STEP_MS = 1000 / 60.0988;          // one SNES frame
const SETTINGS_KEY = 'garden.sb2.menu';
// the original's defaults (rules screen), the wall's one pad: 2P = COM; COM LEVEL ★ (10,
// core/ai_smart.js) instead of the original's 5. v: settings version (2 = the ★ default:
// settings saved before it get ★ once)
// skin: 'garden' (the Garden Edition, public/arcade/sb2/garden/: original art over the same
// game) or 'classic' (the original's pictures); the stage select's skin row switches it
const DEFAULTS = { players: ['human', 'cpu', 'cpu', 'cpu'], level: 10, wins: 3, time: 2, gbomber: true, stage: 1, layout: 'tall', skin: 'garden', v: 2 };

let packPromise = null, menuPromise = null, skinPromise = null, gardenPack = null;
const displays = new Map();    // layout:skin -> { d, img }: kept for the page's life (see startMatch)
export function preloadSB2() {
  if (!packPromise) packPromise = loadPack().catch((e) => { packPromise = null; throw e; });
  return packPromise;
}
function preloadSkin() {
  if (!skinPromise) skinPromise = loadSkin().catch(() => null);      // no overlay: classic only
  return skinPromise;
}
function preloadMenus() {
  if (!menuPromise) menuPromise = loadMenuPack().catch((e) => { menuPromise = null; throw e; });
  return menuPromise;
}

const CSS = `
.sb2 { position:absolute; inset:0; overflow:hidden; background:#000; opacity:0; transition:opacity .4s linear; user-select:none; }
.sb2.ready { opacity:1; }
.sb2-scr { position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:#000; }
.sb2-scr.on { display:flex; }
.sb2-scr canvas { display:block; width:100%; height:auto; image-rendering:pixelated; image-rendering:crisp-edges; }
.sb2-pause { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;
  background:rgba(0,0,0,.55); opacity:0; transition:opacity .2s linear; pointer-events:none; font-family:var(--font-display); color:#fff; }
.sb2-pause.on { opacity:1; }
.sb2-pause .t { font-size:72px; letter-spacing:.08em; }
.sb2-pause .d { font-family:var(--font); font-size:20px; color:rgba(255,255,255,.7); }
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function loadRGBA(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      res({ w: im.width, h: im.height, px: new Uint32Array(g.getImageData(0, 0, im.width, im.height).data.buffer) }); };
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function bootSB2(host, { onExit } = {}) {
  if (!document.getElementById('sb2-style2')) { const st = el('style'); st.id = 'sb2-style2'; st.textContent = CSS; document.head.appendChild(st); }
  const root = el('div', 'sb2');
  host.appendChild(root);
  let stopped = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); timers.add(t); return t; };

  // ---- settings (the menus' choices, kept on the wall) -----------------------------------------
  const set = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) set[k] = s[k];
    if (set.time === null) set.time = Infinity;        // JSON has no Infinity
    if (!(s.v >= 2)) { set.level = DEFAULTS.level; set.v = DEFAULTS.v; }   // the ★ default, once
  } catch { /* defaults */ }
  const saveSet = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...set, time: set.time === Infinity ? null : set.time })); } catch { /* ignore */ } };

  // ---- assets (nothing is shown until everything is in; then the whole thing fades in) --
  const [pack, mp, sk] = await Promise.all([preloadSB2(), preloadMenus(), preloadSkin()]);
  if (stopped) return null;
  const audio = createAudio(pack.audio);
  if (sk && !gardenPack) gardenPack = skinPack(pack, sk);
  const skins = sk ? ['garden', 'classic'] : ['classic'];
  if (!skins.includes(set.skin)) set.skin = skins[0];
  const packs = { classic: pack, garden: gardenPack || pack };
  const [figClassic, figGarden, gmini, gminiOrig] = await Promise.all([
    loadRGBA(ASSET_BASE + ((pack.manifest.figures && pack.manifest.figures.atlas) || 'sprites/screen_bombers.png')),
    sk && gardenPack.manifest.figures && gardenPack.manifest.figures.url ? loadRGBA(gardenPack.manifest.figures.url) : null,
    sk && sk.manifest.menu && sk.manifest.menu.mini ? loadRGBA(GARDEN_BASE + sk.manifest.menu.mini) : null,
    sk && sk.manifest.menu && sk.manifest.menu.miniOrig ? loadRGBA(GARDEN_BASE + sk.manifest.menu.miniOrig) : null,
  ]);
  const figAtlases = { classic: figClassic, garden: figGarden || figClassic };
  const mps = { classic: mp, garden: sk ? skinMenuPack(mp, sk, gmini, gminiOrig) : mp };
  await Promise.all([audio.preloadSfx(), audio.preloadMusic('title'), audio.preloadMusic('menu')]);
  if (stopped) return null;

  // ---- input --------------------------------------------------------------------------------
  let held = 0, latched = 0;
  let onPress = null;                       // per-screen edge handler (bit)
  function down(bit) {
    if (!bit) return;
    const was = held;
    held |= bit; latched |= bit;
    if (!(was & bit)) {
      if ((held & (BT.SELECT | BT.START)) === (BT.SELECT | BT.START)) { selectStart(); return; }
      if (onPress) onPress(bit);
    }
  }
  function up(bit) { held &= ~bit; }
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
    scr.classList.add('on');
  }

  // ---- the menus (and the results) ---------------------------------------------------------------
  const menuScr = el('div', 'sb2-scr');
  const mcanvas = el('canvas');
  mcanvas.width = 256; mcanvas.height = 455;
  menuScr.appendChild(mcanvas);
  root.appendChild(menuScr);
  const mctx = mcanvas.getContext('2d', { alpha: false });
  let game = null;
  const menus = {};
  function menuFor(skin) {
    if (!menus[skin]) {
      const m = createMenu(mps[skin], {
        audio, settings: set, skins,
        onChange: saveSet,
        onStart: () => { saveSet(); startMatch(); },
        onExit: () => exit(),
        onSkin: (to) => { saveSet(); setSkin(to); },
      });
      menus[skin] = { m, img: new ImageData(new Uint8ClampedArray(m.out.buffer), 256, 455) };
    }
    return menus[skin];
  }
  let menu = menuFor(set.skin).m, mimg = menuFor(set.skin).img;
  // the stage select's skin row: the other skin's menus take over on the same row
  function setSkin(to) {
    const was = menu;
    ({ m: menu, img: mimg } = menuFor(to));
    if (menu !== was) { menu.show('stage', { row: 2 }); onPress = (bit) => menu.press(bit); }
  }
  function showMenu(name, fadeIn) {
    stopLoop();
    game = null;
    if (fadeIn) menu.fadeIn(name); else menu.show(name);
    onPress = (bit) => menu.press(bit);
    show(menuScr);
    startLoop();
  }

  // ---- match --------------------------------------------------------------------------------
  const match = el('div', 'sb2-scr');
  const canvas = el('canvas');
  const pauseEl = el('div', 'sb2-pause', '<div class="t">PAUSE</div><div class="d">Start to play on · Select + Start for the menus</div>');
  match.append(canvas, pauseEl);
  root.appendChild(match);
  const c2d = canvas.getContext('2d', { alpha: false });
  let disp = null, img = null, paused = false, ended = false;
  let raf = 0, last = 0;
  const perf = { ticks: 0, tickMs: 0, drawMs: 0, frames: 0, worst: 0, lagFrames: 0 };
  const pacer = createPacer({ rom8: pack.rom8 });
  let lagLeft = 0, pendingDraw = false;      // lag frames still to wait out; picture held
  let roundNo = 1, champion = null, bonus = 0;
  const pads = [0, null, null, null];        // P1 = the pad; the others have no controller

  function startMatch() {
    roundNo = 1;
    const layout = set.layout === 'tall' ? 'tall' : 'original', stage = set.stage;
    game = createGame({
      stage, layout, seed: (Math.random() * 65536) | 0,
      players: set.players.map((t) => (t === 'human' ? { type: 'human' } : t === 'off' ? { type: 'off' } : { type: 'cpu', level: set.level })),
      rules: { wins: set.wins, time: set.time, gbomber: !!set.gbomber, comLevel: set.level,
        champion: set.gbomber ? champion : null, bonus: set.gbomber ? bonus : 0 },
    });
    // P1's pad; a second MAN (2P) has no controller on the wall: it stands still
    for (let i = 0; i < 4; i++) pads[i] = i === 0 && set.players[0] === 'human' ? 0 : null;
    // one display per layout for the session: no per-match allocation, and the JIT keeps
    // its optimised render path (a fresh display per match measured 2.5x slower)
    let dv = displays.get(layout + ':' + set.skin);
    if (!dv) {
      const d = createDisplay(packs[set.skin], { layout, stage, classic: true });   // classic bomb / fire colours
      dv = { d, img: new ImageData(new Uint8ClampedArray(d.out.buffer), 256, d.H) };
      displays.set(layout + ':' + set.skin, dv);
    }
    disp = dv.d; img = dv.img;
    canvas.width = 256; canvas.height = disp.H;
    disp.beginRound(game);
    pacer.reset(); lagLeft = 0; pendingDraw = false;
    drawFrame();
    paused = false; pauseEl.classList.remove('on');
    ended = false;
    held = 0; latched = 0;
    onPress = matchPress;
    audio.wake();
    audio.playMusic('battle_stage' + String(stage).padStart(2, '0'));
    stopLoop();
    show(match);
    startLoop();
  }
  function matchPress(bit) {
    if (bit === BT.START && !(held & BT.SELECT)) { paused = !paused; pauseEl.classList.toggle('on', paused); if (paused) audio.suspend(); else audio.wake(); }
  }
  function selectStart() {
    if (screen === match) { paused = false; pauseEl.classList.remove('on'); audio.wake(); audio.playMusic('menu'); showMenu('mode', true); }
    else exit();
  }

  function tick() {
    const t0 = performance.now();
    if (pads[0] !== null) pads[0] = held | latched;
    latched = 0;
    game.tick(pads);
    const ev = game.events;
    disp.frame(game, ev);
    lagLeft = pacer.after(game, disp) - 1;   // the original's frames for this tick
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
  // One SNES frame per display frame on the 60 Hz wall. sacc counts SNES frames due
  // (60.0988 Hz); a frame the original lost to lag costs no display frame when there is a
  // debt to absorb, so the long-run tick rate is the original's. Never two ticks in one
  // display frame; a hiccup never fast-forwards.
  let sacc = 0.5;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    let dt = last ? ts - last : STEP_MS;
    last = ts;
    if (dt > 3 * STEP_MS || dt < 0) dt = STEP_MS;
    if (screen === menuScr) {                // the menus: one menu frame per display frame
      sacc += dt / STEP_MS;
      if (sacc >= 1) { sacc -= 1; menu.frame(held); mctx.putImageData(mimg, 0, 0); }
      if (sacc > 2.5) sacc = 1.5;
      return;
    }
    if (!game || paused || ended) { if (pendingDraw && game && ended) { pendingDraw = false; drawFrame(); } return; }
    sacc += dt / STEP_MS;
    let ticked = false;
    while (sacc >= 1) {
      if (lagLeft > 0) {                 // the original's lag frame: no tick, old picture,
        lagLeft--; sacc -= 1;            // and a press made only during it is never read
        latched = 0; perf.lagFrames++;
        if (lagLeft === 0 && pendingDraw) { pendingDraw = false; drawFrame(); }
        continue;
      }
      if (ticked || ended) break;
      tick(); sacc -= 1; ticked = true;
      if (lagLeft > 0) pendingDraw = true;   // the picture appears when the tick "completes"
      else drawFrame();
    }
    if (sacc > 2.5) sacc = 1.5;          // no lag frame to absorb the drift: drop it
  }
  function startLoop() { if (!raf) { last = 0; sacc = 0.5; raf = requestAnimationFrame(loop); } }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  // ---- results (the original's player table with the wins) -----------------------------------
  const FIGS = { classic: (pack.manifest.figures && pack.manifest.figures.anims) || {},
    garden: (packs.garden.manifest.figures && packs.garden.manifest.figures.anims) || (pack.manifest.figures && pack.manifest.figures.anims) || {} };
  const COLKEY = ['white', 'black', 'red', 'blue'];
  function roundOver() {
    if (screen !== match || !game) return;          // left for the menus meanwhile
    stopLoop();
    const res = game.nextRound();            // scoreboard bookkeeping (+ next round unless the match is over)
    const draw = res.winner == null || res.winner === 0xFFFF || res.winner === 'draw';
    const winner = draw ? null : res.winner;
    let done = false;
    const next = () => {
      if (done) return; done = true;
      if (res.matchOver) { matchOver(res, winner); return; }
      roundNo++;
      disp.beginRound(game);
      pacer.reset(); lagLeft = 0; pendingDraw = false;
      drawFrame();
      ended = false; held = 0; latched = 0;
      onPress = matchPress;
      audio.playMusic('battle_stage' + String(set.stage).padStart(2, '0'));
      stopLoop();
      show(match);
      startLoop();
    };
    if (draw) audio.playMusic('draw', { loop: false });
    menu.showResults({ wins: res.wins, winner, figure: winner != null ? figure(winner, 'winner') : null, onDone: next });
    onPress = (bit) => menu.press(bit);
    show(menuScr);
    startLoop();
    later(next, draw ? 6500 : 5000);
  }
  function matchOver(res, winner) {
    const w = winner != null ? winner : res.wins.indexOf(Math.max(...res.wins));
    champion = set.gbomber ? 0x8000 + 0x100 * w : null;       // G-BOMBER: the gold bomber of the next match
    bonus = (Math.random() * 6) | 0;                          // (the roulette's pick)
    audio.playMusic('victory', { loop: false });
    let done = false;
    const back = () => { if (done) return; done = true; roundNo = 1; audio.playMusic('menu'); showMenu('mode', true); };
    menu.showResults({ wins: res.wins, winner: w, figure: figure(w, 'winner'), onDone: back });
    later(back, 12000);
  }
  function figure(i, kind) {
    const fr = ((FIGS[set.skin] || FIGS.classic)[COLKEY[i]] || {})[kind] || [];
    const figAtlas = figAtlases[set.skin];
    return fr.length && figAtlas ? { atlas: figAtlas, frames: fr.map((f) => [f[0], f[1], f[2], f[3], Math.max(1, f[4])]) } : null;
  }

  // ---- lifecycle ------------------------------------------------------------------------------
  function onVis() {
    if (document.hidden) { stopLoop(); audio.suspend(); }
    else if (!stopped) { audio.wake(); if ((screen === match && game && !ended) || screen === menuScr) startLoop(); }
  }
  document.addEventListener('visibilitychange', onVis);
  function exit() { if (onExit) onExit(); }
  function stop() {
    if (stopped) return;
    stopped = true;
    stopLoop();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('visibilitychange', onVis);
    audio.close();
    root.remove();
    if (window.__SB2 && window.__SB2.stop === stop) window.__SB2 = null;
  }

  audio.playMusic('title');
  showMenu('title');
  root.classList.add('ready');
  const ctl = {
    raw, stop,
    inGame: () => !stopped,
    get screen() { return screen === match ? 'match' : screen === menuScr ? (menu.screen === 'results' ? 'results' : 'menu:' + menu.screen) : null; },
    get state() { return game ? game.state : null; },
    perf,
    // QA hooks (headless tests, tools/sb2/qa/)
    _game: () => game, _disp: () => disp, _set: set, _audio: audio, get _menu() { return menu; }, _setSkin: (s) => { set.skin = s; saveSet(); setSkin(s); },
  };
  window.__SB2 = ctl;
  return ctl;
}
