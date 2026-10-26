// Generates the app icons without any image dependency: solid night background, three
// patch-panel bars and a dot, the Switchboard mark. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
fs.mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x / size, y / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const NIGHT = [11, 16, 32, 255];
const YELLOW = [245, 197, 66, 255];
const MINT = [122, 220, 180, 255];
const CLEAR = [0, 0, 0, 0];

function mark(u, v, scale = 1, background = NIGHT) {
  // Three bars of decreasing width, a dot at the end of the middle bar: a patch panel.
  const cx = (u - 0.5) / scale + 0.5;
  const cy = (v - 0.5) / scale + 0.5;
  const bars = [[0.26, 0.74, 0.30, 0.38], [0.26, 0.60, 0.46, 0.54], [0.26, 0.50, 0.62, 0.70]];
  for (const [x0, x1, y0, y1] of bars) if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) return YELLOW;
  const dx = cx - 0.68, dy = cy - 0.50;
  if (dx * dx + dy * dy <= 0.055 * 0.055) return MINT;
  return background;
}

fs.writeFileSync(path.join(out, 'icon.png'), png(1024, (u, v) => mark(u, v, 1)));
fs.writeFileSync(path.join(out, 'adaptive-icon.png'), png(1024, (u, v) => mark(u, v, 0.66, CLEAR)));
fs.writeFileSync(path.join(out, 'splash-icon.png'), png(512, (u, v) => mark(u, v, 0.8, CLEAR)));
fs.writeFileSync(path.join(out, 'favicon.png'), png(64, (u, v) => mark(u, v, 1)));
console.log(`Icons written to ${out}`);
