// Arcade — a retro-console emulator. The dashboard card is a calm pixel tile
// ("click to play" + a count of ROMs found); openFull shows a ROM PICKER and
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
  size: 'md',
  chrome: true,

  // ---- dashboard card: a calm static tile (no animation, no EmulatorJS) -----
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .em { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center;
        justify-content:center; gap:12px; cursor:pointer; -webkit-tap-highlight-color:transparent; user-select:none; }
      .em-glyph { width:84px; height:64px; }
      .em-glyph svg { width:100%; height:100%; display:block; image-rendering:pixelated; }
      .em-hint { font-family:var(--font-mono); font-size:10px; letter-spacing:.12em;
        text-transform:uppercase; color:var(--ink-faint); text-align:center; line-height:1.7; }
      .em-hint b { color:var(--mint); font-weight:600; }
    `);
    // A pixel game-pad glyph drawn in the mint palette (inline SVG, no assets).
    const glyph = h('div', { class: 'em-glyph', html: `
      <svg viewBox="0 0 42 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
        <rect x="2" y="8"  width="38" height="18" rx="7" fill="none" stroke="#74f7b0" stroke-width="2"/>
        <!-- d-pad -->
        <rect x="9"  y="15" width="9" height="3" fill="#74f7b0"/>
        <rect x="12" y="12" width="3" height="9" fill="#74f7b0"/>
        <!-- buttons -->
        <circle cx="29" cy="14" r="2.2" fill="#43e6c6"/>
        <circle cx="34" cy="18" r="2.2" fill="#43e6c6"/>
      </svg>` });
    const hint = h('div', { class: 'em-hint' });
    hint.innerHTML = '<b>click to play</b> ▶<br>retro console';
    body.classList.add('em');
    body.replaceChildren(glyph, hint);

    // Cheap one-shot ROM count (no animation, no heavy work — smoke renders
    // the dashboard headless, so this must stay light and never throw).
    try {
      const r = await fetch('/api/roms', { cache: 'no-store' });
      const { roms = [] } = await r.json();
      hint.innerHTML = roms.length
        ? `<b>click to play</b> ▶<br>${roms.length} game${roms.length === 1 ? '' : 's'} ready`
        : '<b>click to play</b> ▶<br>drop ROMs to begin';
    } catch { /* offline / no endpoint — keep the default hint */ }
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
        font-family:var(--font-mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase;
        color:var(--ink-faint); padding:0 6px 12px; }
      .eg-pick-h b { color:var(--mint); font-weight:600; }
      .eg-cols { flex:1; min-height:0; display:flex; gap:22px; padding:0 6px 8px; }
      .eg-grid { flex:1; min-height:0; overflow:auto; display:grid;
        grid-template-columns:repeat(var(--eg-cols,2), 1fr); gap:18px; align-content:start; padding:3px; }
      /* a cover tile: a 3:4 portrait box-art card with a real drop shadow */
      .eg-rom { position:relative; aspect-ratio:3 / 4; display:block; text-align:left;
        background:transparent; border:none; border-radius:14px; padding:0;
        color:var(--ink); cursor:pointer; font:inherit; overflow:hidden; box-shadow:0 8px 22px rgba(0,0,0,.42);
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
        font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:#06140f;
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
      .eg-tag { font-family:var(--font-mono); font-size:9px; letter-spacing:.12em; text-transform:uppercase;
        color:var(--mint); border:1px solid var(--stroke-strong); border-radius:999px; padding:3px 9px; align-self:flex-start; }
      .eg-side-meta { display:flex; flex-direction:column; }
      .eg-mrow { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0;
        border-bottom:1px solid var(--stroke); }
      .eg-mrow .k { font-family:var(--font-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint); }
      .eg-mrow .v { font-family:var(--font-mono); font-size:13px; color:var(--ink); text-align:right; }
      .eg-mrow .v.mint { color:var(--mint); }
      .eg-play { margin-top:auto; font-family:var(--font-display); font-weight:600; font-size:18px; color:#062018;
        background:linear-gradient(120deg, var(--mint), var(--mint-2)); border:none; border-radius:14px;
        padding:15px; cursor:pointer; letter-spacing:.02em; }
      .eg-play:hover { filter:brightness(1.07); }
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
        padding:8px 10px 0; font-family:var(--font-mono); font-size:11px; letter-spacing:.1em;
        text-transform:uppercase; color:var(--ink-faint); }
      .eg-bar b { color:var(--mint); font-weight:600; }
      .eg-back { background:transparent; border:1px solid var(--stroke); border-radius:999px;
        padding:6px 14px; color:var(--mint); font:inherit; font-size:11px; letter-spacing:.1em;
        text-transform:uppercase; cursor:pointer; }
      .eg-back:hover { border-color:var(--mint); }
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
    function teardownGame() {
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

    window.__GARDEN_GAME = {
      input(action) {
        if (mode === 'game') { gameKey(action); return; } // drive the emulator
        if (!roms.length) return;
        const cols = gridCols();
        if (action === 'up' || action === 'fup') setSel(sel - cols);
        else if (action === 'down' || action === 'fdown') setSel(sel + cols);
        else if (action === 'left' || action === 'fleft') setSel(sel - 1);
        else if (action === 'right' || action === 'fright') setSel(sel + 1);
        else if (action === 'ok' || action === 'fopen') boot(roms[sel]);
      },
      stop() {
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
    const PREF_COLS = 2; // covers per row beside the detail sidebar (CSS --eg-cols)
    function gridCols() {
      const grid = body.querySelector('.eg-grid');
      if (!grid) return PREF_COLS;
      const cs = getComputedStyle(grid).gridTemplateColumns;
      const n = cs ? cs.split(' ').filter(Boolean).length : 0;
      return n > 0 ? n : PREF_COLS;
    }

    function setSel(i) {
      const btns = body.querySelectorAll('.eg-rom');
      if (!btns.length) return;
      sel = (i + btns.length) % btns.length;
      btns.forEach((b, k) => b.classList.toggle('row-sel', k === sel));
      btns[sel].scrollIntoView({ block: 'nearest' });
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

    // Refresh the DETAIL SIDEBAR (big cover + metadata + play stats) for the
    // selection, and best-effort reveal real boxart over the generated cover.
    let prevReq = 0;
    function updateDetail() {
      const rom = roms[sel];
      if (!rom) return;
      const big = body.querySelector('.eg-bigcover');
      const titleEl = body.querySelector('.eg-side-t');
      const metaEl = body.querySelector('.eg-side-meta');
      if (!big || !titleEl || !metaEl) return;

      big.replaceChildren(h('div', { class: 'eg-cover', style: `background:${coverGradient(rom.name)}` }, ...coverInner(rom)));
      titleEl.textContent = rom.name.replace(/[-_]/g, ' ');

      const ext = (rom.file.match(/\.[^.]+$/) || [''])[0].replace('.', '').toLowerCase();
      const size = fmtSize(rom.sizeBytes);
      const st = loadStats()[rom.file] || { plays: 0, last: 0 };
      const row = (k, v, mint) => h('div', { class: 'eg-mrow' },
        h('span', { class: 'k' }, k), h('span', { class: 'v' + (mint ? ' mint' : '') }, v));
      metaEl.replaceChildren(
        row('System', SYS_NAME[rom.system] || rom.system),
        row('Format', '.' + ext),
        ...(size ? [row('Size', size)] : []),
        row('Played', st.plays ? `${st.plays}×` : 'Never', !!st.plays),
        row('Last played', agoStr(st.last)),
      );

      // progressive enhancement: overlay real boxart on the big cover if libretro has it.
      const token = ++prevReq;
      const url = boxartURL(rom);
      if (url) {
        const img = new Image();
        img.onload = () => { if (token === prevReq) { const a = h('img', { class: 'eg-art show', src: img.src, alt: '' }); big.appendChild(a); } };
        img.src = url;
      }
    }

    async function showPicker() {
      mode = 'picker';
      teardownGame(); // if returning from a game, kill the previous core first
      body.replaceChildren(h('div', { class: 'eg-pick' },
        h('div', { class: 'eg-pick-h' }, 'loading games…')));
      try {
        const r = await fetch('/api/roms', { cache: 'no-store' });
        roms = (await r.json()).roms || [];
      } catch { roms = []; }

      if (!roms.length) {
        body.replaceChildren(h('div', { class: 'eg-pick' },
          h('div', { class: 'eg-empty' },
            h('div', {}, 'No games yet.'),
            h('div', {}, 'Drop ROM files in ', h('code', {}, 'data/roms/'), ' on the wall machine.'),
            h('div', {}, '.nes · .smc/.sfc · .gb/.gbc · .gba · .n64/.z64 · .md · .sms · .pce'))));
        return;
      }

      // Left: a grid of 3:4 cover tiles. Click === boot, hover === select.
      const grid = h('div', { class: 'eg-grid' },
        ...roms.map((rom, i) => {
          const tile = h('button', {
            class: 'eg-rom', type: 'button', 'data-psel': '1', title: rom.name,
            onclick: () => boot(rom),
            onmouseover: () => setSel(i),
          }, h('div', { class: 'eg-cover', style: `background:${coverGradient(rom.name)}` }, ...coverInner(rom)));
          const url = boxartURL(rom);
          if (url) { // reveal real boxart over the generated cover if it exists
            const art = h('img', { class: 'eg-art', alt: '', loading: 'lazy' });
            art.onload = () => art.classList.add('show');
            art.src = url;
            tile.appendChild(art);
          }
          return tile;
        }));

      // Right: the OpenEmu-style detail sidebar (filled by updateDetail()).
      const side = h('div', { class: 'eg-side' },
        h('div', { class: 'eg-bigcover' }),
        h('div', { class: 'eg-side-t' }, ''),
        h('div', { class: 'eg-tag' }, 'Homebrew'),
        h('div', { class: 'eg-side-meta' }),
        h('button', { class: 'eg-play', type: 'button', onclick: () => boot(roms[sel]) }, '▶  Play'));

      body.replaceChildren(h('div', { class: 'eg-pick' },
        h('div', { class: 'eg-pick-h' },
          h('span', { html: `<b>${roms.length}</b> game${roms.length === 1 ? '' : 's'} in the library` }),
          h('span', {}, 'A / Enter · play')),
        h('div', { class: 'eg-cols' }, grid, side)));
      sel = 0; setSel(0);
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
