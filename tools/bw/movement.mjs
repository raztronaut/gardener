// World US SLUS-00680: translated movement/collision routines, not SB2 rules.
// RAM-backed until the engine's structures are completely decoded. No ROM bytes.
import { cellOffset, columnCenter, rowCenter } from './core.mjs';
const i16 = n => (n << 16) >> 16;
const trunc = Math.trunc;
export class WorldMovement {
  constructor(ram) { this.ram = ram; }
  u8(p) { return this.ram.getUint8(p & 0x1fffff); }
  u16(p) { return this.ram.getUint16(p & 0x1fffff, true); }
  s16(p) { return i16(this.u16(p)); }
  u32(p) { return this.ram.getUint32(p & 0x1fffff, true); }
  w8(p, v) { this.ram.setUint8(p & 0x1fffff, v); }
  w16(p, v) { this.ram.setUint16(p & 0x1fffff, v, true); }
  cell(l, r, c) {
    const offset = cellOffset(l, r, c);
    return offset === null ? 0x7f00 : this.u16(0xcbc80 + offset);
  }
  // 0x8001d830: unlike the flag getter, invalid type queries return zero.
  cellType(l, r, c) { return this.cell(l, r, c) & 0x7f; }
  special(l, r, c) { const t = this.cellType(l, r, c); return +(t >= 0x10 && t < 0x14); }
  // 0x8001c120. Numeric masks retain their binary meaning pending item decoding.
  canEnter(l, r, c, mask) {
    if (this.cellType(l, r, c) === 4) l = 0;
    const flags = this.cell(l, r, c) & 0xff80;
    switch (mask & 0x79) {
      case 1:
        if (!(flags & 0x400)) return 1;
        if ((mask & 2) && (flags & 0x80)) return 1;
        return +!!((mask & 4) && (flags === 0x3e00 || flags === 0xfe00));
      case 8: return +!(flags & 0x200);
      case 0x10: return +!(flags & 0x1000);
      case 0x20: return +!(flags & 0x400);
      case 0x40: return +!(flags & 0x800);
      default: return 0;
    }
  }
  // 0x8001c0a4, p points to the position block (actor + 0x4c).
  updateCell(p) {
    this.w16(p + 6, trunc((this.s16(p) >> 4) / 20));
    this.w16(p + 8, trunc((this.s16(p + 2) >> 4) / 16));
    this.w16(p + 10, (this.s16(p + 4) >> 4) < 16 ? 0 : 1);
  }
  // 0x8001bd10 / 0x8001bd44: center errors in integer world units.
  centerErrorX(p) { return ((20 * this.s16(p + 6) + 10) << 20 >> 20) - (this.s16(p) >> 4); }
  centerErrorY(p) { return ((16 * this.s16(p + 8) + 8) << 20 >> 20) - (this.s16(p + 2) >> 4); }
  // 0x8001c268: resolve directional contact with another position block.
  contact(p, q, direction) {
    const x = this.s16(p) >> 4, y = this.s16(p + 2) >> 4;
    const qx = this.s16(q) >> 4, qy = this.s16(q + 2) >> 4;
    if (direction === 0 || direction === 0x80) {
      if (Math.abs(x - qx) > 19) return 0;
      const delta = direction === 0 ? y - qy : qy - y;
      if (delta < 0 || delta >= 16) return 0;
      this.w16(p + 2, (qy + (direction === 0 ? 16 : -16)) * 16);
    } else if (direction === 0xc0 || direction === 0x40) {
      if (Math.abs(y - qy) > 15) return 0;
      const delta = direction === 0xc0 ? x - qx : qx - x;
      if (delta < 0 || delta >= 20) return 0;
      this.w16(p, (qx + (direction === 0xc0 ? 20 : -20)) * 16);
    } else return 0;
    return 1;
  }
  // 0x8001c4bc, including the owner exemption at 0x8001c43c.
  bombContact(p, direction) {
    if (this.u16(p + 0x16) & 2) return 0;
    for (let n = 0; n < 40; n++) {
      const q = 0x800cdf34 + n * 0x7c;
      if (this.s16(q + 10) !== this.s16(p + 10) || (p >>> 0) === q) continue;
      if (!(this.u32(q + 0x1c) & 0x4000)) continue;
      let exempt = false;
      for (let k = 0; k < 5; k++) {
        if (this.u32(0xcda80 + k * 4) === q && (p >>> 0) === 0x800cdae4 + k * 0xdc) exempt = true;
      }
      if (!exempt && this.contact(p, q, direction)) return 1;
    }
    return 0;
  }
  // 0x8001c61c / the inlined copies in the four directional resolvers.
  playerContact(p, direction) {
    if (this.u16(p + 0x16) & 1) return 0;
    for (let n = 0; n < 5; n++) {
      const actor = 0x800cda98 + n * 0xdc, q = actor + 0x4c;
      if ((p >>> 0) === q || this.u32(actor + 0x64) === (p >>> 0)) continue;
      if (this.s16(q + 10) !== this.s16(p + 10)) continue;
      if (!this.special(this.s16(q + 10), this.s16(q + 8), this.s16(q + 6))) continue;
      if (this.u32(actor + 0x68) & 0x0c070020) continue;
      if (this.contact(p, q, direction)) return 1;
    }
    return 0;
  }
  // 0x8001c738 / c8f8 / cab8 / cc68. Horizontal and vertical returns differ
  // in the original; don't "fix" the asymmetry while translating it.
  resolve(p, direction) {
    const vertical = direction === 0 || direction === 0x80;
    const bomb = this.bombContact(p, direction);
    if (vertical && bomb) return 0;
    if (this.special(this.s16(p + 10), this.s16(p + 8), this.s16(p + 6))) {
      const hit = this.playerContact(p, direction);
      if (vertical && hit) return 0;
    }
    const positive = direction === 0x40 || direction === 0x80;
    const offset = vertical ? 2 : 0, size = vertical ? 16 : 20;
    const cell = i16(trunc(((this.s16(p + offset) >> 4) + (positive ? size / 2 : -size / 2)) / size));
    const old = this.s16(p + (vertical ? 8 : 6));
    if (cell === old) return 2;
    const r = vertical ? cell : this.s16(p + 8), c = vertical ? this.s16(p + 6) : cell;
    if (this.canEnter(this.s16(p + 10), r, c, this.s16(p + 0x16))) return 1;
    this.w16(p + offset, vertical ? rowCenter(old) : columnCenter(old));
    return 0;
  }
  resolveUp(p) { return this.resolve(p, 0); }
  resolveRight(p) { return this.resolve(p, 0x40); }
  resolveDown(p) { return this.resolve(p, 0x80); }
  resolveLeft(p) { return this.resolve(p, 0xc0); }
  // 0x8001ea1c / 0x8001ebd0. Automatic perpendicular alignment when turning.
  align(actor, forward, xAxis) {
    forward = i16(forward);
    const pos = actor + (xAxis ? 0x4c : 0x4e);
    const col = this.s16(actor + 0x52), row = this.s16(actor + 0x54), layer = this.s16(actor + 0x56);
    const speed = this.s16(actor + (xAxis ? 0x58 : 0x5a));
    const center = xAxis ? columnCenter(col) : rowCenter(row);
    const delta = i16(center - this.u16(pos));
    if (delta > -speed && delta < speed) {
      if (this.special(layer, row, col) && (this.u16(actor + 0xae) & (xAxis ? 0x50 : 0xa0))) return 0;
      this.w16(pos, center);
      return 0;
    }
    const mask = this.s16(actor + 0x62);
    const r = i16(row + (xAxis ? forward : 0)), c = i16(col + (xAxis ? 0 : forward));
    if (this.canEnter(layer, r, c, mask)) return delta > 0 ? speed : i16(-speed);
    const threshold = xAxis ? 111 : 79;
    if (delta >= -threshold && delta <= threshold) return 0;
    const side = delta > 0 ? -1 : 1;
    if (this.canEnter(layer, i16(r + (xAxis ? 0 : side)), i16(c + (xAxis ? side : 0)), mask)) return i16(side * speed);
    return 0;
  }
  alignX(p, forward) { return this.align(p, forward, true); }
  alignY(p, forward) { return this.align(p, forward, false); }
  // 0x8001ed7c: chooses one axis for diagonal pad input; helper calls can snap.
  chooseAxis(p, rowSign, colSign) {
    if (this.centerErrorX(p + 0x4c) || this.centerErrorY(p + 0x4c)) {
      this.w8(p + 0xd5, this.centerErrorY(p + 0x4c) ? 0 : 1); return 1;
    }
    if (this.u8(p + 0xd5)) {
      if (!this.alignX(p, rowSign)) { this.w8(p + 0xd5, 0); return 1; }
      if (!this.alignY(p, colSign)) { this.w8(p + 0xd5, 1); return 1; }
    } else {
      if (!this.alignY(p, colSign)) { this.w8(p + 0xd5, 1); return 1; }
      if (!this.alignX(p, rowSign)) { this.w8(p + 0xd5, 0); return 1; }
    }
    return 0;
  }
  // 0x8001eef8: complete movement dispatch, including position and facing writes.
  move(p) {
    if (this.s16(p + 0x76)) this.w16(p + 0xae, this.u16(p + 0xae) & 0xffaf);
    if (this.s16(p + 0x78)) this.w16(p + 0xae, this.u16(p + 0xae) & 0xff5f);
    const input = this.u16(p + 0xae) & 0xf0;
    let ax = 0, ay = 0, dx = 0, dy = 0;
    if (input === 0x10 || input === 0x40) {
      const sign = input === 0x10 ? -1 : 1;
      this.w16(p + 0x86, sign < 0 ? 0 : 0x80);
      ax = this.alignX(p, sign); dy = i16(sign * this.u16(p + 0x5a));
    } else if (input === 0x20 || input === 0x80) {
      const sign = input === 0x80 ? -1 : 1;
      this.w16(p + 0x86, sign < 0 ? 0xc0 : 0x40);
      ay = this.alignY(p, sign); dx = i16(sign * this.u16(p + 0x58));
    } else if ([0x30, 0x60, 0x90, 0xc0].includes(input)) {
      const rs = input & 0x10 ? -1 : 1, cs = input & 0x80 ? -1 : 1;
      if (this.chooseAxis(p, rs, cs)) {
        // Original diagonal dispatch passes the *other input component* to the
        // alignment helper (f17c/f194), unlike cardinal movement.
        if (this.u8(p + 0xd5)) { dx = i16(cs * this.u16(p + 0x58)); ay = this.alignY(p, rs); }
        else { dy = i16(rs * this.u16(p + 0x5a)); ax = this.alignX(p, cs); }
      }
    } else this.w16(p + 0x86, this.u16(p + 0x86) | 0x100);
    if (ax) this.w16(p + 0x4c, this.u16(p + 0x4c) + ax);
    else if (dx) {
      this.w16(p + 0x4c, this.u16(p + 0x4c) + dx);
      const facing = dx > 0 ? 0x40 : 0xc0;
      if (this.resolve(p + 0x4c, facing)) this.w16(p + 0x86, facing);
    }
    if (ay) this.w16(p + 0x4e, this.u16(p + 0x4e) + ay);
    else if (dy) {
      this.w16(p + 0x4e, this.u16(p + 0x4e) + dy);
      const facing = dy > 0 ? 0x80 : 0;
      if (this.resolve(p + 0x4c, facing)) this.w16(p + 0x86, facing);
    }
    this.updateCell(p + 0x4c);
  }
}
