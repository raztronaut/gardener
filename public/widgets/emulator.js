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

const EJS_DATA = 'https://cdn.emulatorjs.org/stable/data/';
// EmulatorJS core ids keyed by the system our server infers from the extension.
const CORE = {
  nes: 'nes', snes: 'snes', gb: 'gb', gbc: 'gb', gba: 'gba',
  n64: 'n64', segaMD: 'segaMD', segaMS: 'segaMS', pce: 'pce',
};
const SYS_LABEL = {
  nes: 'NES', snes: 'SNES', gb: 'GAME BOY', gbc: 'GBC', gba: 'GBA',
  n64: 'N64', segaMD: 'GENESIS', segaMS: 'SMS', pce: 'PC ENGINE',
};

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
      .eg { position:relative; width:100%; height:calc(100vh - 150px); min-height:380px;
        display:flex; flex-direction:column; }
      /* picker */
      .eg-pick { flex:1; min-height:0; display:flex; flex-direction:column; padding:6px 4px 0; }
      .eg-pick-h { flex:none; font-family:var(--font-mono); font-size:11px; letter-spacing:.18em;
        text-transform:uppercase; color:var(--ink-faint); padding:0 6px 10px; }
      .eg-grid { flex:1; min-height:0; overflow:auto; display:grid; grid-template-columns:1fr 1fr;
        gap:10px; padding:0 6px 6px; align-content:start; }
      .eg-rom { display:flex; align-items:center; justify-content:space-between; gap:10px;
        text-align:left; background:transparent; border:1px solid var(--stroke); border-radius:14px;
        padding:14px 16px; color:var(--ink); cursor:pointer; font:inherit;
        transition:border-color .12s ease, box-shadow .12s ease; }
      .eg-rom .eg-name { font-family:var(--font-mono); font-size:15px; overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; }
      .eg-rom .eg-sys { flex:none; font-family:var(--font-mono); font-size:10px; letter-spacing:.12em;
        color:var(--mint); border:1px solid var(--stroke-strong); border-radius:999px; padding:3px 9px; }
      .eg-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:10px; color:var(--ink-faint); font-family:var(--font-mono); font-size:13px; text-align:center;
        line-height:1.8; padding:30px; }
      .eg-empty code { color:var(--mint); font-size:13px; }
      /* game */
      .eg-stage { flex:1; min-height:0; width:100%; position:relative; }
      .eg-stage #game { width:100%; height:100%; }
      .eg-stage #game canvas { image-rendering:pixelated; }
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
    let injected = null;   // the EmulatorJS loader <script> we added
    let cleanupTimers = []; // any timeouts we set (cleared on stop)

    // Track every AudioContext the page opens while a game is up, so teardown can
    // GUARANTEE silence — EmulatorJS cores create their audio via Web Audio and
    // don't always expose a handle we can reach. We wrap the constructor once and
    // restore it on stop(). This is the load-bearing "kill the audio" mechanism.
    const liveAudio = new Set();
    const OrigAC = window.AudioContext || window.webkitAudioContext;
    function patchAudio() {
      if (!OrigAC || window.AudioContext?.__emuPatched) return;
      const Wrapped = function (...a) { const ac = new OrigAC(...a); try { liveAudio.add(ac); } catch {} return ac; };
      Wrapped.prototype = OrigAC.prototype;
      Wrapped.__emuPatched = true;
      try { window.AudioContext = Wrapped; if (window.webkitAudioContext) window.webkitAudioContext = Wrapped; } catch {}
    }
    function restoreAudio() { try { if (OrigAC) { window.AudioContext = OrigAC; window.webkitAudioContext = OrigAC; } } catch {} }
    function killAudio() {
      for (const ac of liveAudio) { try { ac.suspend?.(); } catch {} try { ac.close?.(); } catch {} }
      liveAudio.clear();
    }

    // ---- HARD teardown: kill EmulatorJS + its audio so closing the panel is
    // silent. The parent calls this via __GARDEN_GAME.stop() when L2/Esc fires.
    function teardownGame() {
      try { window.EJS_emulator?.callEvent?.('exit'); } catch { /* ignore */ }
      // Pause/close every emulator audio surface we can reach.
      try { window.EJS_emulator?.pause?.(); } catch { /* ignore */ }
      try { window.EJS_emulator?.elements?.parent && (window.EJS_emulator.elements.parent.innerHTML = ''); } catch { /* ignore */ }
      try { window.EJS_emulator?.gameManager?.Module?.AL?.currentCtx?.sources?.forEach?.((s) => { try { s.stop(); } catch {} }); } catch { /* ignore */ }
      // Suspend/close any Web Audio context the core opened (belt + suspenders —
      // this is what silences SNES/GBA audio that otherwise keeps playing).
      try {
        const ctxs = [window.EJS_emulator?.Module?.SDL2?.audioContext,
          window.EJS_emulator?.gameManager?.Module?.SDL2?.audioContext];
        for (const ac of ctxs) { try { ac?.suspend?.(); ac?.close?.(); } catch {} }
      } catch { /* ignore */ }
      // GUARANTEED audio kill: suspend+close every AudioContext opened since boot.
      killAudio();
      // Remove the EmulatorJS DOM (its #game contents AND any .ejs_* nodes it may
      // have appended) + the injected loader, then delete its globals so a re-pick
      // boots a fresh instance.
      const stage = body.querySelector('#game');
      if (stage) stage.innerHTML = '';
      try { body.querySelectorAll('[class*="ejs_"]').forEach((el) => el.remove()); } catch { /* ignore */ }
      try { injected?.remove?.(); } catch { /* ignore */ }
      injected = null;
      for (const k of Object.keys(window)) {
        if (k === 'EJS_emulator' || k.startsWith('EJS_')) { try { delete window[k]; } catch { window[k] = undefined; } }
      }
    }

    // ---- the controller/keyboard bridge stays set the WHOLE time the panel is
    // open. In the picker we navigate ourselves; in-game EmulatorJS reads the
    // pad natively so input() is a no-op. 'back' is handled by the parent.
    window.__GARDEN_GAME = {
      input(action) {
        if (mode !== 'picker' || !roms.length) return; // in-game: EmulatorJS owns the pad
        const cols = 2;
        if (action === 'up' || action === 'fup') setSel(sel - cols);
        else if (action === 'down' || action === 'fdown') setSel(sel + cols);
        else if (action === 'left' || action === 'fleft') setSel(sel - 1);
        else if (action === 'right' || action === 'fright') setSel(sel + 1);
        else if (action === 'ok' || action === 'fopen') boot(roms[sel]);
      },
      stop() {
        teardownGame();
        restoreAudio();
        window.removeEventListener('keydown', onKey, true);
        cleanupTimers.forEach(clearTimeout);
      },
    };

    function onKey(e) {
      if (mode === 'picker' && roms.length) {
        const k = (e.key || '').toLowerCase();
        const cols = 2;
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
    function setSel(i) {
      const btns = body.querySelectorAll('.eg-rom');
      if (!btns.length) return;
      sel = (i + btns.length) % btns.length;
      btns.forEach((b, k) => b.classList.toggle('row-sel', k === sel));
      btns[sel].scrollIntoView({ block: 'nearest' });
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

      // Each ROM is a .eg-rom button with data-psel for parity with the rest of
      // the UI; click === boot (mouse and controller share one path).
      const grid = h('div', { class: 'eg-grid' },
        ...roms.map((rom, i) => h('button', {
          class: 'eg-rom', type: 'button', 'data-psel': '1',
          onclick: () => boot(rom),
          onmouseover: () => setSel(i),
        },
          h('span', { class: 'eg-name', title: rom.name }, rom.name),
          h('span', { class: 'eg-sys' }, SYS_LABEL[rom.system] || rom.system))));
      body.replaceChildren(h('div', { class: 'eg-pick' },
        h('div', { class: 'eg-pick-h' }, `${roms.length} game${roms.length === 1 ? '' : 's'} · pick one to play`),
        grid));
      sel = 0; setSel(0);
    }

    // ---- BOOT EmulatorJS for one ROM -----------------------------------------
    function boot(rom) {
      if (!rom) return;
      const core = CORE[rom.system];
      if (!core) return;
      mode = 'game';
      teardownGame(); // clear any prior instance + globals
      patchAudio();   // track AudioContexts the core opens, so stop() can kill them

      const stage = h('div', { class: 'eg-stage' }, h('div', { id: 'game' }));
      const bar = h('div', { class: 'eg-bar' },
        h('button', { class: 'eg-back', type: 'button', onclick: showPicker }, '← Games'),
        h('span', {}, h('b', {}, 'L2 / Esc'), ' — back to game list'));
      body.replaceChildren(stage, bar);

      // Globals MUST be set before loader.js runs (EmulatorJS reads them on load).
      window.EJS_player = '#game';
      window.EJS_pathtodata = EJS_DATA;
      window.EJS_core = core;
      window.EJS_gameUrl = '/roms/' + encodeURIComponent(rom.file);
      window.EJS_gameName = rom.name;
      window.EJS_startOnLoaded = true;
      window.EJS_color = '#74f7b0'; // mint — matches the wall
      window.EJS_backgroundColor = '#071a14';

      const s = document.createElement('script');
      s.src = EJS_DATA + 'loader.js';
      s.async = true;
      s.onerror = () => {
        const st = body.querySelector('#game');
        if (st) st.innerHTML = '';
        body.querySelector('.eg-stage')?.replaceChildren(
          h('div', { class: 'eg-empty' },
            h('div', {}, 'Could not reach the emulator.'),
            h('div', {}, 'Check the wall’s internet connection, then pick again.')));
      };
      injected = s;
      document.body.appendChild(s);
    }

    await showPicker();
  },
};
