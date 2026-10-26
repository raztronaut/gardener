// The runtime pack (tools/sb2/extract/pack.py -> data/sb2/assets/pack/): pack.json +
// sb2.bin (ROM banks the display code reads, per-stage VRAM / CGRAM / WRAM snapshots).
// Served read-only at /api/sb2/asset/pack/… (src/server.mjs). No DOM.

export const ASSET_BASE = '/api/sb2/asset/';

// io: { json(path) -> Promise<object>, bin(path) -> Promise<ArrayBuffer> } (paths relative
// to data/sb2/assets/); defaults to fetch() against the wall server.
export async function loadPack(io = fetchIO()) {
  const manifest = await io.json('pack/pack.json');
  const bin = new Uint8Array(await io.bin('pack/' + manifest.bin));
  return makePack(manifest, bin);
}

export function fetchIO(base = ASSET_BASE) {
  return {
    async json(p) { const r = await fetch(base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); },
    async bin(p) { const r = await fetch(base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.arrayBuffer(); },
  };
}

export function makePack(manifest, bin) {
  const blob = (name) => {
    const e = manifest.blobs[name];
    if (!e) throw new Error('pack: no blob ' + name);
    return bin.subarray(e[0], e[0] + e[1]);
  };
  const banks = {};
  for (const b of manifest.rom_banks) banks[parseInt(b, 16) & 0x3F] = blob('rom.' + b);
  // ROM byte / word / long at a 24-bit CPU address (HiROM, banks in the pack only)
  const rom8 = (a) => { const b = banks[(a >> 16) & 0x3F]; return b ? b[a & 0xFFFF] : 0; };
  const rom16 = (a) => rom8(a) | (rom8(a + 1) << 8);
  const rom24 = (a) => rom16(a) | (rom8(a + 2) << 16);
  const stages = manifest.stages.map((s) => {
    const raw = blob(s.blob);
    return {
      ...s,
      vram: raw.subarray(s.layout.vram[0], s.layout.vram[0] + s.layout.vram[1]),
      cgram: raw.subarray(s.layout.cgram[0], s.layout.cgram[0] + s.layout.cgram[1]),
      wram: raw.subarray(s.layout.wram[0], s.layout.wram[0] + s.layout.wram[1]),
      wramBase: s.layout.wram_base,
    };
  });
  return { manifest, bin, blob, rom8, rom16, rom24, stage: (n) => stages[n - 1], audio: manifest.audio };
}
