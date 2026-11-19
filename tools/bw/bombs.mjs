// 0x80024f98: World normal/remote fuse update, including owner input consumption.
// One lifecycle routine; the complete explosion engine is still being decoded.
export function tickBombFuse(ram, bomb) {
  const u8 = p => ram.getUint8(p & 0x1fffff);
  const u16 = p => ram.getUint16(p & 0x1fffff, true);
  const u32 = p => ram.getUint32(p & 0x1fffff, true);
  const w16 = (p, v) => ram.setUint16(p & 0x1fffff, v, true);
  if (!(u32(bomb + 0x68) & 8)) {
    const fuse = u16(bomb + 0x6c);
    if (fuse) w16(bomb + 0x6c, fuse - 1);
    return;
  }
  if (u8(bomb + 0x74)) return;
  const owner = u8(bomb + 0x73);
  if (owner >= 5) return;
  const player = 0xcda98 + owner * 0xdc;
  if (u32(player + 0x68) & 0x0c000000) return;
  const inputMask = u16(u32(0x78c00) + 2);
  const pending = u16(player + 0xac);
  if (!(inputMask & pending)) return;
  w16(player + 0xac, pending & ~inputMask);
  w16(bomb + 0x6c, 0);
}
