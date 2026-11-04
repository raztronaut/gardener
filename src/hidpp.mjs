// The Gardener™ — Logitech HID++ 2.0, just enough to DIVERT one mouse button to us.
// The MX Master 3's square button under the wheel (control 0x00C4, "SmartShift") normally
// toggles the wheel's ratchet inside the mouse and never reaches the computer. Diverted
// (REPROG_CONTROLS_V4 0x1B04 · setCidReporting), the mouse reports its press and release
// as HID++ notifications on the receiver's hidraw node instead — pad.mjs turns holding it
// into push-to-talk for "Hey Garden". The divert is re-applied every 20 s and whenever the
// receiver reports a (re)connect, because the mouse forgets it when it sleeps.
// Needs read/write on /dev/hidraw* for the Logitech receiver (udev rule: tools/voice/README.md).
import { openSync, closeSync, writeSync, readdirSync, readFileSync, createReadStream } from 'node:fs';

const SWID = 0x0a, FEAT_REPROG = 0x1b04;
const SHORT = 0x10, LONG = 0x11;

function receivers() {
  const out = [];
  for (const n of readdirSync('/sys/class/hidraw')) {
    try {
      const ue = readFileSync(`/sys/class/hidraw/${n}/device/uevent`, 'utf8');
      if (!/HID_ID=0003:0000046D:/i.test(ue)) continue;
      const rd = readFileSync(`/sys/class/hidraw/${n}/device/report_descriptor`);
      // the HID++ interface declares the vendor page 0xFF00 (06 00 FF)
      for (let i = 0; i + 2 < rd.length; i++) if (rd[i] === 0x06 && rd[i + 1] === 0x00 && rd[i + 2] === 0xff) { out.push(`/dev/${n}`); break; }
    } catch { /* skip */ }
  }
  return out;
}

export function divertButton({ cid = 0x00c4, onDown = () => {}, onUp = () => {}, log = () => {} } = {}) {
  const nodes = receivers();
  if (!nodes.length) { log('hid++: no Logitech receiver'); return null; }
  let fd = -1, path = null;
  for (const p of nodes) { try { fd = openSync(p, 'r+'); path = p; break; } catch (e) { log(`hid++: ${p}: ${e.code} (needs the udev rule)`); } }
  if (fd < 0) return null;
  const waits = new Map(); // `${dev}:${feat}:${fn}` → resolve
  const slots = new Map(); // device index → REPROG feature index (once known)
  let pressed = false, timer = 0, closed = false;
  const write = (bytes) => { const b = Buffer.alloc(bytes[0] === SHORT ? 7 : 20); Buffer.from(bytes).copy(b); try { writeSync(fd, b); } catch { /* receiver gone */ } };
  const ask = (dev, feat, fn, params, ms = 600) => new Promise((resolve) => {
    const key = `${dev}:${feat}:${fn}`;
    const t = setTimeout(() => { waits.delete(key); resolve(null); }, ms);
    waits.set(key, (r) => { clearTimeout(t); resolve(r); });
    write([params.length > 3 ? LONG : SHORT, dev, feat, (fn << 4) | SWID, ...params]);
  });
  const rs = createReadStream(null, { fd, autoClose: false, highWaterMark: 64 });
  rs.on('data', (d) => {
    for (let o = 0; o < d.length;) {
      const len = d[o] === LONG ? 20 : d[o] === SHORT ? 7 : d.length - o;
      const r = d.subarray(o, o + len); o += len;
      if (r[0] !== LONG && r[0] !== SHORT) continue;
      const dev = r[1], feat = r[2], fnsw = r[3];
      if (feat === 0x41 || (r[0] === SHORT && feat === 0x41)) { setTimeout(apply, 400); continue; } // a device (re)connected
      if (feat === 0xff || feat === 0x8f) { const w = waits.get(`${dev}:${r[3]}:${r[4] >> 4}`); if (w) { waits.delete(`${dev}:${r[3]}:${r[4] >> 4}`); w(null); } continue; } // error reply
      if ((fnsw & 0x0f) === SWID) { const key = `${dev}:${feat}:${fnsw >> 4}`; const w = waits.get(key); if (w) { waits.delete(key); w(r); } continue; }
      // a notification: the diverted buttons now held, as CIDs (fn 0, swid 0)
      if (slots.get(dev) === feat && (fnsw >> 4) === 0) {
        let held = false;
        for (let i = 4; i + 1 < r.length; i += 2) if (((r[i] << 8) | r[i + 1]) === cid) held = true;
        if (held && !pressed) { pressed = true; onDown(); } else if (!held && pressed) { pressed = false; onUp(); }
      }
    }
  });
  rs.on('error', () => { if (!closed) { log('hid++: receiver read failed'); stop(); } });
  async function apply() {
    for (let dev = 1; dev <= 6; dev++) {
      let feat = slots.get(dev);
      if (feat == null) {
        const r = await ask(dev, 0x00, 0, [FEAT_REPROG >> 8, FEAT_REPROG & 0xff, 0]);
        if (!r || !r[4]) continue;
        feat = r[4]; slots.set(dev, feat);
      }
      // setCidReporting(cid, divert=1 + divert-valid=1)
      const ok = await ask(dev, feat, 3, [cid >> 8, cid & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      if (ok && !slots.has(`logged${dev}`)) { slots.set(`logged${dev}`, 1); log(`hid++: button 0x${cid.toString(16)} diverted on device ${dev} (${path})`); }
    }
  }
  apply(); timer = setInterval(apply, 20000);
  function stop() { closed = true; clearInterval(timer); try { rs.destroy(); closeSync(fd); } catch { /* gone */ } }
  return { stop };
}
