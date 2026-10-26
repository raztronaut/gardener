// Send pad actions to a (test!) wall server the way src/pad.mjs does: POST /api/pad/action.
// Default port 8791 (your own instance) — never the live 8787 while someone plays.
export function padSender(port = 8791) {
  const post = (action) => fetch(`http://127.0.0.1:${port}/api/pad/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).then((r) => r.json());
  const BTN = { A: 0, B: 1, X: 3, Y: 4, L1: 6, R1: 7, L2: 8, R2: 9, SELECT: 10, START: 11 };
  const idx = (b) => String.fromCharCode(97 + BTN[b]);
  return {
    post,
    down: (b) => post(`jb${idx(b)}d`), up: (b) => post(`jb${idx(b)}u`),
    async tap(b, ms = 80) { await post(`jb${idx(b)}d`); await new Promise((r) => setTimeout(r, ms)); await post(`jb${idx(b)}u`); },
    dir: (axis, st) => post(`j${axis}${st}`),       // ('x','l'|'c'|'r') / ('y','u'|'c'|'d')
    async push(d, ms = 120) { const ax = d === 'l' || d === 'r' ? 'x' : 'y'; await post(`j${ax}${d}`); await new Promise((r) => setTimeout(r, ms)); await post(`j${ax}c`); },
  };
}
