// The Gardener™ — Liquid Glass, ported from liquid-glass-react by Max Rovensky
// (MIT, https://github.com/rdev/liquid-glass-react) to plain DOM (no React/build).
//
// Same recipe as the library's <LiquidGlass>:
//   1. a "warp" layer with backdrop-filter: blur(6px) saturate(140%), whose own
//      rendering is bent by an SVG `filter` — its displacement map (the library's
//      standard map) pushes the glass edges, while the centre stays clean;
//   2. chromatic aberration: R, G and B are displaced by slightly different scales
//      and screen-blended, masked to the edges (that rainbow fringe at the rim);
//   3. two rim layers (a 1.5px masked gradient + an overlay-blended copy) whose
//      light angle follows the cursor — the moving specular edge.
// The library's elastic "stretch toward the cursor" is deliberately left out: on a
// full-screen panel it reads as the whole page wobbling (and the wall avoids motion).
import { DISPLACEMENT_MAP } from './lgr-map.js';

const SCALE = 70, ABERRATION = 2, BLUR = 6, SATURATE = 140; // library defaults
let svgReady = false;

function ensureFilter() {
  if (svgReady) return;
  svgReady = true;
  const a = ABERRATION;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0';
  svg.innerHTML = `
    <filter id="lgr" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feImage x="0" y="0" width="100%" height="100%" result="MAP" href="${DISPLACEMENT_MAP}" preserveAspectRatio="xMidYMid slice"/>
      <feColorMatrix in="MAP" type="matrix" values="0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0" result="EDGE_INTENSITY"/>
      <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK"><feFuncA type="discrete" tableValues="0 ${a * 0.05} 1"/></feComponentTransfer>
      <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"/>
      <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${-SCALE}" xChannelSelector="R" yChannelSelector="B" result="RD"/>
      <feColorMatrix in="RD" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="R"/>
      <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${SCALE * (-1 - a * 0.05)}" xChannelSelector="R" yChannelSelector="B" result="GD"/>
      <feColorMatrix in="GD" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="G"/>
      <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${SCALE * (-1 - a * 0.1)}" xChannelSelector="R" yChannelSelector="B" result="BD"/>
      <feColorMatrix in="BD" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="B"/>
      <feBlend in="G" in2="B" mode="screen" result="GB"/>
      <feBlend in="R" in2="GB" mode="screen" result="RGB"/>
      <feGaussianBlur in="RGB" stdDeviation="${Math.max(0.1, 0.5 - a * 0.1)}" result="AB"/>
      <feComposite in="AB" in2="EDGE_MASK" operator="in" result="EDGE_AB"/>
      <feComponentTransfer in="EDGE_MASK" result="INV"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
      <feComposite in="CENTER_ORIGINAL" in2="INV" operator="in" result="CENTER"/>
      <feComposite in="EDGE_AB" in2="CENTER" operator="over"/>
    </filter>`;
  document.body.appendChild(svg);
}

const rimBg = (ox, oy, k) => `linear-gradient(${135 + ox * 1.2}deg, rgba(255,255,255,0) 0%,
  rgba(255,255,255,${k[0] + Math.abs(ox) * 0.008}) ${Math.max(10, 33 + oy * 0.3)}%,
  rgba(255,255,255,${k[1] + Math.abs(ox) * 0.012}) ${Math.min(90, 66 + oy * 0.4)}%, rgba(255,255,255,0) 100%)`;

// Turn `el` (position: relative/absolute, has border-radius) into liquid glass.
export function liquidGlass(el) {
  if (el._lgr) return;
  ensureFilter();
  const warp = document.createElement('span');
  warp.className = 'lgr-warp';
  warp.style.cssText = `position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;
    backdrop-filter:blur(${BLUR}px) saturate(${SATURATE}%);filter:url(#lgr)`;
  const tint = document.createElement('span');
  tint.className = 'lgr-tint';
  // The library's 2nd rim uses mix-blend-mode:overlay; inside the glass element
  // that would isolate it and make it a backdrop root (the warp then sees nothing),
  // so both rims blend normally — the 2nd at lower strength to match the overlay look.
  const rims = [[0.12, 0.4], [0.14, 0.26]].map(([a, b]) => {
    const s = document.createElement('span');
    s.className = 'lgr-rim';
    s._k = [a, b];
    s.style.background = rimBg(0, 0, s._k);
    return s;
  });
  el.prepend(warp, tint);
  el.append(...rims);
  el.classList.add('lgr');
  // the rim's light follows the cursor (two gradient repaints; no layout, no transform)
  let raf = 0, last = null;
  const onMove = (e) => {
    last = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const ox = ((last.clientX - (r.left + r.width / 2)) / r.width) * 100;
      const oy = ((last.clientY - (r.top + r.height / 2)) / r.height) * 100;
      for (const s of rims) s.style.background = rimBg(ox, oy, s._k);
    });
  };
  window.addEventListener('mousemove', onMove, { passive: true });
  el._lgr = { warp, tint, rims, onMove };
}
