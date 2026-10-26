// Reader for data/sb2/conformance/wtrace/<vector>.bin (see wtrace.py): yields
// { frame, tick, wram } per recorded tick (wram = full 128 KiB image).
import fs from 'node:fs';
import zlib from 'node:zlib';

export function* readTrace(file, start) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'SB2W') throw new Error('bad trace ' + file);
  const n = buf.readUInt32LE(8);
  let off = 12;
  const cur = new Uint8Array(start);
  for (let k = 0; k < n; k++) {
    const frame = buf.readUInt32LE(off), tick = buf.readUInt32LE(off + 4), len = buf.readUInt32LE(off + 8);
    off += 12;
    const x = zlib.inflateSync(buf.subarray(off, off + len));
    off += len;
    for (let i = 0; i < x.length; i++) if (x[i]) cur[i] ^= x[i];
    yield { frame, tick, wram: cur };
  }
}
