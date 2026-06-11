// Super Mario — World 1-1. The dashboard card shows an authentic-style static
// SMB scene ("click to play"); openFull is a faithful, smooth recreation of the
// original NES World 1-1: sub-pixel integer-ish physics, the famous variable
// jump (hold = higher, run = farther), skid/turnaround friction, hand-authored
// pixel-art sprites in the SMB palette (no ripped Nintendo assets), and the real
// 1-1 layout (first Goomba, the ?-block + mushroom row, the rising pipes, the
// gaps, the staircase, the flagpole + castle). Renders at the NES 256x240
// internal resolution and scales up with nearest-neighbor for crisp pixels.
//
// Physics constants are adapted from the SMB disassembly (doppelganger /
// 6502disassembly.com nes-smb) tables — MaxRightXSpdData $28/$18 (run 2.5 /
// walk 1.5 px-per-frame), JumpMForceData / FallMForceData (gravity differs
// ascending-with-A vs falling), expressed here in pixels-per-frame at a fixed
// 60Hz timestep so the feel is framerate-independent.

export default {
  id: 'mario',
  title: 'Super Mario',
  icon: '🍄',
  size: 'md',
  chrome: true,

  // ---- small dashboard card: a static authentic 1-1 scene + "click to play"
  async mount(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .mw { flex:1; min-height:0; display:flex; flex-direction:column; gap:0; }
      .mw-scene { flex:1; min-height:0; position:relative; overflow:hidden; cursor:pointer;
        border-radius:10px; -webkit-tap-highlight-color:transparent; user-select:none; }
      .mw-scene canvas { position:absolute; inset:0; width:100%; height:100%;
        image-rendering:pixelated; display:block; }
      .mw-hint { flex:none; text-align:center; padding-top:7px;
        font-family:var(--font-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase;
        color:var(--ink-faint); }
      .mw-hint b { color:var(--mint); font-weight:600; }
    `);
    const cv = h('canvas', { width: 192, height: 120 });
    const scene = h('div', { class: 'mw-scene' }, cv);
    const hint = h('div', { class: 'mw-hint' });
    hint.innerHTML = '<b>click to play</b> ▶ &nbsp;World 1-1';
    body.classList.add('mw');
    body.replaceChildren(scene, hint);

    // Draw a static slice of 1-1: ground, a couple bricks + a ?-block, a hill, a
    // cloud/bush, a coin, a Goomba, and small idle Mario. Cheap one-shot paint.
    const g = cv.getContext('2d');
    const T = SMB.T;
    g.fillStyle = SMB.SKY; g.fillRect(0, 0, cv.width, cv.height);
    SMB.drawHill(g, 8, cv.height - 16, 1);
    SMB.drawCloud(g, 120, 14, 1);
    SMB.drawBush(g, 60, cv.height - 16);
    // ground (2 rows)
    for (let x = 0; x < cv.width; x += T)
      for (let r = 0; r < 2; r++) SMB.drawTile(g, SMB.TILE.GROUND, x, cv.height - (r + 1) * T);
    // a question block + two bricks floating
    SMB.drawTile(g, SMB.TILE.QUESTION, 96, cv.height - 5 * T, 0);
    SMB.drawTile(g, SMB.TILE.BRICK, 80, cv.height - 5 * T);
    SMB.drawTile(g, SMB.TILE.BRICK, 112, cv.height - 5 * T);
    SMB.drawCoin(g, 96 + 4, cv.height - 7 * T, 0);
    SMB.drawGoomba(g, 150, cv.height - 2 * T, 0, false);
    SMB.drawMario(g, 36, cv.height - 2 * T - (16 - SMB.T), { big: false, frame: 0, face: 1, state: 'stand' });
  },

  // ---- fullscreen: the real game --------------------------------------------
  async openFull(body, ctx) {
    const { h } = ctx;
    ctx.style(`
      .mg { position:relative; width:100%; height:calc(100vh - 150px); min-height:380px;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
      .mg-stage { flex:1; min-height:0; width:100%; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      .mg canvas { display:block; border-radius:14px; background:${SMB.SKY};
        image-rendering:pixelated; image-rendering:crisp-edges; }
      .mg-hint { flex:none; font-family:var(--font-mono); font-size:11px; letter-spacing:.1em;
        text-transform:uppercase; color:var(--ink-faint); }
      .mg-hint b { color:var(--mint); font-weight:600; }
    `);
    // NES internal resolution. We render at 256x240 to a small backing store and
    // upscale via CSS with nearest-neighbor. On a Jetson the GPU is fill-rate
    // bound on the upscaled present, so we ADAPT the displayed size at runtime:
    // start near a 2x cap and shrink if frames run slow, keeping it smooth.
    const VW = 256, VH = 240;
    const cv = h('canvas', { width: VW, height: VH });
    const stage = h('div', { class: 'mg-stage' }, cv);
    const hint = h('div', { class: 'mg-hint' }, 'move ← → · run = hold direction · jump SPACE / ↑ / A · restart ENTER · exit ESC / L2');
    body.classList.add('mg');
    body.replaceChildren(stage, hint);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;

    // displayed scale (integer-ish multiples for crisp pixels), auto-tuned.
    let dispScale = 2;
    function applyScale() {
      cv.style.width = Math.round(VW * dispScale) + 'px';
      cv.style.height = Math.round(VH * dispScale) + 'px';
    }
    applyScale();

    const T = SMB.T;                  // 16
    const game = SMB.makeLevel();     // { tiles, solidAt, enemies(), items, flagX, castleX, worldW, marioStart }
    const WORLD_W = game.worldW;

    // ---------- physics constants (px/frame @ 60Hz; see header) ----------
    const P = {
      RUN_ACCEL: 0.1094,     // accel while a direction is held (held dir = run feel)
      RELEASE_FRICTION: 0.0703, // ~SMB FrictionData $98 — coast to a stop
      SKID_DECEL: 0.215,     // turnaround friction (snappy skid, the famous SMB skid)
      RUN_MAX: 2.5625,       // SMB MaxRightXSpdData $28 = 2 + 8/16 → ~2.56 px/f
      MIN_WALK: 0.13,        // SMB minimum walk impulse — below this we snap to 0
      GRAV_HOLD: 0.146,      // ascending while jump held — slow gravity (JumpMForceData)
      GRAV_FALL: 0.4375,     // falling / jump released — strong gravity (FallMForceData)
      MAX_FALL: 4.5,         // terminal downward speed
      JUMP_SLOW: -4.0,       // jump impulse when slow/standing
      JUMP_FAST: -4.5,       // jump impulse when running (goes higher + farther)
      RUN_THRESHOLD: 1.6,    // speed above which the "fast" jump impulse applies
    };

    // ---------- state ----------
    const makeMario = () => ({
      x: game.marioStart.x, y: game.marioStart.y,
      vx: 0, vy: 0, big: false, onGround: false,
      face: 1, anim: 0, state: 'stand',
      holdingJump: false,
      invuln: 0,            // i-frames after taking a hit (frames)
      dead: 0, deadT: 0,
      win: 0,              // flagpole/castle sequence stage
      winT: 0,
    });
    let m = makeMario();
    let cam = 0;
    let coins = 0, score = 0, time = 400, timeAcc = 0;
    const bumps = [];      // {col,row,t} brick/?-block bump animations
    const sparkles = [];   // {x,y,t} coin pop / score pops
    let started = false;   // a short title overlay until first input
    const enemies = game.spawnEnemies();
    let raf = 0, running = true;

    // ---------- input ----------
    const keys = { left: false, right: false, jump: false };
    let padDir = 0, padDirT = 0;
    const REQ = (down, side) => { keys[side] = down; };

    const doJump = () => {
      if (m.dead || m.win) return;
      if (m.onGround) {
        const spd = Math.abs(m.vx);
        m.vy = spd > P.RUN_THRESHOLD ? P.JUMP_FAST : P.JUMP_SLOW;
        m.onGround = false;
        m.holdingJump = true;
        SMB.sfx?.();
      }
    };

    const onKey = (down) => (e) => {
      const k = (e.key || '').toLowerCase();
      if (k === 'arrowleft' || k === 'a') { REQ(down, 'left'); started = true; e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { REQ(down, 'right'); started = true; e.preventDefault(); }
      else if (k === ' ' || k === 'arrowup' || k === 'w') {
        keys.jump = down; started = true;
        if (down) doJump(); else m.holdingJump = false;
        e.preventDefault();
      } else if (k === 'enter' && down && (m.dead || m.win === 99)) reset();
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener('keydown', kd, true);
    window.addEventListener('keyup', ku, true);

    // Controller bridge: 'left'/'right'/'fleft'/'fright' arrive repeatedly while
    // held — refresh a short timeout so they act as a held button; vertical
    // ignored; ANY other action = jump.
    function padInput(action) {
      started = true;
      if (action === 'left' || action === 'fleft') { padDir = -1; padDirT = performance.now(); }
      else if (action === 'right' || action === 'fright') { padDir = 1; padDirT = performance.now(); }
      else if (action === 'down' || action === 'fdown' || action === 'fup') { /* ignore */ }
      else { if (m.dead || m.win === 99) reset(); else doJump(); }
    }
    window.__GARDEN_GAME = {
      input: padInput,
      stop: () => {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', kd, true);
        window.removeEventListener('keyup', ku, true);
      },
    };

    function reset() {
      m = makeMario();
      cam = 0; coins = 0; score = 0; time = 400; timeAcc = 0;
      bumps.length = 0; sparkles.length = 0;
      game.respawn(enemies);
      started = true;
    }

    // ---------- collision against the tile grid ----------
    // Solid = ground, brick, question(used or not), pipe, hard/stair block.
    const isSolid = (col, row) => game.solidAt(col, row);

    // Resolve Mario vs tiles, axis-separated. Returns nothing; mutates m.
    function moveAndCollide() {
      const w = 12, h = m.big ? 28 : 14;     // hitbox (narrower than 16 like SMB)
      const ox = 2;                          // hitbox inset from sprite left
      // --- horizontal ---
      m.x += m.vx;
      let left = m.x + ox, right = m.x + ox + w, top = m.y + (16 - h) - (m.big ? 16 : 0), bottom;
      // recompute top/bottom for current size
      const spriteH = m.big ? 32 : 16;
      top = m.y + (spriteH - h);
      bottom = top + h;
      if (m.vx > 0) {
        const c = Math.floor(right / T);
        for (let r = Math.floor(top / T); r <= Math.floor((bottom - 1) / T); r++)
          if (isSolid(c, r)) { m.x = c * T - (ox + w); m.vx = 0; break; }
      } else if (m.vx < 0) {
        const c = Math.floor(left / T);
        for (let r = Math.floor(top / T); r <= Math.floor((bottom - 1) / T); r++)
          if (isSolid(c, r)) { m.x = (c + 1) * T - ox; m.vx = 0; break; }
      }
      if (m.x < 0) { m.x = 0; if (m.vx < 0) m.vx = 0; }

      // --- vertical ---
      m.y += m.vy;
      left = m.x + ox; right = m.x + ox + w;
      top = m.y + (spriteH - h); bottom = top + h;
      m.onGround = false;
      if (m.vy > 0) {
        const r = Math.floor((bottom) / T);
        for (let c = Math.floor(left / T); c <= Math.floor((right - 1) / T); c++)
          if (isSolid(c, r)) { m.y = r * T - spriteH; m.vy = 0; m.onGround = true; break; }
      } else if (m.vy < 0) {
        const r = Math.floor(top / T);
        for (let c = Math.floor(left / T); c <= Math.floor((right - 1) / T); c++)
          if (isSolid(c, r)) {
            // head bump — stop upward motion and bump the tile
            m.y = (r + 1) * T - (spriteH - h);
            m.vy = 0; m.holdingJump = false;
            hitBlock(c, r);
            break;
          }
      }
    }

    // ---------- block interaction (head bump) ----------
    function hitBlock(col, row) {
      const t = game.tileAt(col, row);
      if (t === SMB.TILE.QUESTION) {
        const item = game.popQuestion(col, row, m.big);
        bumps.push({ col, row, t: 0 });
        if (item === 'coin') { coins++; score += 200; popScore(col, row, '200'); }
        else if (item === 'mushroom' || item === 'flower') {
          // spawn a mushroom that walks out and ascends from the block top
          enemies.push(SMB.makeMushroom(col * T, row * T));
        }
        SMB.sfx?.();
      } else if (t === SMB.TILE.BRICK) {
        if (m.big) { game.breakBrick(col, row); score += 50; bumps.push({ col, row, t: 0, broke: true }); }
        else bumps.push({ col, row, t: 0 });
        SMB.sfx?.();
      }
    }
    function popScore(col, row, txt) { sparkles.push({ x: col * T + 4, y: row * T, t: 0, txt }); }

    // ---------- fixed-timestep loop ----------
    const STEP = 1000 / 60;
    let last = performance.now(), acc = 0;
    // frame-time sampling (for honest fps reporting via CDP)
    window.__MARIO_FPS = { samples: [], dt: 0, scale: dispScale };

    // adaptive display-scale tuner: after a warmup, measure median frame time;
    // shrink the displayed canvas if we're missing ~60fps, grow if we have lots
    // of headroom. Keeps the GPU present cost within budget on weak hardware.
    let tuneFrames = 0, tuneTime = 0, warmup = 30;
    const MIN_SCALE = 1.25, MAX_SCALE = 3;
    function tune(frame) {
      if (warmup > 0) { warmup--; return; }
      tuneTime += frame; tuneFrames++;
      if (tuneFrames < 45) return;
      const avg = tuneTime / tuneFrames; tuneTime = 0; tuneFrames = 0;
      // fit to panel: don't grow past what the stage can show
      const fitScale = Math.min(stage.clientWidth / VW, stage.clientHeight / VH) || MAX_SCALE;
      // shrink if below ~57fps (17.5ms); grow only with comfortable headroom (>59fps)
      if (avg > 17.6 && dispScale > MIN_SCALE) { dispScale = Math.max(MIN_SCALE, dispScale - 0.25); applyScale(); }
      else if (avg < 16.4 && dispScale < Math.min(MAX_SCALE, fitScale) - 0.01) { dispScale = Math.min(MAX_SCALE, fitScale, dispScale + 0.25); applyScale(); }
      window.__MARIO_FPS.scale = dispScale;
    }

    function tick() {
      if (!running) return;
      const now = performance.now();
      let frame = now - last; last = now;
      if (frame > 100) frame = 100;       // avoid spiral after a stall
      window.__MARIO_FPS.dt = frame;
      window.__MARIO_FPS.samples.push(frame);
      if (window.__MARIO_FPS.samples.length > 240) window.__MARIO_FPS.samples.shift();
      tune(frame);
      acc += frame;
      let steps = 0;
      while (acc >= STEP && steps < 5) { update(); acc -= STEP; steps++; }
      draw();
      raf = requestAnimationFrame(tick);
    }

    function update() {
      // lapse controller hold ~260ms after last repeat
      if (padDir && performance.now() - padDirT > 260) padDir = 0;
      const left = keys.left || padDir < 0;
      const right = keys.right || padDir > 0;

      // ----- win sequence (flagpole slide → walk to castle) -----
      if (m.win) {
        m.winT++;
        if (m.win === 1) {                // sliding down the pole
          m.state = 'climb';
          m.y += 2.2;
          const groundY = game.groundTopY * T - (m.big ? 32 : 16);
          if (m.y >= groundY) { m.y = groundY; m.win = 2; m.winT = 0; m.face = 1; }
        } else if (m.win === 2) {         // brief pause then walk right into castle
          if (m.winT > 16) { m.x += 1.4; m.state = 'walk'; m.anim += 0.25;
            if (m.x > game.castleX + 8) { m.win = 99; m.state = 'stand'; } }
        }
        return;
      }

      // ----- death -----
      if (m.dead) {
        m.deadT++;
        if (m.deadT > 24) { m.vy += P.GRAV_FALL; m.vy = Math.min(m.vy, P.MAX_FALL); m.y += m.vy; }
        return;
      }

      // ----- timer -----
      timeAcc += STEP;
      if (timeAcc >= 400) { timeAcc = 0; if (time > 0) time--; }

      // ----- horizontal accel / skid / friction -----
      // A held direction ramps toward the run cap with snappy skid on turnaround.
      if (left && !right) {
        m.face = -1;
        if (m.vx > 0) m.vx -= P.SKID_DECEL;          // skid (turnaround)
        else m.vx -= P.RUN_ACCEL;
        if (m.vx < -P.RUN_MAX) m.vx = -P.RUN_MAX;
      } else if (right && !left) {
        m.face = 1;
        if (m.vx < 0) m.vx += P.SKID_DECEL;
        else m.vx += P.RUN_ACCEL;
        if (m.vx > P.RUN_MAX) m.vx = P.RUN_MAX;
      } else {
        // friction toward 0
        if (m.vx > 0) { m.vx -= P.RELEASE_FRICTION; if (m.vx < 0) m.vx = 0; }
        else if (m.vx < 0) { m.vx += P.RELEASE_FRICTION; if (m.vx > 0) m.vx = 0; }
      }
      if (Math.abs(m.vx) < P.MIN_WALK && !left && !right) m.vx = 0;

      // ----- gravity (variable jump) -----
      if (!m.onGround) {
        const ascending = m.vy < 0;
        const g = (ascending && m.holdingJump && (keys.jump || padHoldingJump())) ? P.GRAV_HOLD : P.GRAV_FALL;
        m.vy += g;
        if (m.vy > P.MAX_FALL) m.vy = P.MAX_FALL;
        if (m.vy >= 0) m.holdingJump = false;
      }

      moveAndCollide();

      // fall in a pit
      if (m.y > VH + 16) { die(); return; }

      // ----- flagpole -----
      if (!m.win && m.x + 8 >= game.flagX) {
        m.x = game.flagX - 6; m.vx = 0; m.vy = 0; m.win = 1; m.winT = 0;
        score += 1000; popScore(Math.floor(m.x / T), Math.floor(m.y / T) - 1, '1000');
      }

      // ----- enemies -----
      updateEnemies();

      // ----- coins in tiles already handled; floating coins -----
      collectCoins();

      // ----- animation state -----
      if (!m.onGround) m.state = 'jump';
      else if ((left || right) && Math.sign(m.vx) !== (left ? -1 : 1) && Math.abs(m.vx) > 0.4) m.state = 'skid';
      else if (Math.abs(m.vx) > 0.1) { m.state = 'walk'; m.anim += Math.min(0.35, 0.08 + Math.abs(m.vx) * 0.09); }
      else m.state = 'stand';

      if (m.invuln > 0) m.invuln--;

      // ----- camera (locks; never scrolls back, like SMB) -----
      const target = Math.max(0, Math.min(WORLD_W - VW, m.x - VW * 0.42));
      if (target > cam) cam = target;             // forward only
      else cam = Math.max(cam, target);           // (no backtrack)
    }

    function padHoldingJump() { return false; } // pad jumps are taps; only keyboard holds

    function die() {
      if (m.dead) return;
      m.dead = 1; m.deadT = 0; m.vy = -4.2; m.state = 'jump';
    }

    function collectCoins() {
      const mw = 14, mh = m.big ? 30 : 14;
      const mx = m.x + 1, my = m.y + (m.big ? 2 : 2);
      for (const c of game.freeCoins) {
        if (c.got) continue;
        if (mx < c.x + 12 && mx + mw > c.x && my < c.y + 16 && my + mh > c.y) {
          c.got = true; coins++; score += 200; popScore(Math.floor(c.x / T), Math.floor(c.y / T), '200');
        }
      }
    }

    function updateEnemies() {
      const mw = 12, mh = m.big ? 28 : 14, mox = 2;
      const mSpriteH = m.big ? 32 : 16;
      const mLeft = m.x + mox, mRight = m.x + mox + mw;
      const mTop = m.y + (mSpriteH - mh), mBottom = mTop + mh;

      for (const e of enemies) {
        if (e.dead && e.deadT === undefined) continue;
        if (!e.active) {
          // activate when within ~24px of the right camera edge
          if (e.x < cam + VW + 24) e.active = true; else continue;
        }
        // squashed goomba timer
        if (e.squash !== undefined) { e.squash++; if (e.squash > 30) e.gone = true; continue; }
        if (e.gone) continue;

        if (e.type === 'mushroom') {
          // emerge from the block, then walk + fall
          if (e.emerge < 16) { e.emerge++; e.y -= 1; continue; }
          e.x += e.vx;
          e.vy = Math.min((e.vy || 0) + P.GRAV_FALL, P.MAX_FALL);
          enemyVertical(e);
          enemyHorizontalBounce(e);
        } else { // goomba / koopa
          e.x += e.vx;
          e.vy = Math.min((e.vy || 0) + P.GRAV_FALL, P.MAX_FALL);
          enemyVertical(e);
          enemyHorizontalBounce(e);
          e.anim = (e.anim || 0) + 0.1;
        }
        if (e.y > VH + 32) { e.gone = true; continue; }

        // vs Mario
        if (m.dead || m.win) continue;
        const eL = e.x + 1, eR = e.x + 15, eT = e.y + (e.type === 'mushroom' ? 0 : 1), eB = e.y + 16;
        if (mRight > eL && mLeft < eR && mBottom > eT && mTop < eB) {
          if (e.type === 'mushroom') {
            e.gone = true;
            if (!m.big) { m.big = true; m.y -= 16; }
            score += 1000; popScore(Math.floor(e.x / T), Math.floor(e.y / T) - 1, '1000');
          } else {
            // stomp if falling and feet above enemy mid
            if (m.vy > 0 && mBottom - m.vy <= eT + 8) {
              if (e.type === 'koopa' && !e.shell) { e.shell = true; e.vx = 0; e.anim = 0; }
              else if (e.type === 'koopa' && e.shell && e.vx === 0) { e.vx = (m.x < e.x ? 2.4 : -2.4); }
              else { e.squash = 0; }
              m.vy = (keys.jump || padDir) ? -4.2 : -3.2; // bounce
              score += 100; popScore(Math.floor(e.x / T), Math.floor(e.y / T), '100');
            } else if (m.invuln <= 0) {
              if (e.type === 'koopa' && e.shell && e.vx === 0) {
                e.vx = (m.x < e.x ? 2.4 : -2.4); // kick stationary shell
              } else {
                takeHit();
              }
            }
          }
        }
      }
      // shells vs other enemies
      for (const e of enemies) {
        if (e.type === 'koopa' && e.shell && e.vx !== 0 && !e.gone) {
          for (const o of enemies) {
            if (o === e || o.gone || o.squash !== undefined) continue;
            if (Math.abs(o.x - e.x) < 14 && Math.abs(o.y - e.y) < 14) { o.squash = 0; score += 100; }
          }
        }
      }
    }

    function enemyVertical(e) {
      // simple ground/tile landing for enemies
      const r = Math.floor((e.y + 16) / T);
      const cL = Math.floor((e.x + 2) / T), cR = Math.floor((e.x + 14) / T);
      if (e.vy >= 0 && (isSolid(cL, r) || isSolid(cR, r))) { e.y = r * T - 16; e.vy = 0; e.onGround = true; }
      else e.onGround = false;
    }
    function enemyHorizontalBounce(e) {
      // turn at walls or pipe edges
      const dir = e.vx > 0 ? 1 : -1;
      const cx = Math.floor((e.x + (dir > 0 ? 15 : 1)) / T);
      const cy = Math.floor((e.y + 8) / T);
      if (isSolid(cx, cy)) e.vx = -e.vx;
      if (e.x < 0) e.vx = Math.abs(e.vx);
    }

    function takeHit() {
      if (m.big) { m.big = false; m.y += 16; m.invuln = 90; SMB.sfx?.(); }
      else die();
    }

    // ---------- render ----------
    function draw() {
      // sky
      g.fillStyle = SMB.SKY; g.fillRect(0, 0, VW, VH);
      const camX = Math.floor(cam);

      // background scenery (parallax-free, placed in world like SMB)
      game.scenery.forEach((s) => {
        const sx = s.x - camX;
        if (sx < -96 || sx > VW + 32) return;
        if (s.kind === 'hill') SMB.drawHill(g, sx, game.groundTopY * T, s.big ? 2 : 1);
        else if (s.kind === 'cloud') SMB.drawCloud(g, sx, s.y, s.n);
        else if (s.kind === 'bush') SMB.drawBush(g, sx, game.groundTopY * T, s.n);
      });

      // tiles (camera-culled)
      const c0 = Math.floor(camX / T), c1 = Math.ceil((camX + VW) / T);
      const qFrame = Math.floor(performance.now() / 130) % 4;
      const hasBumps = bumps.length > 0;
      for (let col = c0; col <= c1; col++) {
        const colX = col * T - camX;
        for (let row = 0; row < game.rows; row++) {
          const t = game.tileAt(col, row);
          if (!t) continue;
          let bumpY = 0;
          if (hasBumps) {
            for (let i = 0; i < bumps.length; i++) {
              const b = bumps[i];
              if (b.col === col && b.row === row) { bumpY = -Math.sin((b.t / 8) * Math.PI) * 6; break; }
            }
          }
          SMB.drawTile(g, t, colX, row * T + bumpY, t === SMB.TILE.QUESTION ? qFrame : 0);
        }
      }

      // flagpole + castle
      game.drawFlag(g, camX);
      game.drawCastle(g, camX);

      // free-floating coins (spin)
      const cf = Math.floor(performance.now() / 110) % 4;
      for (const c of game.freeCoins) if (!c.got) SMB.drawCoin(g, c.x - camX, c.y, cf);

      // enemies
      for (const e of enemies) {
        if (e.gone || !e.active) continue;
        const ex = e.x - camX;
        if (ex < -20 || ex > VW + 20) continue;
        if (e.type === 'mushroom') SMB.drawMushroom(g, ex, e.y);
        else if (e.type === 'koopa') SMB.drawKoopa(g, ex, e.y, e.shell, Math.floor(e.anim) % 2, e.vx >= 0 ? 1 : -1);
        else SMB.drawGoomba(g, ex, e.y, Math.floor(e.anim) % 2, e.squash !== undefined);
      }

      // brick break particles
      for (const b of bumps) if (b.broke && b.t > 2) game.drawBrickShards(g, b.col, b.row, b.t, camX);

      // score pops
      for (const s of sparkles) {
        g.fillStyle = '#fff';
        SMB.text(g, s.txt, s.x - camX, s.y - s.t * 0.5, 1);
      }

      // mario
      if (!(m.invuln > 0 && Math.floor(m.invuln / 4) % 2)) {
        SMB.drawMario(g, Math.floor(m.x - camX), Math.floor(m.y), {
          big: m.big, face: m.face,
          frame: Math.floor(m.anim) % 3,
          state: m.dead ? 'dead' : m.state,
        });
      }

      // advance animations
      for (const b of bumps) b.t++;
      for (let i = bumps.length - 1; i >= 0; i--) if (bumps[i].t > 9 && !bumps[i].broke) bumps.splice(i, 1);
        else if (bumps[i].broke && bumps[i].t > 40) bumps.splice(i, 1);
      for (let i = sparkles.length - 1; i >= 0; i--) { sparkles[i].t++; if (sparkles[i].t > 32) sparkles.splice(i, 1); }

      // HUD (SMB top bar)
      drawHUD();

      // overlays
      if (!started) overlayTitle();
      else if (m.dead && m.deadT > 60) overlay('GAME OVER', 'press JUMP / ENTER to retry');
      else if (m.win === 99) overlay('COURSE CLEAR!', 'press JUMP / ENTER to replay');
    }

    function drawHUD() {
      SMB.text(g, 'MARIO', 16, 8, 1);
      SMB.text(g, String(score).padStart(6, '0'), 16, 16, 1);
      // coin counter
      SMB.drawCoinIcon(g, 88, 16);
      SMB.text(g, 'x' + String(coins).padStart(2, '0'), 96, 16, 1);
      SMB.text(g, 'WORLD', 152, 8, 1);
      SMB.text(g, '1-1', 160, 16, 1);
      SMB.text(g, 'TIME', 208, 8, 1);
      SMB.text(g, String(Math.max(0, time)).padStart(3, '0'), 212, 16, 1);
    }

    function overlay(title, sub) {
      g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(0, VH / 2 - 28, VW, 56);
      g.save(); g.textAlign = 'center';
      SMB.text(g, title, VW / 2 - title.length * 4, VH / 2 - 12, 1.5, '#fff');
      SMB.text(g, sub, VW / 2 - sub.length * 2, VH / 2 + 8, 0.75, '#ffd23d');
      g.restore();
    }
    function overlayTitle() {
      SMB.text(g, 'SUPER MARIO BROS.', 70, 64, 1, '#fff');
      SMB.text(g, 'WORLD  1-1', 100, 88, 1, '#ffd23d');
      SMB.text(g, 'PRESS  RIGHT  OR  JUMP', 70, 150, 1, '#fff');
    }

    raf = requestAnimationFrame(tick);
  },
};

// ============================================================================
//  SMB — shared graphics + level. Hand-authored pixel art in the SMB palette.
//  All sprites are drawn from small color-indexed bitmap strings ('.' = clear)
//  so nothing copyrighted is shipped; it just LOOKS authentic.
// ============================================================================
const SMB = (() => {
  const T = 16;
  const SKY = '#5c94fc';
  // SMB NES palette subset
  const C = {
    '.': null,
    K: '#000000',   // black outline
    R: '#d83018',   // mario red / hat
    r: '#fc7460',   // light red highlight
    S: '#fcb888',   // skin
    s: '#e09060',   // skin shadow
    B: '#0070ec',   // overalls blue
    b: '#3cbcfc',   // light blue
    N: '#6b3e0a',   // brown (hair/shoes/goomba)
    n: '#a05a14',   // light brown
    O: '#e09020',   // brick orange
    o: '#f8b840',   // brick light / ?-block
    Y: '#fcd000',   // coin / ?-block yellow
    y: '#fce8a0',   // coin shine
    W: '#ffffff',
    G: '#00a800',   // pipe green
    g: '#80d010',   // pipe light green
    H: '#e0e0e0',   // flag pole gray
    L: '#509048',   // hill/bush green
    l: '#88d048',   // hill/bush light
  };

  // --- generic indexed-bitmap drawer (1px per cell) ---
  function bmp(g, rows, dx, dy, scale = 1, flip = false) {
    dx = Math.round(dx); dy = Math.round(dy);
    const w = rows[0].length;
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row[flip ? w - 1 - x : x];
        const col = C[ch];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(dx + x * scale, dy + y * scale, scale, scale);
      }
    }
  }

  // ---------------- tile sprites (16x16) ----------------
  const TILE = { GROUND: 1, BRICK: 2, QUESTION: 3, QUSED: 4, PIPE_TL: 5, PIPE_TR: 6, PIPE_BL: 7, PIPE_BR: 8, HARD: 9, COINBLK: 10 };

  // prerendered tile buffers (offscreen) for speed
  const tileCache = {};
  function tileCanvas(key, painter) {
    if (tileCache[key]) return tileCache[key];
    const c = document.createElement('canvas'); c.width = T; c.height = T;
    const gg = c.getContext('2d'); painter(gg);
    tileCache[key] = c; return c;
  }

  function paintGround(gg) {
    gg.fillStyle = '#c84c0c'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = '#fc9838'; gg.fillRect(0, 0, T, 2);
    gg.fillStyle = '#000'; // brick seams
    gg.fillRect(0, 0, T, 1);
    for (let i = 0; i < T; i += 8) { gg.fillRect(i, 0, 1, 8); }
    gg.fillRect(0, 8, T, 1);
    for (let i = 4; i < T; i += 8) { gg.fillRect(i, 8, 1, 8); }
    gg.fillStyle = '#fc9838';
    gg.fillRect(1, 1, 6, 6); gg.fillRect(9, 1, 6, 6);
    gg.fillRect(5, 9, 6, 6); gg.fillRect(13, 9, 3, 6); gg.fillRect(0, 9, 3, 6);
  }
  function paintBrick(gg) {
    gg.fillStyle = '#000'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = '#c84c0c'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = '#fc9838'; // top highlight
    gg.fillRect(0, 0, T, 2);
    gg.fillStyle = '#000';
    gg.fillRect(0, 3, T, 1); gg.fillRect(0, 7, T, 1); gg.fillRect(0, 11, T, 1); gg.fillRect(0, 15, T, 1);
    gg.fillRect(4, 4, 1, 3); gg.fillRect(12, 4, 1, 3);
    gg.fillRect(0, 8, 1, 3); gg.fillRect(8, 8, 1, 3);
    gg.fillRect(4, 12, 1, 3); gg.fillRect(12, 12, 1, 3);
  }
  function paintQuestion(gg, frame = 0) {
    const lit = ['#fc9838', '#fcb050', '#f8d068', '#fc9838'][frame % 4];
    gg.fillStyle = '#000'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = lit; gg.fillRect(1, 1, T - 2, T - 2);
    gg.fillStyle = '#000';
    gg.fillRect(1, 1, T - 2, 1); gg.fillRect(1, T - 2, T - 2, 1);
    gg.fillRect(1, 1, 1, T - 2); gg.fillRect(T - 2, 1, 1, T - 2);
    // rivets
    gg.fillRect(2, 2, 1, 1); gg.fillRect(T - 3, 2, 1, 1);
    gg.fillRect(2, T - 3, 1, 1); gg.fillRect(T - 3, T - 3, 1, 1);
    // '?'
    gg.fillStyle = '#000';
    const q = ['.###.', '#...#', '...#.', '..#..', '..#..', '.....', '..#..'];
    bmp(gg, q.map((s) => s.replace(/#/g, 'K')), 5, 4, 1);
  }
  function paintQUsed(gg) {
    gg.fillStyle = '#000'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = '#a05a14'; gg.fillRect(1, 1, T - 2, T - 2);
    gg.fillStyle = '#7a420c'; gg.fillRect(1, 1, T - 2, 1);
  }
  function paintHard(gg) {
    gg.fillStyle = '#000'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = '#a05a14'; gg.fillRect(0, 0, T, T);
    gg.fillStyle = '#f8b840'; gg.fillRect(1, 1, T - 3, T - 3);
    gg.fillStyle = '#7a420c'; gg.fillRect(2, 2, T - 4, T - 4);
    gg.fillStyle = '#f8b840'; gg.fillRect(2, 2, T - 4, 2);
  }
  // pipe quadrants
  function paintPipe(gg, part) {
    // part: 'tl','tr','bl','br'
    gg.fillStyle = '#000'; gg.fillRect(0, 0, T, T);
    const top = part[0] === 't';
    const leftHalf = part[1] === 'l';
    if (top) {
      // rim: pipe top is 2 tiles wide, total width 2*T; rim overhangs.
      gg.fillStyle = '#00a800'; gg.fillRect(0, 0, T, T);
      gg.fillStyle = '#80d010'; gg.fillRect(leftHalf ? 1 : 0, 1, leftHalf ? 4 : 3, T - 2);
      gg.fillStyle = '#005800'; gg.fillRect(leftHalf ? T - 1 : 0, 1, 1, T - 2);
      gg.fillStyle = '#000'; gg.fillRect(0, 0, T, 2);
      gg.fillStyle = '#00a800'; gg.fillRect(0, 1, T, 1);
    } else {
      gg.fillStyle = '#00a800'; gg.fillRect(leftHalf ? 1 : 0, 0, T - 1, T);
      gg.fillStyle = '#80d010'; gg.fillRect(leftHalf ? 2 : 0, 0, leftHalf ? 3 : 3, T);
      gg.fillStyle = '#005800'; gg.fillRect(leftHalf ? T - 2 : T - 1, 0, 1, T);
    }
  }

  function getTile(t, frame) {
    switch (t) {
      case TILE.GROUND: return tileCanvas('ground', paintGround);
      case TILE.BRICK: return tileCanvas('brick', paintBrick);
      case TILE.QUESTION: return tileCanvas('q' + (frame % 4), (gg) => paintQuestion(gg, frame));
      case TILE.QUSED: return tileCanvas('qused', paintQUsed);
      case TILE.HARD: return tileCanvas('hard', paintHard);
      case TILE.PIPE_TL: return tileCanvas('ptl', (g) => paintPipe(g, 'tl'));
      case TILE.PIPE_TR: return tileCanvas('ptr', (g) => paintPipe(g, 'tr'));
      case TILE.PIPE_BL: return tileCanvas('pbl', (g) => paintPipe(g, 'bl'));
      case TILE.PIPE_BR: return tileCanvas('pbr', (g) => paintPipe(g, 'br'));
      default: return null;
    }
  }
  function drawTile(g, t, x, y, frame = 0) {
    const c = getTile(t, frame);
    if (c) g.drawImage(c, Math.round(x), Math.round(y));
  }

  // ---------------- coin ----------------
  const COIN_FRAMES = [
    ['..YY..', '.YyyY.', 'YyKKyY', 'YyKKyY', '.YyyY.', '..YY..'],
    ['..YY..', '..YyY.', '.YyKyY', '.YyKyY', '..YyY.', '..YY..'],
    ['...Y..', '...Y..', '..KY..', '..KY..', '...Y..', '...Y..'],
    ['..YY..', '..YyY.', '.YyKyY', '.YyKyY', '..YyY.', '..YY..'],
  ];
  function drawCoin(g, x, y, frame = 0) {
    bmp(g, COIN_FRAMES[frame % 4], x + 5, y + 5, 1);
  }
  function drawCoinIcon(g, x, y) {
    bmp(g, COIN_FRAMES[0].map((r) => r.replace(/K/g, 'y')), x, y, 1);
  }

  // ---------------- hills / clouds / bushes (share shape, like SMB) ----------
  function blob(g, x, y, scale, light, dark) {
    // a rounded green/white mound made of stacked rects
    const rows = [
      '....LLLL....',
      '..LLLLLLLL..',
      '.LLLLLLLLLL.',
      'LLLLLLLLLLLL',
      'LLLLLLLLLLLL',
    ];
    return rows;
  }
  function drawHill(g, x, baseY, big = 1) {
    const w = big === 2 ? 80 : 48, h = big === 2 ? 40 : 24;
    g.fillStyle = '#00a800';
    // triangle-ish hill
    for (let i = 0; i < h; i++) {
      const ww = Math.round((i / h) * w);
      g.fillRect(x + w / 2 - ww / 2, baseY - h + i, ww, 1);
    }
    g.fillStyle = '#80d010';
    // highlight + eyes/mouth dots like SMB hill
    g.fillRect(x + w / 2 - 2, baseY - h + 2, 4, 2);
    g.fillStyle = '#005800';
    g.fillRect(x + w / 2 - 8, baseY - 6, 3, 3);
    g.fillRect(x + w / 2 + 5, baseY - 6, 3, 3);
  }
  function drawCloud(g, x, y, n = 1) {
    // SMB cloud: rounded white top bumps on a flat base, with a faint shadow row.
    const bumps = n + 2;
    g.fillStyle = '#fff';
    const r = 7;
    for (let i = 0; i < bumps; i++) {
      const cx = x + r + i * (r * 1.7);
      const rr = (i === 0 || i === bumps - 1) ? r - 1 : r + 1; // ends slightly lower
      g.beginPath(); g.arc(cx, y + 8, rr, Math.PI, 2 * Math.PI); g.fill();
    }
    const w = (bumps - 1) * (r * 1.7) + r * 2;
    g.fillRect(x, y + 7, w, 7);
    g.fillStyle = '#bcd6fc'; g.fillRect(x, y + 13, w, 1);
  }
  function drawBush(g, x, baseY, n = 1) {
    // SMB bush: same silhouette as the cloud but green, sitting on the ground.
    const bumps = n + 2;
    g.fillStyle = '#00a800';
    const r = 8;
    for (let i = 0; i < bumps; i++) {
      const cx = x + r + i * (r * 1.5);
      const rr = (i === 0 || i === bumps - 1) ? r - 2 : r;
      g.beginPath(); g.arc(cx, baseY - 4, rr, Math.PI, 2 * Math.PI); g.fill();
    }
    const w = (bumps - 1) * (r * 1.5) + r * 2;
    g.fillRect(x, baseY - 5, w, 5);
    g.fillStyle = '#80d010'; g.fillRect(x + r, baseY - 8, 3, 2);
  }

  // ---------------- Goomba ----------------
  const GOOMBA = [
    ['....NNNN....', '..NNNNNNNN..', '.NNNNNNNNNN.', 'NNWWNNNNWWNN', 'NNWKNNNNWKNN', 'NNNNNNNNNNNN', 'NNNNNNNNNNNN', '.NNNNNNNNNN.', '..NNNNNNNN..', '...nn..nn...', '..nnn..nnn..'],
    ['....NNNN....', '..NNNNNNNN..', '.NNNNNNNNNN.', 'NNWWNNNNWWNN', 'NNWKNNNNWKNN', 'NNNNNNNNNNNN', 'NNNNNNNNNNNN', '.NNNNNNNNNN.', '..NNNNNNNN..', '..nnn..nnn..', '...nn..nn...'],
  ];
  const GOOMBA_SQUASH = ['............', '............', '............', '............', '............', '....NNNN....', '.NNNNNNNNNN.', 'NNWWNNNWWNNN', 'NNWKNNNWKNNN', 'NNNNNNNNNNNN', 'NNNNNNNNNNNN'];
  function drawGoomba(g, x, y, frame = 0, squashed = false) {
    if (squashed) bmp(g, GOOMBA_SQUASH, x + 2, y, 1);
    else bmp(g, GOOMBA[frame % 2], x + 2, y, 1);
  }

  // ---------------- Koopa ----------------
  const KOOPA = [
    ['..GG..', '.GGGG.', 'GGWGGG', 'GGWKGG', '.gGGg.', '.GGGG.', 'gGGGGg', 'GGGGGG', 'GGGGGG', '.G..G.', 'gg..gg', 'GG..GG', '.S..S.'],
  ];
  const KOOPA_SHELL = ['......', '.gGGg.', 'gGWWGg', 'GWGGWG', 'GWGGWG', 'gGWWGg', '.gGGg.', '......'];
  function drawKoopa(g, x, y, shell, frame = 0, face = 1) {
    if (shell) bmp(g, KOOPA_SHELL, x + 5, y + 8, 1, face < 0);
    else bmp(g, KOOPA[0], x + 5, y + 3, 1, face < 0);
  }

  // ---------------- Mushroom ----------------
  const MUSHROOM = ['..RRRR..', '.RWWWWR.', 'RWRRWWWR', 'RRRRWWWR', 'RWWWWWRR', '.RWWWWR.', '..SSSS..', '.S.SS.S.'];
  function drawMushroom(g, x, y) { bmp(g, MUSHROOM, x + 4, y + 4, 1); }
  function makeMushroom(x, y) { return { type: 'mushroom', x, y, vx: 0.8, vy: 0, emerge: 0, active: true }; }

  // ---------------- Mario (small + big) ----------------
  // 16x16 small Mario poses, 16x32 big.
  const SMALL = {
    stand: ['.....RRRR...', '....RRRRRRR.', '....NNNSSKS.', '...NSNSSSKSS', '...NSNNSSSKS', '...NNSSSSKKK', '.....SSSS...', '...RRBBRRR..', '..RRRBBRRRR.', '.RRRRBBBRRRR', 'SSRRBYBYBRRS', 'SSBBBBBBBBS S', 'SBBBBBBBBBBB', '.BBB....BBB.', 'NNNN....NNNN', 'NNNN....NNNN'],
    walk: ['.....RRRR...', '....RRRRRRR.', '....NNNSSKS.', '...NSNSSSKSS', '...NSNNSSSKS', '...NNSSSSKKK', '.....SSSS...', '..RRRBBRRR..', '.RRRRBBBRRR.', 'SRRRBBBBRRRS', 'SSRBYBYBBRSS', '..BBBBBBBB..', '.BBBBBBBBBB.', '.NNN..BBBB..', 'NNNN...NNNN.', '......NNNN..'],
    walk2: ['.....RRRR...', '....RRRRRRR.', '....NNNSSKS.', '...NSNSSSKSS', '...NSNNSSSKS', '...NNSSSSKKK', '.....SSSS...', '...RRBBRRR..', '..RRRBBBRRR.', '.SRRBBBBRRS.', 'SSRBYBYBBRSS', 'SS.BBBBBB.SS', '...BBBBBB...', '..BBB..BBB..', '.NNNN..NNNN.', 'NNNN....NNNN'],
    skid: ['.....RRRR...', '....RRRRRRR.', '....NNNSSKS.', '...NSNSSSKSS', '...NSNNSSSKS', '...NNSSSSKKK', '.....SSSS...', '..RRBBRR....', '.RRBBBRR.RR.', 'RRBBBBRRRBBR', 'SBYBYBBSRBBR', 'SBBBBBBSRBBR', '.BBBBBB..RR.', '.BBB.BBB....', 'NNNN..NNN...', 'NNN....N....'],
    jump: ['.....RRRR..N', '....RRRRRRRN', '....NNNSSKSN', '...NSNSSSKSN', '...NSNNSSSKN', '...NNSSSSKKK', 'R....SSSS...', 'RR.RRBBRR.RR', 'BRRRRBBBRRBB', 'BBRRBBBBRBBB', 'BBSRBYBYBRSB', '.BSBBBBBBBSB', '..BBB..BBB..', '..BB....BB..', '.NNN....NNN.', 'NN........NN'],
    dead: ['.....RRRR...', '....RRRRRRR.', '....NNNSSKS.', '...NSNSSSKSS', '...NSNNSSSKS', '...NNSSSSKKK', '.....SSSS...', '...RRBBRRR..', '..RRRBBRRRR.', '.RRRRBBBRRRR', 'SSRRBYBYBRRS', 'SSBBBBBBBBSS', 'SBBBBBBBBBBB', '.BBB....BBB.', 'NNNN....NNNN', 'NNNN....NNNN'],
    climb: ['..RRRR......', '.RRRRRRR....', '.NNNSSKS....', 'NSNSSSKSS...', 'NSNNSSSKS...', 'NNSSSSKKK...', '..SSSS......', '.RRBBSS.....', 'RRRBBBS.....', 'RRRBBBBS....', 'SRBYBYBBR...', 'SBBBBBBBR...', '.BBBBBB.....', '.BBB.BBB....', 'NNN..NNN....', 'NN....NN....'],
  };
  // big = small scaled to 16x32 by stacking an upper (torso/head) and lower (legs)
  const BIG = {
    stand: ['......RRRR......', '.....RRRRRRR....', '.....NNNSSKS....', '....NSNSSSKSS...', '....NSNNSSSKS...', '....NNNSSSSKK...', '.....SSSSSS.....', '...RRRRBRRRR...', '..RRRRBBBRRRR..', '.RRRRRBBBRRRRR.', 'SSRRBBYBYBBRRS S', 'SSRBBBBBBBBBRSS', 'SSBBBBBBBBBBBSS', '..BBBBBBBBBBB..', '..BBB.BBB.BBB..', '..BBB.....BBB..', '..BBB.....BBB..', '..BBB.....BBB..', '..BBBB...BBBB..', '..SSSS...SSSS..', '.SSSSS...SSSSS.', '.NNNN.....NNNN.', 'NNNNN.....NNNNN', 'NNNN.......NNNN', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............'],
    walk: ['......RRRR......', '.....RRRRRRR....', '.....NNNSSKS....', '....NSNSSSKSS...', '....NSNNSSSKS...', '....NNNSSSSKK...', '.....SSSSSS.....', '....RRRRBRRR...', '...RRRRBBBRRR..', '..RRRRRBBBRRRR.', '.SSRRBBYBYBBRS.', '.SSRBBBBBBBBRS.', '.SSBBBBBBBBBSS.', '...BBBBBBBBB...', '...BBBBBBBBB...', '...BBB.BBBB....', '..BBB...BBB....', '.BBB.....BBB...', 'SBBB......BBB..', 'SSSS......SSS..', 'SSS........SSS.', '.NNN.......NNN.', 'NNNN.......NNNN', '.NN.........NNN', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............'],
    jump: ['..N...RRRR......', '..NN.RRRRRRR....', '..NN.NNNSSKS....', '.RNNNSNSSSKSS...', '.RRNNSNNSSSKS...', '.RRRNNNSSSSKK...', '.RR..SSSSSS....', 'RRR.RRRRBRRR.RR', 'BRRRRRRBBBRRRBB', 'BBRRRRRBBBRRBBB', 'BBSRRBBYBYBBRSB', '.BSRBBBBBBBBRSB', '.BSBBBBBBBBBSB.', '..BBBBBBBBBBB..', '..BBBBBBBBBBB..', '..BBBB.BBBBB...', '..BBB...BBB....', '..BBB...BBB....', '.SBBB...BBBS...', 'SSSSS...SSSSS..', 'SSS.......SSS..', 'NNN.......NNN..', 'NNNN.....NNNN..', '.NN.......NN...', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............'],
  };
  BIG.skid = BIG.walk; BIG.dead = BIG.stand; BIG.climb = BIG.stand;

  function poseFor(state, frame) {
    if (state === 'walk') return frame === 1 ? 'walk2' : 'walk';
    return state;
  }
  function drawMario(g, x, y, opt) {
    const { big, face, frame, state } = opt;
    if (big) {
      const key = state === 'walk' ? 'walk' : (BIG[state] ? state : 'stand');
      bmp(g, BIG[key], x, y, 1, face < 0);
    } else {
      const key = poseFor(state, frame);
      bmp(g, SMALL[key] || SMALL.stand, x, y, 1, face < 0);
    }
  }

  // ---------------- tiny bitmap font ----------------
  const FONT = {
    A: ['.###.', '#...#', '#####', '#...#', '#...#'], B: ['####.', '#...#', '####.', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '.####'], D: ['####.', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '###..', '#....', '#####'], F: ['#####', '#....', '###..', '#....', '#....'],
    G: ['.####', '#....', '#..##', '#...#', '.####'], H: ['#...#', '#...#', '#####', '#...#', '#...#'],
    I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..###', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
    L: ['#...', '#...', '#...', '#...', '####'], M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'], O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '####.', '#....', '#....'], R: ['####.', '#...#', '####.', '#.#.', '#..#'],
    S: ['.####', '#....', '.###.', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
    '0': ['.###.', '#..##', '#.#.#', '##..#', '.###.'], '1': ['..#.', '.##.', '..#.', '..#.', '.###'],
    '2': ['.###.', '#...#', '..##.', '.#...', '#####'], '3': ['####.', '....#', '.###.', '....#', '####.'],
    '4': ['#..#', '#..#', '####', '...#', '...#'], '5': ['#####', '#....', '####.', '....#', '####.'],
    '6': ['.###.', '#....', '####.', '#...#', '.###.'], '7': ['#####', '....#', '...#.', '..#..', '.#...'],
    '8': ['.###.', '#...#', '.###.', '#...#', '.###.'], '9': ['.###.', '#...#', '.####', '....#', '.###.'],
    '-': ['.....', '.....', '#####', '.....', '.....'], '.': ['..', '..', '..', '..', '#.'],
    '!': ['#', '#', '#', '.', '#'], ' ': ['.', '.', '.', '.', '.'], 'x': ['...', '#.#', '.#.', '#.#', '...'],
  };
  function text(g, str, x, y, scale = 1, color = '#fff') {
    g.fillStyle = color;
    let cx = x;
    for (const chRaw of String(str).toUpperCase()) {
      const ch = chRaw === 'X' ? 'x' : chRaw;
      const glyph = FONT[ch] || FONT[' '];
      const w = glyph[0].length;
      for (let yy = 0; yy < glyph.length; yy++)
        for (let xx = 0; xx < w; xx++)
          if (glyph[yy][xx] === '#') g.fillRect(Math.round(cx + xx * scale), Math.round(y + yy * scale), scale, scale);
      cx += (w + 1) * scale;
    }
  }

  function sfx() { /* no audio in kiosk */ }

  // ===================== World 1-1 level =====================
  // Faithful tile layout. rows from top(0) to bottom; ground sits at row 13-14
  // (256-wide screen is 15 tiles tall = 240). We use 15 rows; ground top at row
  // 13, so rows 13,14 are ground. Column units are tiles (16px).
  function makeLevel() {
    const rows = 15;
    const groundTopY = 13;            // tile row of ground surface
    const COLS = 212;                 // ~1-1 length
    // grid[col][row] = tile id (0 empty)
    const grid = Array.from({ length: COLS }, () => new Array(rows).fill(0));
    const set = (c, r, t) => { if (c >= 0 && c < COLS && r >= 0 && r < rows) grid[c][r] = t; };

    // ground everywhere except the two pits (authentic 1-1 gaps)
    // gap 1: cols 69-70 ; gap 2: cols 86-88  (after staircase region). SMB has a
    // gap near the start? No — 1-1 gaps are mid/late. Use known gaps.
    const isGap = (c) => (c >= 69 && c <= 70) || (c >= 86 && c <= 88);
    for (let c = 0; c < COLS; c++) {
      if (isGap(c)) continue;
      set(c, 13, TILE.GROUND); set(c, 14, TILE.GROUND);
    }

    // ---- the lone first ?-block (coin) at col 16, 4 tiles above ground (row 9)
    set(16, 9, TILE.QUESTION);

    // ---- the famous row: cols 20-24 at row 9 = brick,?,brick,?,brick ;
    //      plus a single ? above at col 22 row 5. Left ? (col 21) has mushroom.
    set(20, 9, TILE.BRICK);
    set(21, 9, TILE.QUESTION);  // mushroom (if small) / coin
    set(22, 9, TILE.BRICK);
    set(23, 9, TILE.QUESTION);  // coin
    set(24, 9, TILE.BRICK);
    set(22, 5, TILE.QUESTION);  // upper lone ? (coin)

    // ---- pipes of increasing height (heights 2,3,4,4 tiles)
    // pipe = 2 cols wide. positions per 1-1: ~28,38,46,57
    const pipes = [[28, 2], [38, 3], [46, 4], [57, 4]];
    for (const [pc, ph] of pipes) {
      for (let i = 0; i < ph; i++) {
        const r = 13 - 1 - i;       // body rows from just under ground up
        const top = i === ph - 1;
        set(pc, r, top ? TILE.PIPE_TL : TILE.PIPE_BL);
        set(pc + 1, r, top ? TILE.PIPE_TR : TILE.PIPE_BR);
      }
    }

    // ---- after gap1: a single ? block (coin) and bricks around col 77-80
    set(77, 9, TILE.BRICK);
    set(78, 9, TILE.QUESTION);  // coin
    set(78, 5, TILE.BRICK);     // high lone brick
    set(79, 9, TILE.BRICK);
    // bricks high row cols 80-83 at row 5
    set(80, 5, TILE.BRICK); set(81, 5, TILE.QUESTION); set(82, 5, TILE.BRICK);

    // ---- bricks + the long high brick run + a ? (cols 91-94) before staircase
    set(91, 9, TILE.BRICK); set(92, 9, TILE.BRICK);
    set(94, 9, TILE.QUESTION); // coin
    set(94, 5, TILE.BRICK); set(95, 5, TILE.BRICK); set(96, 5, TILE.BRICK);
    set(101, 9, TILE.BRICK); set(102, 9, TILE.QUESTION); set(103, 9, TILE.BRICK);

    // ---- the two pyramids (hard-block staircases) ~cols 134-153
    // ascending pyramid 1: cols 134..137 increasing height 1..4
    const pyr = (startCol, dir, maxH) => {
      for (let i = 0; i < maxH; i++) {
        const h = dir > 0 ? i + 1 : maxH - i;
        for (let j = 0; j < h; j++) set(startCol + i, 13 - 1 - j, TILE.HARD);
      }
    };
    pyr(134, 1, 4);            // up
    pyr(140, -1, 4);           // down (then gap2 at 86? already used) -> place near here
    // a 2nd pair later
    pyr(148, 1, 4);
    pyr(155, -1, 4);

    // ---- a lone pipe (col 163) height 2
    for (let i = 0; i < 2; i++) {
      const r = 13 - 1 - i, top = i === 1;
      set(163, r, top ? TILE.PIPE_TL : TILE.PIPE_BL);
      set(164, r, top ? TILE.PIPE_TR : TILE.PIPE_BR);
    }

    // ---- four bricks (cols 168-171 row 9) before final staircase
    set(168, 9, TILE.BRICK); set(169, 9, TILE.BRICK); set(170, 9, TILE.QUESTION); set(171, 9, TILE.BRICK);

    // ---- a lone pipe (col 179) height 2
    for (let i = 0; i < 2; i++) {
      const r = 13 - 1 - i, top = i === 1;
      set(179, r, top ? TILE.PIPE_TL : TILE.PIPE_BL);
      set(180, r, top ? TILE.PIPE_TR : TILE.PIPE_BR);
    }

    // ---- the big final staircase (8 steps up) cols 181-188
    for (let i = 0; i < 8; i++)
      for (let j = 0; j <= i; j++) set(181 + i, 13 - 1 - j, TILE.HARD);

    // ---- flagpole at col 198, castle at col 202
    const flagCol = 198, castleCol = 202;

    const worldW = COLS * T;

    // mutable tile access + used-question tracking
    const usedQ = new Set();
    const tileAt = (c, r) => {
      if (c < 0 || c >= COLS || r < 0 || r >= rows) return 0;
      return grid[c][r];
    };
    const solidAt = (c, r) => {
      const t = tileAt(c, r);
      return t === TILE.GROUND || t === TILE.BRICK || t === TILE.QUESTION ||
        t === TILE.QUSED || t === TILE.HARD ||
        t === TILE.PIPE_TL || t === TILE.PIPE_TR || t === TILE.PIPE_BL || t === TILE.PIPE_BR;
    };
    // which ? blocks give the mushroom
    const mushroomBlocks = new Set(['21,9']);
    function popQuestion(c, r, big) {
      const key = c + ',' + r;
      grid[c][r] = TILE.QUSED;
      if (mushroomBlocks.has(key)) return 'mushroom';
      return 'coin';
    }
    function breakBrick(c, r) { grid[c][r] = 0; }

    // scenery placement (hills, clouds, bushes) — authentic-ish opening
    const scenery = [
      { kind: 'hill', x: 0, big: true },
      { kind: 'cloud', x: 8 * T, y: 24, n: 0 },
      { kind: 'bush', x: 11 * T, n: 1 },
      { kind: 'cloud', x: 19 * T, y: 32, n: 2 },
      { kind: 'hill', x: 16 * T, big: false },
      { kind: 'cloud', x: 27 * T, y: 24, n: 0 },
      { kind: 'bush', x: 23 * T, n: 0 },
      { kind: 'cloud', x: 36 * T, y: 32, n: 1 },
      { kind: 'hill', x: 48 * T, big: true },
      { kind: 'bush', x: 41 * T, n: 2 },
      { kind: 'cloud', x: 56 * T, y: 24, n: 0 },
      { kind: 'cloud', x: 67 * T, y: 32, n: 2 },
      { kind: 'hill', x: 64 * T, big: false },
      { kind: 'bush', x: 71 * T, n: 1 },
      { kind: 'cloud', x: 84 * T, y: 24, n: 0 },
      { kind: 'hill', x: 96 * T, big: true },
      { kind: 'cloud', x: 104 * T, y: 32, n: 1 },
      { kind: 'bush', x: 109 * T, n: 0 },
      { kind: 'cloud', x: 119 * T, y: 24, n: 2 },
      { kind: 'hill', x: 128 * T, big: false },
      { kind: 'bush', x: 145 * T, n: 1 },
      { kind: 'cloud', x: 152 * T, y: 32, n: 0 },
      { kind: 'hill', x: 176 * T, big: true },
      { kind: 'bush', x: 188 * T, n: 0 },
    ];

    // free-floating coins (a few above the bricks) — authentic touch
    const baseCoins = [
      [25, 8], [26, 8], [27, 8],
      [80, 4], [81, 4],
      [109, 8], [110, 8], [111, 8],
    ];
    const freeCoins = baseCoins.map(([c, r]) => ({ x: c * T, y: r * T, got: false }));

    // enemy spawn template (re-instantiated on respawn)
    const enemyDefs = [
      { type: 'goomba', col: 22 },   // first goomba
      { type: 'goomba', col: 40 },
      { type: 'goomba', col: 51 },   // between pipes
      { type: 'goomba', col: 53 },
      { type: 'koopa', col: 80 },
      { type: 'goomba', col: 97 },
      { type: 'goomba', col: 99 },
      { type: 'goomba', col: 124 },
      { type: 'goomba', col: 126 },
      { type: 'goomba', col: 170 },
      { type: 'goomba', col: 172 },
    ];
    function spawnEnemies() {
      return enemyDefs.map((d) => ({
        type: d.type, x: d.col * T, y: (groundTopY - 1) * T,
        vx: -0.5, vy: 0, anim: 0, active: false,
        shell: false, onGround: false,
      }));
    }
    function respawn(arr) {
      arr.length = 0;
      spawnEnemies().forEach((e) => arr.push(e));
      freeCoins.forEach((c) => { c.got = false; });
      // restore used question blocks & broken bricks to original
      // (simplest: rebuild from defs we set above — re-set the q blocks)
      [[16, 9], [21, 9], [23, 9], [22, 5], [78, 9], [81, 5], [94, 9], [102, 9], [170, 9]].forEach(([c, r]) => set(c, r, TILE.QUESTION));
      // bricks that may have broken
      [[20, 9], [22, 9], [24, 9], [77, 9], [79, 9], [78, 5], [80, 5], [82, 5], [91, 9], [92, 9], [94, 5], [95, 5], [96, 5], [101, 9], [103, 9], [168, 9], [169, 9], [171, 9]].forEach(([c, r]) => set(c, r, TILE.BRICK));
    }

    function drawFlag(g, camX) {
      const fx = flagCol * T - camX + 8;
      const topY = (groundTopY - 11) * T;   // pole ~11 tiles tall
      const botY = groundTopY * T;
      if (fx < -16 || fx > 256 + 16) return;
      // ball
      g.fillStyle = '#80d010'; g.fillRect(fx - 2, topY - 4, 4, 4);
      // pole
      g.fillStyle = '#c0c0c0'; g.fillRect(fx - 1, topY, 2, botY - topY);
      g.fillStyle = '#e0e0e0'; g.fillRect(fx - 1, topY, 1, botY - topY);
      // flag (green triangle)
      g.fillStyle = '#108020';
      const ft = topY + 2;
      for (let i = 0; i < 12; i++) g.fillRect(fx - 1 - (12 - i), ft + i, 12 - i, 1);
    }
    function drawCastle(g, camX) {
      const cx0 = castleCol * T - camX;
      const top = (groundTopY - 5) * T;
      if (cx0 < -90 || cx0 > 256 + 16) return;
      const W = 80;
      g.fillStyle = '#c84c0c';
      g.fillRect(cx0, top + 16, W, 5 * T - 16);
      // crenellations
      for (let i = 0; i < W; i += 16) { g.fillRect(cx0 + i, top + 8, 8, 8); }
      // central tower
      g.fillStyle = '#c84c0c'; g.fillRect(cx0 + W / 2 - 12, top - 8, 24, 24);
      for (let i = 0; i < 24; i += 8) g.fillRect(cx0 + W / 2 - 12 + i, top - 16, 4, 8);
      // door
      g.fillStyle = '#000'; g.fillRect(cx0 + W / 2 - 6, top + 5 * T - 16 - 14, 12, 14);
      // windows
      g.fillRect(cx0 + 12, top + 24, 6, 8);
      g.fillRect(cx0 + W - 18, top + 24, 6, 8);
      // brick texture lines
      g.fillStyle = '#000';
      for (let y = top + 16; y < top + 5 * T; y += 6) g.fillRect(cx0, y, W, 1);
    }
    function drawBrickShards(g, c, r, t, camX) {
      g.fillStyle = '#c84c0c';
      const x = c * T - camX + 8, y = r * T + 8;
      const k = t - 2;
      const p = [[-6, -k * 1.5 + k * k * 0.18], [6, -k * 1.4 + k * k * 0.18], [-5, -k + k * k * 0.2], [5, -k * 0.9 + k * k * 0.2]];
      for (const [dx, dy] of p) g.fillRect(x + dx, y + dy, 4, 4);
    }

    return {
      rows, cols: COLS, groundTopY, worldW,
      tileAt, solidAt, popQuestion, breakBrick,
      scenery, freeCoins,
      spawnEnemies, respawn,
      flagX: flagCol * T, castleX: castleCol * T,
      drawFlag, drawCastle, drawBrickShards,
      marioStart: { x: 2.5 * T, y: (groundTopY - 1) * T },
    };
  }

  return {
    T, SKY, TILE, drawTile, drawCoin, drawCoinIcon, drawHill, drawCloud, drawBush,
    drawGoomba, drawKoopa, drawMushroom, makeMushroom, drawMario, text, makeLevel, sfx,
  };
})();
