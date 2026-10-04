/**
 * The Social app icon as PNG, drawn in plain JavaScript — no image library and
 * no binary file in the repo (the tooling that writes here can only send text).
 * Same drawing as src/app/icon.svg / components/brand/social-mark.tsx, which
 * reproduce Social's official app icon: red outline, white ring, red rounded
 * square split light/dark on the diagonal, white "share" glyph. 64-unit grid.
 */
import { deflateSync } from "node:zlib";

function inRound(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function nearSegment(x, y, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  const px = ax + t * dx, py = ay + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= (w / 2) ** 2;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const OUTLINE = hex("#C8201A");
const RING_A = hex("#FFFFFF"), RING_B = hex("#D5D7D8");
const RED = [hex("#E3382B"), hex("#D02C20"), hex("#BB241A"), hex("#A51D15")];
const GLYPH = hex("#EDEDED");

/** Colour of the icon at (x, y) on the 64 grid, or null outside it. */
function colourAt(x, y) {
  if (!inRound(x, y, 0.6, 0.6, 62.8, 62.8, 27.9)) return null;
  if (!inRound(x, y, 2.4, 2.4, 59.2, 59.2, 26.1)) return OUTLINE;
  if (!inRound(x, y, 6.5, 6.5, 51, 51, 21)) return mix(RING_A, RING_B, (x + y) / 128);
  const glyph =
    (x - 25.5) ** 2 + (y - 32) ** 2 <= 25 ||
    (x - 39) ** 2 + (y - 25) ** 2 <= 27.04 ||
    (x - 39) ** 2 + (y - 39) ** 2 <= 27.04 ||
    nearSegment(x, y, 25.5, 32, 39, 25, 3.8) ||
    nearSegment(x, y, 25.5, 32, 39, 39, 3.8);
  if (glyph) return GLYPH;
  const t = (x - 6.5 + (y - 6.5)) / 102;
  return t < 0.52 ? mix(RED[0], RED[1], t / 0.52) : mix(RED[2], RED[3], (t - 0.52) / 0.48);
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

/** A size×size RGBA PNG of the icon, 4×4 supersampled. */
export function socialIconPng(size) {
  const S = 4;
  const row = size * 4 + 1;
  const raw = Buffer.alloc(size * row);
  for (let py = 0; py < size; py++) {
    raw[py * row] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = colourAt(((px + (sx + 0.5) / S) / size) * 64, ((py + (sy + 0.5) / S) / size) * 64);
          if (!c) continue;
          a++; r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = py * row + 1 + px * 4;
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
