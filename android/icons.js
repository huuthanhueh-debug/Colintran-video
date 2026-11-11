'use strict';
// Generates the launcher icons at build time so no binary lives in the repo. Pure Node: a
// tiny PNG encoder (zlib + CRC32) draws a rounded orange square with a white gate glyph.
const zlib = require('zlib');

const BG = [0xc9, 0x64, 0x42]; // PromptGate orange, same as the panel's primary button
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Coverage of pixel (x, y) by the icon shape, 0..1, via 4x4 supersampling.
// Shape: rounded square background; glyph = two pillars and a lintel (a gate).
function sample(size, x, y) {
  const r = size * 0.22;
  const inSquare = (px, py) => {
    const cx = Math.min(Math.max(px, r), size - r);
    const cy = Math.min(Math.max(py, r), size - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
  const inGlyph = (px, py) => {
    const u = px / size, v = py / size;
    const pillar = v >= 0.30 && v <= 0.78 && ((u >= 0.26 && u <= 0.40) || (u >= 0.60 && u <= 0.74));
    const lintel = v >= 0.22 && v <= 0.34 && u >= 0.20 && u <= 0.80;
    return pillar || lintel;
  };
  let bg = 0, fg = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const px = x + (i + 0.5) / 4, py = y + (j + 0.5) / 4;
    if (inSquare(px, py)) { bg++; if (inGlyph(px, py)) fg++; }
  }
  return { bg: bg / 16, fg: fg / 16 };
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const { bg, fg } = sample(size, x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const t = bg > 0 ? fg / bg : 0;
      raw[o] = Math.round(BG[0] + (FG[0] - BG[0]) * t);
      raw[o + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * t);
      raw[o + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * t);
      raw[o + 3] = Math.round(255 * bg);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIZES = [16, 32, 48, 128];
module.exports = { png, SIZES };
