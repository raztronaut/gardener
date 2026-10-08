// Arcade — a retro-console emulator. The dashboard card is a calm pixel tile
// (a count of ROMs found + a cabinet marquee naming the DAY'S featured game, a
// deterministic pick that rolls at midnight); openFull shows a ROM PICKER and
// then boots EmulatorJS (https://emulatorjs.org) for the selected game.
//
// We ship NO ROMs and NO emulator cores. The user drops console files into the
// gitignored data/roms/ dir (see EMULATOR.md); the wall server lists them at
// /api/roms and streams them at /roms/<file>. EmulatorJS + its cores load at
// runtime from cdn.emulatorjs.org (the kiosk has internet; cores are large).
//
// Controller: the SN30 Pro is also a browser Gamepad, so EmulatorJS reads it
// natively for GAMEPLAY. While the picker is up we drive selection from the pad
// bridge; in-game our input() is a no-op (EmulatorJS owns the pad). 'back'
// (L2/Esc) is handled by the parent → it calls our stop(), which HARD-STOPS the
// emulator + its audio.

// The EmulatorJS data dir + the actual EJS_* boot setup live SERVER-side in
// /emu-frame.html (src/server.mjs serveEmuFrame); the widget just points an
// iframe there. EmulatorJS core ids keyed by the system our server infers.
const CORE = {
  nes: 'nes', snes: 'snes', gb: 'gb', gbc: 'gb', gba: 'gba',
  n64: 'n64', segaMD: 'segaMD', segaMS: 'segaMS', pce: 'pce',
};
const SYS_LABEL = {
  nes: 'NES', snes: 'SNES', gb: 'GAME BOY', gbc: 'GBC', gba: 'GBA',
  n64: 'N64', segaMD: 'GENESIS', segaMS: 'SMS', pce: 'PC ENGINE',
};
// Full console names for the detail panel ("metadata and shit").
const SYS_NAME = {
  nes: 'Nintendo Entertainment System', snes: 'Super Nintendo', gb: 'Game Boy',
  gbc: 'Game Boy Color', gba: 'Game Boy Advance', n64: 'Nintendo 64',
  segaMD: 'Sega Genesis / Mega Drive', segaMS: 'Sega Master System', pce: 'PC Engine / TurboGrafx-16',
};
// libretro thumbnail-repo folder names — best-effort progressive enhancement for
// real boxart/snaps. Homebrew titles 404 here (expected); we just keep the
// generated cover when that happens.
const LIBRETRO_FOLDER = {
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  gb: 'Nintendo - Game Boy', gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance', n64: 'Nintendo - Nintendo 64',
  segaMD: 'Sega - Mega Drive - Genesis', segaMS: 'Sega - Master System - Mark III',
  pce: 'NEC - PC Engine - TurboGrafx 16',
};

