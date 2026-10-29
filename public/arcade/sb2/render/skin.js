// Skins: the Garden Edition (public/arcade/sb2/garden/, original art built by
// tools/sb2/garden/build.py) is an OVERLAY on the runtime pack: byte patches into the
// pack's blobs (stage VRAM characters + CGRAM, ROM-bank pose graphics + palettes, the
// animated characters' sources) and into the menus' pack, plus replaced pictures (figures,
// the stage-select mini maps). Applying it gives a pack in exactly the format the renderer
// already reads, so the display / menus run unchanged on either skin. No DOM.
//
//   const sk = await loadSkin();                       // { manifest, bin } or null
//   const gpack = skinPack(pack, sk);                  // a new pack (the original untouched)
//   const gmenu = skinMenuPack(menuPack, sk);
import { makePack } from './pack.js';

export const GARDEN_BASE = '/arcade/sb2/garden/';

export async function loadSkin(base = GARDEN_BASE, io = null) {
  const get = io || {
    async json(p) { const r = await fetch(base + p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); },
    async bin(p) { const r = await fetch(base + p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.arrayBuffer(); },
  };
  const manifest = await get.json('garden.json');
  const bin = new Uint8Array(await get.bin(manifest.bin));
  return { manifest, bin, base };
}

function patchBlobs(blobIndex, srcBin, patches, skinBin) {
  const out = srcBin.slice();
  for (const [name, at, off, len] of patches) {
    const e = blobIndex[name];
    if (!e) continue;                                   // a blob this pack does not have
    if (at + len > e[1]) throw new Error('skin: patch past the end of ' + name);
    out.set(skinBin.subarray(off, off + len), e[0] + at);
  }
  return out;
}

// the battle pack (render/pack.js makePack input: manifest + the whole sb2.bin)
export function skinPack(pack, skin) {
  const S = skin.manifest.pack || {};
  const bin = patchBlobs(pack.manifest.blobs, pack.bin, S.patches || [], skin.bin);
  const manifest = { ...pack.manifest, skin: { name: skin.manifest.name, ...(S.display || {}) } };
  if (S.figures) manifest.figures = { ...S.figures, url: skin.base + S.figures.atlas };
  return makePack(manifest, bin);
}

// the menus' pack (menu.js loadMenuPack result: { manifest, blob(name), mini })
export function skinMenuPack(mp, skin, mini = null, miniOrig = null) {
  const S = skin.manifest.menu || {};
  const byBlob = new Map();
  for (const p of S.patches || []) { if (!byBlob.has(p[0])) byBlob.set(p[0], []); byBlob.get(p[0]).push(p); }
  const cache = new Map();
  const blob = (n) => {
    if (cache.has(n)) return cache.get(n);
    if (S.blobs && S.blobs[n]) {                          // a blob the skin replaces whole
      const [off, len] = S.blobs[n];
      const b = skin.bin.subarray(off, off + len);
      cache.set(n, b);
      return b;
    }
    const src = mp.blob(n);
    let b = src;
    if (byBlob.has(n)) {
      b = src.slice();
      for (const [, at, off, len] of byBlob.get(n)) b.set(skin.bin.subarray(off, off + len), at);
    }
    cache.set(n, b);
    return b;
  };
  const manifest = { ...mp.manifest, ...(S.manifest || {}), skin: skin.manifest.name };
  return { manifest, blob, mini: mini || mp.mini, miniOrig };
}
