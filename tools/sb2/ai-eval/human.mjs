// A scripted "human" for slot 0 (P1) in headless AI evaluations. Not the original AI:
// a small BFS bot that is deliberately the SAME on both layouts, so CPU metrics can be
// compared between the original 13x11 and the tall 13x25 field.
//   - flees blast lines (bomb rays up to range+1 cells, stopped by solid cells) and fire
//   - bombs when an opponent is in a clear blast line / next to it, or when it stands next
//     to the soft block on its path to the nearest opponent — only if it can still reach a
//     safe cell within a few steps
//   - otherwise walks the cheapest path (soft block = 6 steps) towards the nearest opponent
// Pad bits (libretro order): UP 16, DOWN 32, LEFT 64, RIGHT 128, A 256.
const UP = 16, DOWN = 32, LEFT = 64, RIGHT = 128, A = 256;
const DIRS = [[0, -1, UP], [0, 1, DOWN], [-1, 0, LEFT], [1, 0, RIGHT]];

export function makeHuman(slot = 0) {
  let lastA = false;
  return function decide(s) {
    const me = s.bombers[slot];
    if (!me.active || me.dying || s.frozen) { lastA = false; return 0; }
    const G = s.grid, W = G.width, r0 = G.rows[0], H = G.height;
    const at = (x, y) => (x < 0 || x >= W || y < r0 || y >= r0 + H ? 0xC6 : G.code[(y - r0) * W + x]);
    const solid = (v) => (v & 0x80) !== 0;
    const walk = (v) => !solid(v) && v !== 0x43 && v !== 0x01 && v !== 0x41;
    const key = (x, y) => y * 32 + x;

    const danger = new Set();
    const blast = (bx, by, range, set) => {
      set.add(key(bx, by));
      for (const [dx, dy] of DIRS) {
        for (let k = 1; k <= range + 1; k++) {
          const x = bx + dx * k, y = by + dy * k, v = at(x, y);
          if (solid(v)) break;
          set.add(key(x, y));
          if (v === 0x43 || v === 0x44) break;
        }
      }
    };
    for (const b of s.bombs) if (!b.moving) blast(b.cx, b.cy, b.range, danger);
    for (const f of s.fire) danger.add(key(f.cx, f.cy));

    const foes = s.bombers.filter((b) => b.slot !== slot && b.active && !b.dying);
    const mx = me.cx, my = me.cy;

    // BFS over walkable cells (own cell always allowed) -> first step to the nearest cell
    // satisfying goal(); maxD limits the search.
    const bfs = (goal, avoid, maxD = 64) => {
      const seen = new Map([[key(mx, my), null]]);
      let q = [[mx, my, 0]];
      while (q.length) {
        const nq = [];
        for (const [x, y, d] of q) {
          if (goal(x, y) && d > 0) {
            let k = key(x, y), prev = seen.get(k);
            while (prev && prev.k !== key(mx, my)) { k = prev.k; prev = seen.get(k); }
            return { d, dir: prev ? prev.dir : 0 };
          }
          if (goal(x, y) && d === 0) return { d: 0, dir: 0 };
          if (d >= maxD) continue;
          for (const [dx, dy, dir] of DIRS) {
            const nx = x + dx, ny = y + dy, k = key(nx, ny);
            if (seen.has(k) || !walk(at(nx, ny)) || avoid(nx, ny)) continue;
            seen.set(k, { k: key(x, y), dir });
            nq.push([nx, ny, d + 1]);
          }
        }
        q = nq;
      }
      return null;
    };

    let pad = 0, wantA = false;
    if (danger.has(key(mx, my))) {
      const r = bfs((x, y) => !danger.has(key(x, y)), () => false, 12);
      if (r) pad = r.dir;
    } else {
      // bomb?
      const range = me.fire;
      const inLine = foes.some((f) => {
        if (Math.abs(f.cx - mx) + Math.abs(f.cy - my) <= 1) return true;
        if (f.cx !== mx && f.cy !== my) return false;
        const dx = Math.sign(f.cx - mx), dy = Math.sign(f.cy - my), n = Math.abs(f.cx - mx) + Math.abs(f.cy - my);
        if (n > range + 1) return false;
        for (let k = 1; k < n; k++) if (!walk(at(mx + dx * k, my + dy * k))) return false;
        return true;
      });
      // path to the nearest foe, soft blocks cost 6 (Dijkstra on a small grid)
      let step = null;
      if (foes.length) {
        const dist = new Map([[key(mx, my), 0]]), from = new Map();
        const open = [[0, mx, my]];
        const goalK = new Set(foes.map((f) => key(f.cx, f.cy)));
        let end = null;
        while (open.length) {
          let bi = 0;
          for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
          const [d, x, y] = open.splice(bi, 1)[0];
          if (d > dist.get(key(x, y))) continue;
          if (goalK.has(key(x, y))) { end = key(x, y); break; }
          for (const [dx, dy, dir] of DIRS) {
            const nx = nx0(x, dx), ny = y + dy, v = at(nx, ny), k = key(nx, ny);
            let c;
            if (v === 0xC2) c = 6; else if (walk(v) && !danger.has(k)) c = 1; else if (goalK.has(k)) c = 1; else continue;
            if (dist.has(k) && dist.get(k) <= d + c) continue;
            dist.set(k, d + c); from.set(k, { k: key(x, y), dir, soft: v === 0xC2 });
            open.push([d + c, nx, ny]);
          }
        }
        if (end !== null) {
          let k = end, f = from.get(k);
          while (f && f.k !== key(mx, my)) { k = f.k; f = from.get(k); }
          step = f || null;
        }
      }
      const softNext = step && step.soft;
      if (me.bombsHand > 0 && (inLine || softNext)) {
        const d2 = new Set(danger); blast(mx, my, range, d2);
        const r = bfs((x, y) => !d2.has(key(x, y)), () => false, 6);
        if (r) wantA = true;
      }
      if (!wantA && step && !step.soft) pad = step.dir;
    }
    if (wantA && !lastA) { pad |= A; lastA = true; } else lastA = false;
    return pad;
  };
}
const nx0 = (x, dx) => x + dx;
