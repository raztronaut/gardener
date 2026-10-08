// Arcade dashboard — the whole screen below the GardenOS header + clock is the
// game library (blurred box-art backdrop, hero cover, cover shelf). Reuses the
// emulator widget's picker + boot machinery (public/widgets/emulator.js openFull).
// Toggle: controller L1 + R1 + L2 + R2 (dashboards.json).
import emu from '/widgets/emulator.js';

export default {
  id: 'arcade',
  title: 'Arcade',
  size: 'stage',
  chrome: false,
  async mount(body, ctx) {
    // own wrapper (a bare card mounts straight into the card element)
    const host = document.createElement('div');
    host.className = 'eg arcade-host';
    body.replaceChildren(host);
    await emu.openFull(host, ctx);
    return () => { try { window.__GARDEN_GAME?.stop?.(); } catch { /* ignore */ } window.__GARDEN_GAME = null; };
  },
};
