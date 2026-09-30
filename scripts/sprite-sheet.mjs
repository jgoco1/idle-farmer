// Renders every sprite (or those whose id starts with a prefix) to scripts/out/sprites.png, on a
// soil-coloured background, for eyeballing art without a browser: `node scripts/sprite-sheet.mjs crop_`.
// Each sprite is scaled ×SCALE; animated sprites show all frames side by side.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const SCALE = 4;
const PER_ROW = Number(process.env.PER_ROW ?? 10);
const prefix = process.argv[2] ?? '';
const soil = process.argv.includes('--soil');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { ALL_SPRITES } = await server.ssrLoadModule('/src/render/sprites/index.ts');
  const { PALETTE, KEY_TO_NAME } = await server.ssrLoadModule('/src/render/palette.ts');
  const soilTile = ALL_SPRITES.find((s) => s.id === 'tile_soil_dry').frames[0];
  const cells = ALL_SPRITES.filter((s) => s.id.startsWith(prefix)).flatMap((s) => s.frames);
  const cellW = 16 * SCALE + 8;
  const cellH = 48 * SCALE + 8;
  const maxH = Math.max(...cells.map((f) => f.length));
  const rowH = Math.min(cellH, maxH * SCALE + 8);
  const W = PER_ROW * cellW * (Math.max(...cells.map((f) => f[0].length)) / 16);
  const H = Math.ceil(cells.length / PER_ROW) * rowH;
  const px = new Uint8Array(W * H * 3).fill(60);
  const hex = (k) => {
    const c = PALETTE[KEY_TO_NAME[k]];
    return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  };
  const cw = W / PER_ROW;
  cells.forEach((rows, n) => {
    const ox = (n % PER_ROW) * cw + 4;
    const oy = Math.floor(n / PER_ROW) * rowH + 4;
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const key = ch === '.' ? (soil ? soilTile[y % 16][x % 16] : null) : ch;
        if (!key) return;
        const [r, g, b] = hex(key);
        for (let dy = 0; dy < SCALE; dy++)
          for (let dx = 0; dx < SCALE; dx++) {
            const i = ((oy + y * SCALE + dy) * W + ox + x * SCALE + dx) * 3;
            px[i] = r;
            px[i + 1] = g;
            px[i + 2] = b;
          }
      }),
    );
  });
  mkdirSync('scripts/out', { recursive: true });
  writeFileSync('scripts/out/sprites.png', png(W, H, px));
  console.log(`scripts/out/sprites.png: ${cells.length} frames`);
} finally {
  await server.close();
}

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
