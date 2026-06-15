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

export default {
  id: 'emulator',
  title: 'Arcade',
  icon: '🕹',
  size: 'lg',
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
        const cols = 2;
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

    // ---- BOOT EmulatorJS for one ROM, inside its own IFRAME ------------------
    // The iframe gets a fresh document so EmulatorJS' global classes never
    // collide across boots, and `allow="gamepad"` lets the SN30 Pro reach the
    // emulator's Gamepad reader. Tearing it down = removing the iframe.
    function boot(rom) {
      if (!rom) return;
      const core = CORE[rom.system];
      if (!core) return;
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