// Deterministic hash → two hues for a per-title gradient. Stable across renders
// so a game always wears the same "box art" colours.
function hashHue(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
// A procedural, always-works cover gradient derived from the title hash. Dark,
// saturated, retro — tuned to read like a curated shelf even fully offline.
function coverGradient(name) {
  const v = hashHue(name);
  const h1 = v % 360;
  const h2 = (h1 + 40 + (v >> 9) % 80) % 360;
  const ang = 130 + (v >> 3) % 60;
  return `linear-gradient(${ang}deg, hsl(${h1} 62% 26%), hsl(${h2} 58% 14%))`;
}
// A tiny deterministic pixel-art glyph (CSS-drawn, no assets) for the cover
// corner — a little retro motif so tiles aren't bare.
function pixelMotif(name) {
  const v = hashHue(name + 'pix');
  const on = [];
  for (let i = 0; i < 16; i++) on.push((v >> i) & 1);
  let rects = '';
  for (let i = 0; i < 16; i++) {
    if (!on[i]) continue;
    const x = i % 4, y = (i / 4) | 0;
    // mirror horizontally for a symmetric, sprite-like motif
    rects += `<rect x="${x}" y="${y}" width="1" height="1"/><rect x="${7 - x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" fill="rgba(255,255,255,.7)">${rects}</svg>`;
}
// libretro thumbnail URLs (boxart for tiles, snap/title for the detail preview).
// Images don't need the proxy/allowlist — set src directly; 404s fall back.
function boxartURL(rom) {
  const folder = LIBRETRO_FOLDER[rom.system];
  if (!folder) return null;
  return `https://thumbnails.libretro.com/${encodeURIComponent(folder)}/Named_Boxarts/${encodeURIComponent(rom.name)}.png`;
}
function previewURLs(rom) {
  const folder = LIBRETRO_FOLDER[rom.system];
  if (!folder) return [];
  const base = `https://thumbnails.libretro.com/${encodeURIComponent(folder)}/`;
  // prefer an in-game snap (closest affordable analog to a "video preview"),
  // then the title screen.
  return [
    `${base}Named_Snaps/${encodeURIComponent(rom.name)}.png`,
    `${base}Named_Titles/${encodeURIComponent(rom.name)}.png`,
  ];
}
function fmtSize(bytes) {
  if (!bytes || bytes < 1024) return null;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default {
  id: 'emulator',
  title: 'Arcade',
  icon: '🕹',
  size: 'sq',
  chrome: true,

  // ---- dashboard card: a calm static tile (no animation, no EmulatorJS) -----
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .em { position:relative; flex:1; min-height:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:11px; cursor: var(--c-hand); overflow:hidden;
        -webkit-tap-highlight-color:transparent; user-select:none; }
      /* faint static CRT scanlines confined to the tile — a cheap repeating gradient
         (no animation, essentially free to render) that gives the empty Arcade card
         a retro-cabinet feel instead of a bare glass square. */
      .em::before { content:''; position:absolute; inset:0; pointer-events:none; opacity:.5;
        background:repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 2px, transparent 2px 4px); }
      /* a hushed mint glow pooled behind the gamepad — static radial, no blur filter */
      .em::after { content:''; position:absolute; left:50%; top:46%; width:150px; height:150px;
        transform:translate(-50%,-50%); pointer-events:none;
        background:radial-gradient(circle, rgba(116,247,176,.16) 0%, transparent 62%); }
      .em-glyph { position:relative; width:70px; height:52px;
        filter:drop-shadow(0 3px 12px rgba(116,247,176,.35)); }
      .em-glyph svg { width:100%; height:100%; display:block; image-rendering:pixelated; }
      .em-hint { position:relative; text-align:center; line-height:1.4; }
      /* game count as the hero: a mint display number beside a hushed caption */
      .em-count { display:flex; align-items:baseline; justify-content:center; gap:6px; }
      .em-count .n { font-family:var(--font-display); font-weight:700; font-size:22px; line-height:1;
        color:var(--mint); text-shadow:0 0 12px rgba(116,247,176,.4); }
      .em-count .lbl, .em-empty { font-family:var(--font-mono); font-size:11.5px; letter-spacing:.14em;
        text-transform:uppercase; color:var(--ink-faint); }
      /* the call-to-action, styled like a cabinet marquee prompt */
      .em-cta { position:relative; margin-top:8px; font-family:var(--font-mono); font-size:11.5px;
        font-weight:600; letter-spacing:.22em; text-transform:uppercase; color:var(--mint);
        text-shadow:0 0 10px rgba(116,247,176,.35); max-width:100%;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .em-cta .ar { color:var(--mint-2); }
      /* featured-game marquee — once the library resolves, the generic prompt
         becomes a cabinet marquee naming the DAY'S PICK (a deterministic choice
         that changes gently at midnight), so a glance reveals what's inside and
         invites a play. Static, no motion; the play caret leads the title, which
         ellipsizes so a long ROM name never spills past the small tile. */
      .em-cta.pick { letter-spacing:.14em; }
      .em-cta.pick .ar { margin-right:5px; }
      .em-cta.pick .g { color:var(--mint); font-weight:700; }
    `);
    // A pixel game-pad glyph drawn in the mint palette (inline SVG, no assets).
    const glyph = h('div', { class: 'em-glyph', html: `
      <svg viewBox="0 0 48 34" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
        <rect x="3" y="9" width="42" height="18" rx="8" fill="none" stroke="#74f7b0" stroke-width="2"/>
        <!-- d-pad -->
        <rect x="10"   y="16.5" width="10" height="3" fill="#74f7b0"/>
        <rect x="13.5" y="13"   width="3"  height="10" fill="#74f7b0"/>
        <!-- face buttons (diamond) -->
        <circle cx="34" cy="14" r="2" fill="#43e6c6"/>
        <circle cx="38" cy="18" r="2" fill="#43e6c6"/>
        <circle cx="34" cy="22" r="2" fill="#43e6c6"/>
        <circle cx="30" cy="18" r="2" fill="#43e6c6"/>
      </svg>` });
    // Library state (updated once the ROM count resolves); starts calm and neutral.
    const hint = h('div', { class: 'em-hint' },
      h('div', { class: 'em-empty' }, 'retro console'));
    const cta = h('div', { class: 'em-cta' }, 'Click to play ', h('span', { class: 'ar' }, '▶'));
    body.classList.add('em');
    body.replaceChildren(glyph, hint, cta);

    // Cheap one-shot ROM count (no animation, no heavy work — smoke renders
    // the dashboard headless, so this must stay light and never throw).
    try {
      const r = await fetch('/api/roms', { cache: 'no-store' });
      const { roms = [] } = await r.json();
      hint.replaceChildren(roms.length
        ? h('div', { class: 'em-count' },
            h('span', { class: 'n' }, String(roms.length)),
            h('span', { class: 'lbl' }, `game${roms.length === 1 ? '' : 's'} ready`))
        : h('div', { class: 'em-empty' }, 'drop ROMs to begin'));
      // Cabinet marquee: name the DAY'S featured game so the tile invites a
      // specific play, not a generic prompt. The pick is deterministic per
      // calendar day (stable through the day, rolls at midnight) — no motion,
      // just a quiet daily rotation through whatever's actually in the library.
      const named = roms.filter((g) => g && (g.name || g.file));
      if (named.length) {
        const now = new Date();
        const doy = Math.floor(
          (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
            - Date.UTC(now.getFullYear(), 0, 1)) / 864e5);
        const g = named[doy % named.length];
        const title = String(g.name || g.file).replace(/\.[a-z0-9]+$/i, '');
        cta.className = 'em-cta pick';
        cta.replaceChildren(
          h('span', { class: 'ar' }, '▶'),
          h('span', { class: 'g' }, title));
        cta.title = `Today's pick: ${title} — click to play (${named.length} game${named.length === 1 ? '' : 's'})`;
      }
    } catch { /* offline / no endpoint — keep the neutral hint + prompt */ }
  },

  // ---- fullscreen: ROM picker → EmulatorJS -----------------------------------
  async openFull(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      /* Full-bleed horizontally: cancel the panel-body's 28px side padding so the
         game has NO left/right margin (edge to edge), keeping the top. */
      .eg { position:relative; width:calc(100% + 56px); margin:0 -28px; height:calc(100vh - 150px);
        min-height:380px; display:flex; flex-direction:column; }
      .eg .eg-pick { padding-left:28px; padding-right:28px; } /* the picker keeps comfortable insets */
      /* picker — OpenEmu layout: a scrolling cover GRID (left) + a DETAIL
         sidebar (right) with the big cover, full metadata and a Play button. */
      .eg-pick { flex:1; min-height:0; display:flex; flex-direction:column; padding:6px 4px 0; }
      .eg-pick-h { flex:none; display:flex; align-items:baseline; justify-content:space-between; gap:12px;
        font-family:var(--font-mono); font-size:12.5px; letter-spacing:.18em; text-transform:uppercase;
        color:var(--ink-faint); padding:0 6px 12px; }
      .eg-pick-h b { color:var(--mint); font-weight:600; }
      .eg-cols { flex:1; min-height:0; display:flex; gap:22px; padding:0 6px 8px; }
      .eg-grid { flex:1; min-height:0; overflow:auto; display:grid;
        grid-template-columns:repeat(var(--eg-cols,2), 1fr); gap:18px; align-content:start; padding:3px; }
      /* a cover tile: a 3:4 portrait box-art card with a real drop shadow */
      .eg-rom { position:relative; aspect-ratio:3 / 4; display:block; text-align:left;
        background:transparent; border:none; border-radius:14px; padding:0;
        color:var(--ink); cursor: var(--c-hand); font:inherit; overflow:hidden; box-shadow:0 8px 22px rgba(0,0,0,.42);
        transition:box-shadow .14s ease, transform .14s ease; }
      .eg-cover { position:absolute; inset:0; display:flex; flex-direction:column;
        justify-content:flex-end; padding:14px; }
      .eg-cover::before { content:''; position:absolute; inset:0;
        background:repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 2px, transparent 2px 4px);
        opacity:.5; pointer-events:none; }
      .eg-glint { position:absolute; top:0; left:0; right:0; height:42%;
        background:linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,0) 70%); pointer-events:none; }
      .eg-pix { position:absolute; top:12px; left:12px; width:26px; height:26px; opacity:.85; }
      .eg-pix svg { width:100%; height:100%; display:block; image-rendering:pixelated; }
      .eg-title { position:relative; font-family:var(--font-display); font-weight:700;
        font-size:20px; line-height:1.08; letter-spacing:.01em; color:#fff;
        text-shadow:0 2px 10px rgba(0,0,0,.55); overflow:hidden; display:-webkit-box;
        -webkit-line-clamp:3; -webkit-box-orient:vertical; }
      .eg-sys { position:relative; margin-top:8px; align-self:flex-start; font-family:var(--font-mono);
        font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:#06140f;
        background:var(--mint); border-radius:999px; padding:3px 9px; font-weight:600; }
      .eg-art { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
        opacity:0; transition:opacity .25s ease; background:#06120d; }
      .eg-art.show { opacity:1; }
      .eg-rom.row-sel { box-shadow:0 0 0 2px var(--mint), 0 14px 32px rgba(0,0,0,.5);
        transform:translateY(-3px) scale(1.02); }
      /* ---- detail sidebar (OpenEmu's right-hand info panel) ---- */
      .eg-side { flex:none; width:300px; display:flex; flex-direction:column; gap:14px; overflow:auto;
        border-left:1px solid var(--stroke); padding-left:22px; }
      .eg-bigcover { position:relative; width:100%; aspect-ratio:3 / 4; border-radius:16px; overflow:hidden;
        box-shadow:0 20px 46px rgba(0,0,0,.55); flex:none; }
      .eg-bigcover .eg-cover { padding:18px; }
      .eg-bigcover .eg-title { font-size:30px; -webkit-line-clamp:4; }
      .eg-bigcover .eg-pix { width:34px; height:34px; top:14px; left:14px; }
      .eg-side-t { font-family:var(--font-display); font-weight:700; font-size:23px; color:var(--ink); line-height:1.12; }
      .eg-tag { font-family:var(--font-mono); font-size:11.5px; letter-spacing:.12em; text-transform:uppercase;
        color:var(--mint); border:1px solid var(--stroke-strong); border-radius:999px; padding:3px 9px; align-self:flex-start; }
      .eg-side-meta { display:flex; flex-direction:column; }
      .eg-mrow { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0;
        border-bottom:1px solid var(--stroke); }
      .eg-mrow .k { font-family:var(--font-mono); font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); }
      .eg-mrow .v { font-family:var(--font-mono); font-size:13px; color:var(--ink); text-align:right; }
      .eg-mrow .v.mint { color:var(--mint); }
      .eg-play { margin-top:auto; font-family:var(--font-display); font-weight:600; font-size:18px; color:#062018;
        background:linear-gradient(120deg, var(--mint), var(--mint-2)); border:none; border-radius:14px;
        padding:15px; cursor: var(--c-hand); letter-spacing:.02em; }
      body:not(.idle) .eg-play:hover { filter:brightness(1.07); }
      .eg-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:10px; color:var(--ink-faint); font-family:var(--font-mono); font-size:13px; text-align:center;
        line-height:1.8; padding:30px; }
      .eg-empty code { color:var(--mint); font-size:13px; }
      /* game */
      .eg-stage { flex:1; min-height:0; width:100%; position:relative; }
      /* absolute-fill the positioned stage so the iframe has DEFINITE pixel
         dimensions — EmulatorJS measures its container and aborts if it's 0×0. */
      .eg-frame { position:absolute; inset:0; width:100%; height:100%; border:0; display:block; background:#071a14; }
      .eg-bar { flex:none; display:flex; align-items:center; justify-content:space-between;
        padding:8px 10px 0; font-family:var(--font-mono); font-size:12.5px; letter-spacing:.1em;
        text-transform:uppercase; color:var(--ink-faint); }
      .eg-bar b { color:var(--mint); font-weight:600; }
      .eg-back { background:transparent; border:1px solid var(--stroke); border-radius:999px;
        padding:6px 14px; color:var(--mint); font:inherit; font-size:12.5px; letter-spacing:.1em;
        text-transform:uppercase; cursor: var(--c-hand); }
      body:not(.idle) .eg-back:hover { border-color:var(--mint); }
      /* ---- Arcade screen (2026-10-07): blurred box-art backdrop, hero, cover shelf ---- */
      .ax { position:relative; height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden;
        border-radius:inherit; padding:34px 34px 26px; gap:26px; isolation:isolate; }
      .ax-bg { position:absolute; inset:-60px; z-index:-2; background-size:cover; background-position:center;
        filter:blur(42px) saturate(1.3); opacity:.55; transform:scale(1.1); }
      .ax-veil { position:absolute; inset:0; z-index:-1;
        background:linear-gradient(180deg, rgba(4,12,9,.25) 0%, rgba(4,12,9,.55) 55%, rgba(4,10,8,.92) 100%); }
      .ax-hero { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:26px; }
      .ax-cover { position:relative; overflow:hidden; border-radius:12px; background:#0a1712;
        box-shadow:0 22px 50px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); }
      .ax-cover .eg-cover { position:absolute; inset:0; }
      .ax-art { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .25s linear; }
      .ax-art.show { opacity:1; }
      .ax-cover.big { width:520px; aspect-ratio:512 / 364; border-radius:16px;
        -webkit-box-reflect: below 6px linear-gradient(transparent 72%, rgba(255,255,255,.14)); }
      .ax-info { display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; margin-top:34px; }
      .ax-sys { font-size:13px; font-weight:600; letter-spacing:.16em; text-transform:uppercase; color:var(--mint); }
      .ax-title { font-family:var(--font-display); font-size:52px; line-height:1; color:#fff; text-shadow:0 4px 24px rgba(0,0,0,.5); }
      .ax-meta { font-size:16px; color:var(--ink-soft); }
      .ax-play { margin-top:10px; display:inline-flex; align-items:center; gap:12px; border:none; cursor:var(--c-hand);
        font-family:var(--font); font-weight:600; font-size:20px; color:#04140e; background:var(--mint);
        border-radius:999px; padding:13px 26px 13px 22px; box-shadow:0 10px 30px rgba(116,247,176,.25); }
      .ax-play .tri { width:0; height:0; border-left:13px solid #04140e; border-top:8px solid transparent; border-bottom:8px solid transparent; }
      .ax-play kbd { font-family:var(--font); font-size:12px; font-weight:600; border:1.5px solid rgba(4,20,14,.4);
        border-radius:6px; padding:1px 6px; }
      .ax-hint { font-size:13px; color:var(--ink-faint); margin-top:4px; }
      .ax-lib { flex:none; }
      .ax-lib-h { display:flex; justify-content:space-between; font-size:13px; font-weight:600; letter-spacing:.14em;
        text-transform:uppercase; color:var(--ink-soft); margin-bottom:12px; }
      .ax-shelf { display:flex; gap:16px; overflow-x:auto; padding:6px 4px 10px; scrollbar-width:none; }
      .ax-tile { flex:none; width:150px; aspect-ratio:512 / 364; padding:0; border:none; background:none; cursor:var(--c-hand);
        border-radius:12px; opacity:.55; transition:opacity .15s linear; }
      .ax-tile .ax-cover { width:100%; height:100%; }
      .ax-tile.row-sel { opacity:1; }
      .ax-tile.row-sel .ax-cover { box-shadow:0 0 0 2px var(--mint), 0 14px 34px rgba(0,0,0,.6); }
      .card[data-wid="arcade"] { padding:0; }
      .card[data-wid="arcade"] .card-body { height:100%; }
    `);
    body.classList.add('eg');

    let mode = 'picker';   // 'picker' | 'game'
    let sel = 0;           // picker selection index
    let roms = [];
    let emuFrame = null;   // the EmulatorJS iframe (one per game)
    let cleanupTimers = []; // any timeouts we set (cleared on stop)

    // ---- HARD teardown: removing the iframe destroys EmulatorJS' document,
    // its globals, its WASM core AND its audio in one shot. This is why we run
    // the emulator in an iframe — EmulatorJS declares un-deletable global classes
    // (EJS_STORAGE) and Web Audio contexts we can't reliably reach from outside;
    // an iframe gives a fresh, fully-disposable world every boot.
    // ---- Arcade telemetry → POST /api/arcade-log once a second while a game runs.
    // Per second: emulated frames, drawn frames, worst draw gap, emulation stalls
    // (>50 ms without a new frame), audio state, JS heap, pad inputs seen.
    let tele = null;
    function startTelemetry(frame, rom) {
      stopTelemetry();
      const t = { frame, rom: rom.name, inputs: 0, stalls: [], draws: 0, worst: 0, lastDraw: 0, lastEmu: 0, pf: null, timers: [] };
      tele = t;
      const post = (o) => fetch('/api/arcade-log', { method: 'POST', body: JSON.stringify(o), keepalive: true }).catch(() => {});
      post({ ev: 'boot', rom: rom.name });
      t.timers.push(setInterval(() => { // 100 Hz emulation watcher
        const w = frame.contentWindow, gm = w && w.EJS_emulator && w.EJS_emulator.gameManager;
        if (!gm) return;
        let n; try { n = gm.getFrameNum(); } catch { return; }
        const now = performance.now();
        if (t.pf === null) { t.pf = n; t.f0 = n; t.lastEmu = now; return; }
        if (n !== t.pf) { const gap = now - t.lastEmu; if (gap > 50) t.stalls.push(Math.round(gap)); t.pf = n; t.lastEmu = now; }
      }, 10));
      const draw = (ts) => {
        if (tele !== t) return;
        if (t.lastDraw) { const g = ts - t.lastDraw; if (g > t.worst) t.worst = g; }
        t.lastDraw = ts; t.draws++;
        try { frame.contentWindow.requestAnimationFrame(draw); } catch { requestAnimationFrame(draw); }
      };
      setTimeout(() => { try { frame.contentWindow.requestAnimationFrame(draw); } catch { /* ignore */ } }, 500);
      t.timers.push(setInterval(() => { // 1 Hz report
        const w = frame.contentWindow, em = w && w.EJS_emulator;
        let audio = '?'; try { audio = em.Module.AL.currentCtx.audioCtx.state; } catch { /* not yet */ }
        const emuFrames = t.pf !== null && t.f1 !== undefined ? t.pf - t.f1 : null;
        post({ ev: 'sec', emu: emuFrames, draw: t.draws, worstDrawMs: Math.round(t.worst), stalls: t.stalls,
          audio, started: !!(em && em.started), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
          inputs: t.inputs, vis: document.visibilityState });
        t.f1 = t.pf; t.draws = 0; t.worst = 0; t.stalls = []; t.inputs = 0;
      }, 1000));
    }
    function stopTelemetry() {
      if (!tele) return;
      tele.timers.forEach(clearInterval);
      fetch('/api/arcade-log', { method: 'POST', body: JSON.stringify({ ev: 'end', rom: tele.rom }), keepalive: true }).catch(() => {});
      tele = null;
    }

    function teardownGame() {
      stopTelemetry();
      try { emuFrame?.remove(); } catch { /* ignore */ }
      emuFrame = null;
    }

    // ---- the controller/keyboard bridge stays set the WHOLE time the panel is
    // open. In the picker we navigate ourselves; in-game EmulatorJS reads the
    // pad natively so input() is a no-op. 'back' is handled by the parent.
    // In-game controller → keyboard BRIDGE. The browser Gamepad API isn't
    // reliably exposed to the emulator iframe on this kiosk (no gesture inside
    // it), so we drive the game through our proven evdev→SSE pad path by
    // synthesizing the keys EmulatorJS maps by default. Directions are held
    // (keyup refreshed by the stick's repeat); buttons are taps.
    const KEYMAP = { // action → [key, code, keyCode]
      up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40],
      left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
      fup: ['ArrowUp', 'ArrowUp', 38], fdown: ['ArrowDown', 'ArrowDown', 40],
      fleft: ['ArrowLeft', 'ArrowLeft', 37], fright: ['ArrowRight', 'ArrowRight', 39],
      ok: ['x', 'KeyX', 88],        // A button → NES A
      events: ['z', 'KeyZ', 90],    // B button → NES B
      palette: ['s', 'KeyS', 83],   // X
      hn: ['a', 'KeyA', 65],        // Y
      help: ['Enter', 'Enter', 13], // Start
      changelog: ['Shift', 'ShiftLeft', 16], // Select
      pageup: ['q', 'KeyQ', 81], pagedown: ['e', 'KeyE', 69], // L1/R1
    };
    const DIR = new Set(['up', 'down', 'left', 'right', 'fup', 'fdown', 'fleft', 'fright']);
    const heldKeys = new Map(); // code → keyup timeout
    function fire(type, k) {
      const win = emuFrame?.contentWindow, docu = emuFrame?.contentDocument;
      if (!win || !docu) return;
      // Dispatch to window, document AND the focused element — EmulatorJS attaches
      // its keydown listener to one of them and we don't know which; hitting all
      // three (each its own event instance) guarantees it registers.
      const targets = [win, docu, docu.activeElement, docu.body].filter(Boolean);
      for (const t of targets) {
        try { t.dispatchEvent(new win.KeyboardEvent(type, { key: k[0], code: k[1], keyCode: k[2], which: k[2], bubbles: true, cancelable: true })); } catch { /* ignore */ }
      }
    }
    function gameKey(action) {
      const k = KEYMAP[action];
      if (!k) return;
      const code = k[1];
      const prev = heldKeys.get(code);
      if (prev) clearTimeout(prev); else fire('keydown', k); // first press → keydown
      // hold direction longer (refreshed by stick repeat); tap buttons briefly
      heldKeys.set(code, setTimeout(() => { fire('keyup', k); heldKeys.delete(code); }, DIR.has(action) ? 240 : 90));
    }

    // SN30 Pro raw button index → EmulatorJS default RetroPad key (its
    // defaultControllers: A=z B=x X=a Y=s L=q R=e Select=v Start=enter). The
    // SN30 Pro face layout IS the SNES layout, so A→A, B→B, X→X, Y→Y.
    // L2 (8) stays "leave the game"; R2 (9) is unused in-game.
    // Input goes STRAIGHT into the core via EmulatorJS's gameManager.simulateInput
    // (player 0, RetroPad id, 1 = pressed / 0 = released) — no synthetic keyboard
    // events (EmulatorJS only listens for keys on its own player element, so keys
    // dispatched to window/document never arrived). RetroPad ids: B0 Y1 Select2
    // Start3 Up4 Down5 Left6 Right7 A8 X9 L10 R11.
    const RAWPAD = { 0: 8, 1: 0, 3: 9, 4: 1, 6: 10, 7: 11, 10: 2, 11: 3 }; // SN30 idx → RetroPad
    const DIRPAD = { u: 4, d: 5, l: 6, r: 7 };
    const axisDown = { x: null, y: null };
    const sysHeld = new Set();
    function pad(id, v) {
      try { emuFrame?.contentWindow?.EJS_emulator?.gameManager?.simulateInput(0, id, v); } catch { /* core not ready */ }
    }
    function rawInput(a) {
      if (mode !== 'game') return;
      if (tele) tele.inputs++;
      if (a[1] === 'b') {                       // jb<idx><d|u> — true press / release
        const bi = a.charCodeAt(2) - 97;
        if (bi === 10 || bi === 11) { if (a[3] === 'd') sysHeld.add(bi); else sysHeld.delete(bi);
          if (sysHeld.has(10) && sysHeld.has(11)) { sysHeld.clear(); showPicker(); return; } } // Select+Start → games
        const id = RAWPAD[bi];
        if (id != null) pad(id, a[3] === 'd' ? 1 : 0);
        return;
      }
      const ax = a[1], st = a[2];                // jx<l|c|r> / jy<u|c|d>
      if (axisDown[ax]) { pad(DIRPAD[axisDown[ax]], 0); axisDown[ax] = null; }
      if (st !== 'c') { pad(DIRPAD[st], 1); axisDown[ax] = st; }
    }

    window.__GARDEN_GAME = {
      raw: rawInput,
      inGame: () => mode === 'game',
      input(action) {
        if (mode === 'game') return; // in-game the raw press/release edges drive EmulatorJS
        if (!roms.length) return;
        const cols = gridCols();
        if (action === 'up' || action === 'fup') setSel(sel - cols);
        else if (action === 'down' || action === 'fdown') setSel(sel + cols);
        else if (action === 'left' || action === 'fleft') setSel(sel - 1);
        else if (action === 'right' || action === 'fright') setSel(sel + 1);
        else if (action === 'ok' || action === 'fopen') boot(roms[sel]);
      },
      stop() {
        document.body.classList.remove('arcade-full');
        for (const t of heldKeys.values()) clearTimeout(t);
        heldKeys.clear();
        teardownGame();
        window.removeEventListener('keydown', onKey, true);
        cleanupTimers.forEach(clearTimeout);
      },
    };

    function onKey(e) {
      if (mode === 'picker' && roms.length) {
        const k = (e.key || '').toLowerCase();
        const cols = gridCols();
        if (k === 'arrowup' || k === 'w') { setSel(sel - cols); e.preventDefault(); }
        else if (k === 'arrowdown' || k === 's') { setSel(sel + cols); e.preventDefault(); }
        else if (k === 'arrowleft' || k === 'a') { setSel(sel - 1); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { setSel(sel + 1); e.preventDefault(); }
        else if (k === 'enter' || k === ' ') { boot(roms[sel]); e.preventDefault(); }
      }
      // In-game keys are EmulatorJS's; we don't intercept them.
    }
    window.addEventListener('keydown', onKey, true);

    // ---- ROM PICKER ----------------------------------------------------------
    // Derive the real column count from the rendered grid (so up/down arithmetic
    // always lands on the right tile even if the layout/column count changes).
    // The library is a single horizontal shelf: every direction steps ±1.
    function gridCols() { return 1; }

    function setSel(i) {
      const btns = body.querySelectorAll('.eg-rom');
      if (!btns.length) return;
      sel = (i + btns.length) % btns.length;
      btns.forEach((b, k) => b.classList.toggle('row-sel', k === sel));
      btns[sel].scrollIntoView({ block: 'nearest', inline: 'center' });
      updateDetail();
    }

    // ---- play stats (localStorage): powers "Played N×" / "Last played" ----
    const STATS_KEY = 'garden.arcade.stats';
    const loadStats = () => { try { return JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch { return {}; } };
    const recordPlay = (rom) => {
      try { const s = loadStats(); const e = s[rom.file] || { plays: 0, last: 0 }; e.plays++; e.last = Date.now(); s[rom.file] = e; localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    };
    const agoStr = (ts) => {
      if (!ts) return 'Never';
      const d = Math.max(0, Date.now() - ts), day = 864e5;
      if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + 'm ago';
      if (d < day) return Math.round(d / 36e5) + 'h ago';
      if (d < 7 * day) return Math.round(d / day) + 'd ago';
      try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return 'a while ago'; }
    };

    // Build a cover's inner layers (gradient + glint + pixel motif + title + sys)
    // — reused for both the grid tiles and the big sidebar cover.
    function coverInner(rom) {
      return [
        h('div', { class: 'eg-glint' }),
        h('div', { class: 'eg-pix', html: pixelMotif(rom.name) }),
        h('div', { class: 'eg-title' }, rom.name.replace(/[-_]/g, ' ')),
        h('div', { class: 'eg-sys' }, SYS_LABEL[rom.system] || rom.system),
      ];
    }

    // Cover art: real box art from /api/rom-cover (libretro-thumbnails, cached on
    // the server); a generated cover (gradient + pixel motif + title) underneath
    // shows if there's none.
    const coverURL = (rom) => `/api/rom-cover?file=${encodeURIComponent(rom.file)}`;
    function coverEl(rom, cls) {
      const box = h('div', { class: `ax-cover ${cls || ''}` },
        h('div', { class: 'eg-cover', style: `background:${coverGradient(rom.name)}` }, ...coverInner(rom)));
      const img = h('img', { class: 'ax-art', alt: '' });
      img.onload = () => img.classList.add('show');
      img.src = coverURL(rom);
      box.appendChild(img);
      return box;
    }

    // Refresh the hero (backdrop, big cover, title, meta) for the selection.
    function updateDetail() {
      const rom = roms[sel];
      const hero = body.querySelector('.ax-hero');
      if (!rom || !hero) return;
      const st = loadStats()[rom.file] || { plays: 0, last: 0 };
      const bg = body.querySelector('.ax-bg');
      bg.style.backgroundImage = `url("${coverURL(rom)}")`;
      const title = rom.name.replace(/\s*\((Sample|Rev [^)]*|Beta[^)]*|Proto[^)]*)\)/gi, '').replace(/[-_]/g, ' ');
      hero.replaceChildren(
        coverEl(rom, 'big'),
        h('div', { class: 'ax-info' },
          h('div', { class: 'ax-sys' }, SYS_NAME[rom.system] || rom.system),
          h('div', { class: 'ax-title' }, title),
          h('div', { class: 'ax-meta' }, st.plays ? `Played ${st.plays}× · last ${agoStr(st.last)}` : 'Never played'),
          h('button', { class: 'ax-play', type: 'button', onclick: () => boot(roms[sel]) },
            h('span', { class: 'tri' }), 'Play', h('kbd', {}, 'A')),
          h('div', { class: 'ax-hint' }, 'In game: Select + Start back to games · L1 R1 L2 R2 back to GardenOS')));
    }

    async function showPicker() {
      document.body.classList.remove('arcade-full');
      mode = 'picker';
      teardownGame(); // if returning from a game, kill the previous core first
      try {
        const r = await fetch('/api/roms', { cache: 'no-store' });
        roms = (await r.json()).roms || [];
      } catch { roms = []; }

      if (!roms.length) {
        body.replaceChildren(h('div', { class: 'ax' },
          h('div', { class: 'eg-empty' },
            h('div', {}, 'No games yet.'),
            h('div', {}, 'Drop ROM files in ', h('code', {}, 'data/roms/'), ' on the wall machine.'))));
        return;
      }
      const shelf = h('div', { class: 'ax-shelf' },
        ...roms.map((rom, i) => h('button', {
          class: 'eg-rom ax-tile', type: 'button', 'data-psel': '1',
          onclick: () => (sel === i ? boot(rom) : setSel(i)),
        }, coverEl(rom))));
      body.replaceChildren(h('div', { class: 'ax' },
        h('div', { class: 'ax-bg' }), h('div', { class: 'ax-veil' }),
        h('div', { class: 'ax-hero' }),
        h('div', { class: 'ax-lib' },
          h('div', { class: 'ax-lib-h' }, h('span', {}, 'Library'), h('span', {}, `${roms.length} game${roms.length === 1 ? '' : 's'}`)),
          shelf)));
      sel = Math.min(sel, roms.length - 1); setSel(sel);
    }

    // ---- BOOT EmulatorJS for one ROM, inside its own IFRAME ------------------
    // The iframe gets a fresh document so EmulatorJS' global classes never
    // collide across boots, and `allow="gamepad"` lets the SN30 Pro reach the
    // emulator's Gamepad reader. Tearing it down = removing the iframe.
    function boot(rom) {
      if (!rom) return;
      const core = CORE[rom.system];
      if (!core) return;
      recordPlay(rom); // bump play count + last-played for the detail panel
      mode = 'game';
      document.body.classList.add('arcade-full'); // the game takes the whole screen
      teardownGame(); // remove any prior iframe

      const stage = h('div', { class: 'eg-stage' });
      const bar = h('div', { class: 'eg-bar' },
        h('button', { class: 'eg-back', type: 'button', onclick: showPicker }, '← Games'),
        h('span', {}, h('b', {}, 'L2 / Esc'), ' — back to game list'));
      body.replaceChildren(stage, bar);

      // Point the iframe at a REAL same-origin page (/emu-frame.html), NOT a
      // srcdoc. In a srcdoc iframe RetroArch can't read screen dimensions and
      // renders a black frame; a served page gives a proper document + base URL
      // so the WebGL canvas presents and the game is visible. The server emits
      // the EJS_* setup + loader and validates the rom/core params.
      const src = '/emu-frame.html?core=' + encodeURIComponent(core)
        + '&rom=' + encodeURIComponent(rom.file)
        + '&name=' + encodeURIComponent(rom.name);

      const frame = document.createElement('iframe');
      frame.className = 'eg-frame';
      frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
      frame.src = src;
      frame.onerror = () => stage.replaceChildren(
        h('div', { class: 'eg-empty' },
          h('div', {}, 'Could not reach the emulator.'),
          h('div', {}, 'Check the wall’s internet connection, then pick again.')));
      emuFrame = frame;
      stage.appendChild(frame);
      startTelemetry(frame, rom);

      // AUDIO GESTURE GATE: this boot() runs inside a REAL user gesture (the
      // picker click / controller OK), so the frame tree is activated. RetroArch
      // creates its Web Audio context a couple seconds into core init and its
      // main loop stalls (black screen, frozen) until that context is 'running'.
      // We post 'emu-kick' repeatedly for the first few seconds so the iframe
      // resumes whatever audio context appears. Cleared on teardown.
      for (let t = 0; t <= 6000; t += 400) {
        cleanupTimers.push(setTimeout(() => {
          try { frame.contentWindow?.postMessage('emu-kick', '*'); } catch { /* ignore */ }
          // Keyboard/gamepad only reach EmulatorJS when the iframe has focus —
          // the picker click left focus in the parent, so hand it to the game.
          try { frame.focus(); frame.contentWindow?.focus(); } catch { /* ignore */ }
        }, t));
      }
    }

    await showPicker();
  },
};
