let enabled = true, current = null, busy = false, hooks;
try { enabled = localStorage.getItem('garden.mood') !== 'off'; } catch { /* default on */ }
function apply(m) {
  current = m;
  document.documentElement.style.setProperty('--mood-hue', `${m.hue}deg`);
  document.documentElement.style.setProperty('--mood-glow', m.glow);
  document.body.classList.add('garden-mood');
  hooks.forest(m.place);
}
async function update() {
  if (!enabled || busy || document.hidden) return;
  busy = true;
  try {
    const context = ['weather', 'air-quality', 'hacker-news', 'sf-events'].map((id) => document.querySelector(`[data-wid="${id}"]`)?.textContent?.slice(0, 550) || '').join('\n');
    const r = await fetch('/api/mood', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context }), signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const m = await r.json();
    if (enabled && ['bright', 'cozy', 'curious', 'quiet'].includes(m.key)) apply(m);
  } catch { /* retain the last good mood */ } finally { busy = false; }
}
export function init(options) { hooks = options; setTimeout(update, 10000); setInterval(update, 15 * 60 * 1000); }
export function command(arg = '') {
  if (arg === 'off') {
    enabled = false; document.body.classList.remove('garden-mood');
    try { localStorage.setItem('garden.mood', 'off'); } catch { /* ignore */ }
    hooks.toast('Garden mood off'); return;
  }
  enabled = true; try { localStorage.setItem('garden.mood', 'on'); } catch { /* ignore */ }
  update();
  hooks.toast(current ? `${current.label} · ${current.source === 'jev' ? 'Jev' : 'time-based fallback'} · updates every 15 minutes` : 'Garden mood on · finding the moment…');
}
