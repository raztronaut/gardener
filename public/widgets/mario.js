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

    let big = false;
    const setHint = () => { hint.innerHTML = big ? '🍄 <b>Super Mario!</b>' : 'tap Mario to grow ↑'; };
    const grow = () => { big = !big; sprite.classList.toggle('big', big); setHint(); };
    scene.addEventListener('click', grow);
    setHint();

    body.classList.add('mw');
    body.replaceChildren(scene, hint);
  },
};
