/**
 * The Social mark as PNG, drawn in plain JavaScript — no image library and no
 * binary file in the repo (the tooling that writes here can only send text).
 * Same drawing as src/app/icon.svg / components/brand/social-mark.tsx:
 * a red rounded square with a white "share" glyph (three dots, two links),
 * on a 64-unit grid.
 */
import { deflateSync } from "node:zlib";

const TOP = [0xfe, 0x1b, 0x04]; // #FE1B04
const BOTTOM = [0xb3, 0x12, 0x0a]; // #B3120A

function insideRoundRect(x, y) {
  const r = 15;
  if (x < 0 || y < 0 || x > 64 || y > 64) return false;
  const cx = x < r ? r : x > 64 - r ? 64 - r : x;
  const cy = y < r ? r : y > 64 - r ? 64 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function nearSegment(x, y, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  const px = ax + t * dx, py = ay + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= (w / 2) ** 2;
}

function isWhite(x, y) {
  return (
    (x - 21) ** 2 + (y - 32) ** 2 <= 64 ||
    (x - 43) ** 2 + (y - 19) ** 2 <= 49 ||
    (x - 43) ** 2 + (y - 45) ** 2 <= 49 ||
    nearSegment(x, y, 21, 32, 43, 19, 5) ||
    nearSegment(x, y, 21, 32, 43, 45, 5)
  );
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A size×size RGBA PNG of the mark, 4×4 supersampled. */
export function socialIconPng(size) {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 64;
          const y = ((py + (sy + 0.5) / S) / size) * 64;
          if (!insideRoundRect(x, y)) continue;
          a += 1;
          if (isWhite(x, y)) { r += 255; g += 255; b += 255; continue; }
          const t = (x + y) / 128;
          r += TOP[0] + (BOTTOM[0] - TOP[0]) * t;
          g += TOP[1] + (BOTTOM[1] - TOP[1]) * t;
          b += TOP[2] + (BOTTOM[2] - TOP[2]) * t;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a) {
        raw[o] = Math.round(r / a);
        raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a);
      }
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
