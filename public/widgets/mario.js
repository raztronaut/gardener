// Super Mario — a tiny pixel-art Mario standing on a grassy ground line. Tap him
// and he eats the mushroom: he GROWS from small to Super (and back on the next
// tap). Pure offline whimsy — no network, no perpetual animation. The growth is a
// single transform transition (layout-free, so it can never clip the card), and it
// settles immediately so the kiosk returns to 0% CPU.
export default {
  id: 'mario',
  title: 'Super Mario',
  icon: '🍄',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    const { h } = ctx;

    // 13×16 pixel sprite. '.' = transparent.
    const MAP = [
      '.....CCCCC...',
      '....CCCCCCCC.',
      '....HHHSSHS..',
      '...HSHSSSHSSS',
      '...HSHHSSSHSS',
      '...HHSSSSHHH.',
      '.....SSSS....',
      '...CCCYCCC...',
      '..CCCCYCCCC..',
      '.CCCCCYCCCCC.',
      'SSCCOOOOOCCSS',
      'SSOOOYOYOOOSS',
      'SSOOOOOOOOOSS',
      '..OOOO.OOOO..',
      '.HHHH...HHHH.',
      'HHHHH...HHHHH',
    ];
    const COLORS = { C: '#e23b2e', S: '#f6b27a', H: '#5a3210', O: '#2b54d4', Y: '#ffd23d' };

    let rects = '';
    for (let y = 0; y < MAP.length; y++) {
      const row = MAP[y];
      for (let x = 0; x < row.length; x++) {
        const c = COLORS[row[x]];
        if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
      }
    }
    const svg = `<svg viewBox="0 0 13 16" width="13" height="16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;

    ctx.style(`
      .mw { flex:1; min-height:0; display:flex; flex-direction:column; align-items:stretch; gap:0; }
      .mw-scene { position:relative; flex:1; min-height:0; overflow:hidden;
        display:flex; align-items:flex-end; justify-content:center; cursor:pointer;
        -webkit-tap-highlight-color:transparent; user-select:none; }
      /* sky cues — static, free to render */
      .mw-cloud { position:absolute; top:14px; width:34px; height:11px; border-radius:999px;
        background:rgba(255,255,255,.16); }
      .mw-cloud.a { left:14px; } .mw-cloud.b { right:18px; top:30px; width:24px; }
      .mw-block { position:absolute; top:8px; right:14px; width:22px; height:22px; z-index:2;
        background:linear-gradient(#f5b53d,#d98a1d); border:2px solid #7a4a12; border-radius:5px;
        color:#7a4a12; font-family:var(--font-display); font-weight:700; font-size:15px;
        display:flex; align-items:center; justify-content:center; line-height:1; }
      .mw-sprite { position:relative; z-index:3; width:40px; margin-bottom:16px;
        transform-origin:bottom center; transform:scale(1);
        transition:transform .55s cubic-bezier(.34,1.56,.64,1); }
      .mw-sprite svg { width:100%; height:auto; display:block; image-rendering:pixelated; }
      .mw-sprite.big { transform:scale(1.85); }
      .mw-ground { position:absolute; left:0; right:0; bottom:0; height:16px; z-index:1;
        background:linear-gradient(#3f8f3a,#2c5e22); border-top:3px solid #74f7b0; }
      .mw-hint { flex:none; text-align:center; padding-top:7px;
        font-family:var(--font-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase;
        color:var(--ink-faint); }
      .mw-hint b { color:var(--mint); font-weight:600; }
    `);

    const sprite = h('div', { class: 'mw-sprite', html: svg });
    const hint = h('div', { class: 'mw-hint' });
    const scene = h('div', { class: 'mw-scene' },
      h('div', { class: 'mw-cloud a' }),
      h('div', { class: 'mw-cloud b' }),
      h('div', { class: 'mw-block' }, '?'),
      sprite,
      h('div', { class: 'mw-ground' }),
    );

    hint.innerHTML = '<b>click to play</b> ▶';
    body.classList.add('mw');
    body.replaceChildren(scene, hint);
    // (clicking the card opens openFull below — the real game)
  },

  // Fullscreen, genuinely playable side-scroller. Keyboard (← → / A D move,
  // Space / ↑ / W jump, Esc exits) and controller (d-pad or stick to move, any
  // face button to jump, L2 exits) — while open it registers window.__GARDEN_GAME
  // so the pad bridge routes ALL input here except Back.
  async openFull(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .mg { position:relative; width:100%; height:calc(100vh - 150px); min-height:380px;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
      .mg canvas { width:100%; height:100%; display:block; border:1px solid var(--stroke);
        border-radius:14px; background:#5c94fc; image-rendering:pixelated; }
      .mg-hint { flex:none; font-family:var(--font-mono); font-size:11px; letter-spacing:.1em;
        text-transform:uppercase; color:var(--ink-faint); }
      .mg-hint b { color:var(--mint); font-weight:600; }
    `);
    const cv = h('canvas', { width: 800, height: 450 });
    const hint = h('div', { class: 'mg-hint' },
      'move ← → · jump SPACE / A · exit ESC / L2');
    body.classList.add('mg');
    body.replaceChildren(cv, hint);
    const cx = cv.getContext('2d');

    // ----- level: ground with gaps, blocks, pipes, coins, goombas, a flag -----
    const T = 32; // tile size (world units)
    const GROUND_Y = 12 * T; // ground top in world space
    const platforms = []; // {x,y,w,h}
    const addGround = (tx, tw) => platforms.push({ x: tx * T, y: GROUND_Y, w: tw * T, h: 4 * T });
    addGround(0, 18); addGround(20, 9); addGround(31, 14); addGround(47, 20);
    // floating brick rows + pipes (also platforms)
    const bricks = [];
    const brickRow = (tx, ty, n) => { for (let i = 0; i < n; i++) { const b = { x: (tx + i) * T, y: ty * T, w: T, h: T }; bricks.push(b); platforms.push(b); } };
    brickRow(6, 8, 3); brickRow(13, 6, 4); brickRow(35, 7, 3); brickRow(52, 8, 4);
    const pipes = [];
    const addPipe = (tx, th) => { const p = { x: tx * T, y: GROUND_Y - th * T, w: 2 * T, h: th * T }; pipes.push(p); platforms.push(p); };
    addPipe(16, 2); addPipe(43, 3);
    const coins = [];
    const addCoin = (tx, ty) => coins.push({ x: tx * T + 8, y: ty * T + 4, got: false });
    [[6, 6], [7, 6], [8, 6], [13, 4], [14, 4], [24, 9], [25, 9], [36, 5], [52, 6], [53, 6]].forEach(([a, b]) => addCoin(a, b));
    const goombas = [];
    const addGoomba = (tx) => goombas.push({ x: tx * T, y: GROUND_Y - T, w: T, h: T, vx: -0.7, alive: true });
    [10, 23, 38, 50, 55].forEach(addGoomba);
    const FLAG_X = 64 * T;
    const WORLD_W = 68 * T;

    // ----- state -----
    const start = () => ({ x: 1.5 * T, y: GROUND_Y - 2 * T, vx: 0, vy: 0, onGround: false, big: false, face: 1, dead: 0 });
    let m = start();
    let cam = 0, coinScore = 0, won = false, raf = 0;
    const keys = { left: false, right: false, jump: false };
    let padDir = 0, padDirT = 0; // controller hold (refreshed by repeat events)

    // ----- input -----
    const JUMP = () => { if (m.onGround && !won && !m.dead) { m.vy = -12.4; m.onGround = false; } };
    const onKey = (down) => (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') { keys.left = down; e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { keys.right = down; e.preventDefault(); }
      else if (k === ' ' || k === 'arrowup' || k === 'w') { if (down) JUMP(); e.preventDefault(); }
      else if (k === 'enter' && down && (won || m.dead)) reset();
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener('keydown', kd, true);
    window.addEventListener('keyup', ku, true);
    // Controller: directional actions arrive repeatedly while held; refresh a
    // short timeout so movement persists, then lapses on release. Any non-
    // directional action is a jump. (Back is handled by wirePad before us.)
    function padInput(action) {
      if (action === 'left' || action === 'fleft') { padDir = -1; padDirT = performance.now(); }
      else if (action === 'right' || action === 'fright') { padDir = 1; padDirT = performance.now(); }
      else if (action === 'down' || action === 'fdown' || action === 'fup') { /* ignore vertical */ }
      else { JUMP(); if ((won || m.dead)) reset(); } // up/ok/any face button = jump
    }
    window.__GARDEN_GAME = { input: padInput, stop: () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); } };
    function reset() { m = start(); cam = 0; coinScore = 0; won = false; goombas.forEach((g) => { g.alive = true; }); coins.forEach((c) => { c.got = false; }); }

    // ----- physics helpers -----
    const hit = (ax, ay, aw, ah, b) => ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;

    function step() {
      // controller hold lapses ~260ms after the last repeat event
      if (padDir && performance.now() - padDirT > 260) padDir = 0;
      const left = keys.left || padDir < 0, right = keys.right || padDir > 0;
      if (!won && !m.dead) {
        const acc = 0.6, max = 4.2;
        if (left) { m.vx -= acc; m.face = -1; }
        if (right) { m.vx += acc; m.face = 1; }
        if (!left && !right) m.vx *= 0.8;
        m.vx = Math.max(-max, Math.min(max, m.vx));
        m.vy = Math.min(m.vy + 0.62, 16); // gravity

        // horizontal move + collide
        m.x += m.vx;
        const mw = T - 6, mh = m.big ? 2 * T : T - 2;
        for (const p of platforms) {
          if (hit(m.x, m.y, mw, mh, p)) {
            if (m.vx > 0) m.x = p.x - mw; else if (m.vx < 0) m.x = p.x + p.w;
            m.vx = 0;
          }
        }
        // vertical move + collide
        m.y += m.vy; m.onGround = false;
        for (const p of platforms) {
          if (hit(m.x, m.y, mw, mh, p)) {
            if (m.vy > 0) { m.y = p.y - mh; m.onGround = true; } else if (m.vy < 0) { m.y = p.y + p.h; }
            m.vy = 0;
          }
        }
        m.x = Math.max(0, Math.min(WORLD_W - mw, m.x));
        if (m.y > 16 * T) m.dead = 1; // fell in a gap

        // coins
        for (const c of coins) if (!c.got && hit(m.x, m.y, mw, mh, { x: c.x, y: c.y, w: 16, h: 24 })) { c.got = true; coinScore++; }
        // goombas
        for (const g of goombas) {
          if (!g.alive) continue;
          g.x += g.vx;
          if (g.x <= 0 || g.x + g.w >= WORLD_W) g.vx = -g.vx; // turn at world bounds
          if (m.dead) continue;
          if (hit(m.x, m.y, mw, mh, g)) {
            if (m.vy > 0 && m.y + mh - m.vy <= g.y + 8) { g.alive = false; m.vy = -8; } // stomp
            else m.dead = 1; // hit from the side
          }
        }
        if (m.x + mw >= FLAG_X) won = true;
        if (m.dead) m.dead = 1;
      } else if (m.dead) {
        m.vy = Math.min(m.vy + 0.62, 16); m.y += m.vy; // little death fall
      }

      // camera follows
      const target = Math.max(0, Math.min(WORLD_W - 800 / 1, m.x - 800 / 2.5));
      cam += (target - cam) * 0.12;
      draw();
      raf = requestAnimationFrame(step);
    }

    // ----- render -----
    const W = cv.width, H = cv.height, SC = H / (16 * T); // scale world→canvas (fit height)
    function draw() {
      cx.clearRect(0, 0, W, H);
      // sky
      cx.fillStyle = '#5c94fc'; cx.fillRect(0, 0, W, H);
      // clouds (parallax)
      cx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 6; i++) { const cxp = ((i * 360 - cam * 0.4) % (W + 200)) - 100; cx.beginPath(); cx.ellipse(cxp, 70 + (i % 2) * 36, 42, 18, 0, 0, 7); cx.fill(); }
      const sx = (wx) => (wx - cam) * SC;
      // platforms / ground
      for (const p of platforms) {
        const isBrick = bricks.includes(p), isPipe = pipes.includes(p);
        cx.fillStyle = isPipe ? '#2fa64b' : isBrick ? '#c2571a' : '#8b5a2b';
        cx.fillRect(sx(p.x), p.y * SC, p.w * SC, p.h * SC);
        if (!isBrick && !isPipe) { cx.fillStyle = '#54b04a'; cx.fillRect(sx(p.x), p.y * SC, p.w * SC, 6); }
        if (isPipe) { cx.fillStyle = '#1d7a35'; cx.fillRect(sx(p.x), p.y * SC, p.w * SC, 8); }
      }
      // coins
      for (const c of coins) if (!c.got) { cx.fillStyle = '#ffd23d'; cx.beginPath(); cx.arc(sx(c.x) + 8, c.y * SC + 12, 7 * SC * 0.6 + 4, 0, 7); cx.fill(); cx.strokeStyle = '#b8860b'; cx.stroke(); }
      // flag
      cx.fillStyle = '#eee'; cx.fillRect(sx(FLAG_X), (GROUND_Y - 8 * T) * SC, 3, 8 * T * SC);
      cx.fillStyle = '#74f7b0'; cx.beginPath(); cx.moveTo(sx(FLAG_X) + 3, (GROUND_Y - 8 * T) * SC); cx.lineTo(sx(FLAG_X) + 44, (GROUND_Y - 7.4 * T) * SC); cx.lineTo(sx(FLAG_X) + 3, (GROUND_Y - 6.8 * T) * SC); cx.fill();
      // goombas
      for (const g of goombas) if (g.alive) { cx.fillStyle = '#7a3b10'; cx.fillRect(sx(g.x), g.y * SC, g.w * SC, g.h * SC); cx.fillStyle = '#fff'; cx.fillRect(sx(g.x) + 5, g.y * SC + 7, 5, 5); cx.fillRect(sx(g.x) + g.w * SC - 10, g.y * SC + 7, 5, 5); }
      // mario
      const mw = T - 6, mh = m.big ? 2 * T : T - 2;
      const mx = sx(m.x), my = m.y * SC;
      cx.fillStyle = m.dead ? '#999' : '#e23b2e'; cx.fillRect(mx, my, mw * SC, mh * SC * 0.42); // cap/torso
      cx.fillStyle = m.dead ? '#bbb' : '#2b54d4'; cx.fillRect(mx, my + mh * SC * 0.42, mw * SC, mh * SC * 0.58); // overalls
      cx.fillStyle = '#f6b27a'; cx.fillRect(mx + (m.face > 0 ? mw * SC - 7 : 2), my + 6, 5, 5); // face hint
      // HUD
      cx.fillStyle = '#fff'; cx.font = 'bold 20px "Space Grotesk", sans-serif'; cx.textBaseline = 'top';
      cx.fillText('COINS ' + coinScore, 16, 14);
      if (won) banner('YOU WIN!  ·  press jump to replay');
      else if (m.dead) banner('GAME OVER  ·  press jump to retry');
    }
    function banner(text) {
      cx.fillStyle = 'rgba(4,17,13,.72)'; cx.fillRect(0, H / 2 - 34, W, 68);
      cx.fillStyle = '#74f7b0'; cx.font = 'bold 28px "Space Grotesk", sans-serif';
      cx.textAlign = 'center'; cx.fillText(text, W / 2, H / 2 - 14); cx.textAlign = 'left';
    }
    raf = requestAnimationFrame(step);
  },
};
