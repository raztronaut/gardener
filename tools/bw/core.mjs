// Measured PS1 World helpers. Addresses identify the original executable routines.
// This is an unfinished core, not a playable port. No ROM data is embedded here.
export const GRID = Object.freeze({ address: 0x800cbc80, layers: 2, rows: 30, columns: 64 });
export const PLAYERS = Object.freeze({ address: 0x800cda98, count: 5, stride: 0xdc,
  xOffset: 0x4c, yOffset: 0x4e, columnOffset: 0x52, rowOffset: 0x54, layerOffset: 0x56 });
const i16 = n => (n << 16) >> 16;
// 0x8001ba78 / 0x8001ba9c: world positions have four fractional bits.
export const columnCenter = column => i16(i16(column) * 320 + 160);
export const rowCenter = row => i16(i16(row) * 256 + 128);
// 0x8001bab4. Preserve the original uint16 argument truncation.
export function validCell(layer, row, column) {
  return (layer & 0xffff) < 2 && (row & 0xffff) < 30 && (column & 0xffff) < 64;
}
export function cellOffset(layer, row, column) {
  if (!validCell(layer, row, column)) return null;
  return ((layer & 0xffff) * 30 * 64 + (row & 0xffff) * 64 + (column & 0xffff)) * 2;
}
// 0x8001d354: high nine cell bits, with a distinct out-of-bounds sentinel.
export function cellFlags(grid, layer, row, column) {
  const offset = cellOffset(layer, row, column);
  return offset === null ? 0x7f00 : grid.getUint16(offset, true) & 0xff80;
}
// 0x8001d8c0: original predicate for low-seven-bit types 0x10..0x13.
// The gameplay meaning of these types is not yet asserted.
export function cellType10to13(grid, layer, row, column) {
  const offset = cellOffset(layer, row, column);
  if (offset === null) return 0;
  const type = grid.getUint16(offset, true) & 0x7f;
  return type >= 0x10 && type < 0x14 ? 1 : 0;
}
