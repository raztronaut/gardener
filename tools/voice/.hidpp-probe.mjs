import { openSync, writeSync, createReadStream, readdirSync, readFileSync } from 'node:fs';
for (const n of readdirSync('/sys/class/hidraw')) {
  const ue = readFileSync(`/sys/class/hidraw/${n}/device/uevent`, 'utf8'); if (!/046D/i.test(ue)) continue;
  const rd = readFileSync(`/sys/class/hidraw/${n}/device/report_descriptor`);
  let vendor = false; for (let i = 0; i + 2 < rd.length; i++) if (rd[i] === 0x06 && rd[i + 1] === 0x00 && rd[i + 2] === 0xff) vendor = true;
  console.log(n, 'vendor page:', vendor, 'desc bytes', rd.length);
  if (!vendor) continue;
  const fd = openSync(`/dev/${n}`, 'r+');
  const rs = createReadStream(null, { fd, autoClose: false, highWaterMark: 64 });
  rs.on('data', (d) => console.log('  <', n, [...d].map((x) => x.toString(16).padStart(2, '0')).join(' ')));
  for (let dev = 1; dev <= 6; dev++) { const b = Buffer.alloc(7); Buffer.from([0x10, dev, 0x00, 0x0a, 0x1b, 0x04, 0x00]).copy(b); try { writeSync(fd, b); } catch (e) { console.log('  write err', e.code); } }
  // receiver-level ping (HID++ 1.0 get register 0x02 on device 0xff)
  const b = Buffer.alloc(7); Buffer.from([0x10, 0xff, 0x81, 0x02, 0, 0, 0]).copy(b); try { writeSync(fd, b); } catch (e) { console.log('  write err', e.code); }
}
setTimeout(() => process.exit(0), 2500);
