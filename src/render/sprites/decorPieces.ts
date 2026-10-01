// The placed decorations that are not auto-tiled (ART_STYLE.md §6.2, §6.6): one material per set, a 1 px
// `k` outline, light from the top-left and a `K` shadow on the ground. Each is a few shapes on a `Pix`
// canvas; lamps have a day frame and a lit frame, seasonal pieces a sprite for each season that differs.

import { Pix } from './draw';
import { recolored, type SpriteDef } from './types';

/** A 1 px ground shadow under the lowest row of a piece, left to right. */
function groundShadow(p: Pix, x0: number, x1: number, y: number): Pix {
  for (let x = x0; x <= x1; x++) if (p.get(x, y) === '.') p.set(x, y, 'K');
  return p;
}

function def(id: string, frames: string[][], extra: Partial<SpriteDef> = {}): SpriteDef {
  return { id: `decor_${id}`, anchor: 'bottom-center', frames, ...extra };
}

// ---------------------------------------------------------------- Cottage

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

/** The flower bed: a painted box of soil and the season's flowers. */
function flowerBed(season: (typeof SEASONS)[number]): string[] {
  const p = new Pix(32, 16);
  p.rect(2, 8, 28, 6, 'P').hline(2, 8, 28, 'w').hline(2, 13, 28, 'p').vline(29, 8, 6, 'p');
  p.rect(3, 6, 26, 3, 's').hline(3, 6, 26, 'd'); // soil heaped in the box
  const blooms: Record<(typeof SEASONS)[number], [string, string]> = {
    spring: ['i', 'I'],
    summer: ['u', 'o'],
    autumn: ['o', 'v'],
    winter: ['w', 'C'],
  };
  const [a, b] = blooms[season];
  for (let i = 0; i < 6; i++) {
    const x = 4 + i * 4;
    const top = 2 + ((i * 7) % 3);
    if (season === 'winter') {
      // bare twigs with a dusting of snow, and one holly berry
      p.vline(x + 1, top + 2, 4, 'm').set(x, top + 2, 'm').set(x + 2, top + 3, 'm');
      p.set(x + 1, top + 1, 'w').set(x, top + 2, 'w');
      if (i === 2) p.set(x + 1, top + 3, 'q').set(x + 2, top + 4, 'q');
      continue;
    }
    p.vline(x + 1, top + 2, 5, 'l').set(x, top + 4, 'G').set(x + 2, top + 5, 'G');
    const c = i % 2 === 0 ? a : b;
    p.rect(x, top, 3, 2, c).set(x + 1, top - 1, c).set(x + 1, top + 2 > 8 ? 8 : top + 2, c);
    p.set(x + 1, top, season === 'spring' ? 'w' : 'U');
  }
  if (season === 'winter') p.hline(3, 6, 26, 'w').hline(2, 8, 28, 'w');
  const rows = p.outlinedRows();
  const out = new Pix(32, 16).paste(rows, 0, 1).rows();
  const q = new Pix(32, 16).paste(out, 0, 0);
  groundShadow(q, 3, 30, 15);
  return q.rows();
}

function gardenLamp(lit: boolean): string[] {
  const p = new Pix(16, 32);
  p.hline(7, 1, 2, 'n').hline(4, 2, 8, 'N').rect(3, 3, 10, 2, 'n').hline(3, 3, 10, 'N');
  if (lit) p.rect(5, 5, 6, 6, 'a').rect(6, 6, 4, 4, 'U').rect(7, 7, 2, 2, 'w');
  else p.rect(5, 5, 6, 6, 'x').set(5, 5, 'w').hline(5, 10, 6, 'Y').vline(10, 5, 6, 'Y');
  p.vline(4, 5, 6, 'n').vline(11, 5, 6, 'n').rect(4, 11, 8, 2, 'n').hline(4, 11, 8, 'N');
  p.rect(7, 13, 2, 15, 'n').vline(7, 13, 15, 'N');
  p.rect(5, 28, 6, 2, 'n').hline(5, 28, 6, 'N').hline(4, 30, 8, 'n');
  const q = new Pix(16, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 5, 11, 31).rows();
}

const WOODEN_BENCH: string[] = (() => {
  const p = new Pix(32, 16);
  p.rect(3, 2, 26, 2, 'P').hline(3, 2, 26, 'w').hline(3, 3, 26, 'p');
  p.rect(3, 5, 26, 2, 'P').hline(3, 5, 26, 'w').hline(3, 6, 26, 'p');
  p.rect(3, 2, 2, 11, 'M').rect(27, 2, 2, 11, 'M'); // the back posts
  p.rect(1, 8, 30, 3, 'P').hline(1, 8, 30, 'w').hline(1, 10, 30, 'M');
  p.rect(3, 11, 2, 2, 'm').rect(27, 11, 2, 2, 'm');
  const q = new Pix(32, 16).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 3, 29, 15).rows();
})();

const BIRDBATH: string[] = [
  '................',
  '................',
  '................',
  '....kkkkkkkk....',
  '...kNwwNNNNnk...',
  '..kNnBBBBBBnnk..',
  '..kNnBcBBcBnnk..',
  '..kknBBBBBBnkk..',
  '...kknnnnnnkk...',
  '....kkknnkkk....',
  '.......kNnk.....',
  '.......kNnk.....',
  '......kNNnnk....',
  '.....kNNNNnnk...',
  '.....kkkkkkkk...',
  '......KKKKKK....',
];

const ROSE_ARCH: string[] = (() => {
  const p = new Pix(32, 32);
  p.rect(3, 12, 3, 17, 'P').vline(3, 12, 17, 'w').vline(5, 12, 17, 'p');
  p.rect(26, 12, 3, 17, 'P').vline(26, 12, 17, 'w').vline(28, 12, 17, 'p');
  for (let x = 3; x <= 28; x++) {
    const y = Math.round(10 - 7 * Math.sin((Math.PI * (x - 3)) / 25));
    p.set(x, y, 'P').set(x, y + 1, 'p');
  }
  // vines and roses
  for (let x = 3; x <= 28; x += 2) {
    const y = Math.round(10 - 7 * Math.sin((Math.PI * (x - 3)) / 25));
    p.set(x, y - 1, 'l').set(x + 1, y, 'L').set(x, y + 2, 'h');
  }
  for (const [x, y] of [
    [7, 6],
    [13, 3],
    [19, 3],
    [24, 6],
    [4, 14],
    [27, 17],
    [4, 21],
    [27, 11],
  ] as const) {
    p.rect(x, y, 2, 2, 'q').set(x, y, 'Q');
    p.set(x + 2, y + 1, 'L').set(x - 1, y + 1, 'l');
  }
  for (const x of [3, 5, 26, 28]) for (const y of [16, 19, 24]) p.set(x, y, 'l');
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 1);
  return groundShadow(q, 3, 28, 31).rows();
})();

// ---------------------------------------------------------------- Seaside

function sandcastle(winter: boolean): string[] {
  const p = new Pix(16, 16);
  p.ellipse(7.5, 12, 7, 2, 'y');
  p.rect(2, 7, 4, 6, 'y').rect(10, 6, 4, 7, 'y').rect(5, 9, 6, 4, 'y');
  for (const x of [2, 4, 10, 12]) p.set(x, x < 8 ? 6 : 5, 'y'); // crenellations
  p.vline(2, 7, 6, 'x').vline(10, 6, 7, 'x').hline(5, 9, 6, 'x');
  p.vline(5, 7, 6, 'Y').vline(13, 6, 7, 'Y').hline(5, 12, 6, 'Y').hline(2, 13, 12, 'Y');
  p.set(7, 10, 'Y').set(8, 10, 'Y').set(7, 11, 'Y').set(8, 11, 'Y'); // the gate
  p.vline(12, 2, 3, 'm').set(13, 2, 'q').set(13, 3, 'q'); // a flag
  let rows = new Pix(16, 16).paste(p.outlinedRows(), 0, 0).rows();
  if (winter) rows = recolored(rows, { y: 'w', x: 'w', Y: 'C' });
  return groundShadow(new Pix(16, 16).paste(rows, 0, 0), 2, 13, 15).rows();
}

const LOBSTER_POTS: string[] = (() => {
  const p = new Pix(16, 16);
  // a big wicker pot behind, a smaller one in front, and a coil of rope
  p.ellipse(5.5, 8, 5, 4, 'p').rect(1, 8, 9, 4, 'p');
  p.ellipse(5.5, 8, 5, 4, 'p');
  for (let x = 1; x <= 10; x += 3) p.vline(x, 4, 9, 'M');
  for (let y = 5; y <= 11; y += 3) p.hline(1, y, 10, 'M');
  p.hline(3, 5, 5, 'P');
  p.rect(9, 9, 6, 4, 'p').hline(9, 9, 6, 'P').hline(9, 12, 6, 'M');
  p.vline(11, 9, 4, 'M').vline(13, 9, 4, 'M');
  p.ellipse(11.5, 6, 2, 1, 'y').set(10, 6, 'Y').set(13, 6, 'Y');
  p.hline(3, 12, 5, 'M');
  const q = new Pix(16, 16).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 1, 14, 15).rows();
})();

const DECK_CHAIR: string[] = (() => {
  const p = new Pix(16, 16);
  // a folding frame with a striped canvas back and seat
  p.line(3, 3, 6, 11, 'M').line(4, 3, 7, 11, 'p');
  for (let i = 0; i < 6; i++) {
    const y = 2 + i * 2;
    const x = 3 + Math.floor((i * 3) / 2);
    p.hline(x, y, 6, i % 2 === 0 ? 'J' : 'w').hline(x, y + 1, 6, i % 2 === 0 ? 'j' : 'x');
  }
  p.hline(6, 11, 8, 'J').hline(6, 12, 8, 'j');
  p.line(5, 13, 3, 13, 'M').hline(11, 13, 3, 'M').line(11, 12, 13, 13, 'p');
  const q = new Pix(16, 16).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 2, 14, 15).rows();
})();

const BEACH_UMBRELLA: string[] = (() => {
  const p = new Pix(16, 32);
  p.ellipse(7.5, 8, 7, 5, 'q');
  for (let x = 1; x <= 14; x++) {
    if (Math.floor((x - 1) / 3) % 2 === 1) for (let y = 3; y <= 12; y++) if (p.get(x, y) === 'q') p.set(x, y, 'w');
  }
  p.rect(1, 12, 14, 1, 'q').hline(1, 12, 14, 'r');
  p.hline(4, 4, 4, 'Q');
  p.vline(8, 13, 17, 'M').vline(7, 13, 17, 'P');
  p.set(8, 2, 'f').set(8, 1, 'F');
  p.ellipse(7.5, 29, 5, 1.5, 'y').hline(3, 29, 10, 'Y');
  const q = new Pix(16, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 2, 13, 31).rows();
})();

function harbourLamp(lit: boolean): string[] {
  const p = new Pix(16, 32);
  p.set(7, 1, 'A').set(8, 1, 'A').hline(5, 2, 6, 'A').hline(4, 3, 8, 'n').hline(4, 4, 8, 'A');
  if (lit) p.rect(5, 5, 6, 6, 'a').rect(6, 6, 4, 4, 'U').rect(7, 7, 2, 2, 'w');
  else p.rect(5, 5, 6, 6, 'c').set(5, 5, 'C').rect(6, 6, 4, 4, 'B').vline(10, 5, 6, 'b');
  p.vline(4, 5, 6, 'A').vline(11, 5, 6, 'A').vline(7, 5, 6, 'A').vline(8, 5, 6, 'A');
  if (lit) p.rect(5, 5, 2, 6, 'a').rect(9, 5, 2, 6, 'a').rect(7, 5, 2, 6, 'U').hline(7, 8, 2, 'w');
  p.rect(4, 11, 8, 2, 'A').hline(4, 11, 8, 'n');
  p.rect(7, 13, 2, 14, 'A').vline(7, 13, 14, 'n');
  p.rect(5, 24, 6, 1, 'n').line(6, 25, 4, 29, 'A').line(9, 25, 11, 29, 'A');
  p.hline(3, 29, 10, 'A').hline(3, 30, 10, 'n');
  const q = new Pix(16, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 3, 13, 31).rows();
}

const ROWBOAT: string[] = (() => {
  const p = new Pix(32, 16);
  // a clinker hull, its inside, a bench and an oar laid across
  p.ellipse(15.5, 10, 14, 4, 'J');
  p.rect(2, 7, 28, 4, 'J');
  p.ellipse(15.5, 8, 12, 2, 'P'); // the inside, seen from above and in front
  p.hline(3, 11, 26, 'j').hline(5, 12, 22, 'j').hline(3, 10, 26, 'w').hline(2, 9, 28, 'J');
  p.rect(9, 6, 3, 4, 'p').rect(20, 6, 3, 4, 'p'); // two thwarts
  p.line(6, 3, 24, 9, 'M').line(6, 4, 24, 10, 'p'); // the oar
  p.set(5, 2, 'M').set(6, 2, 'M').rect(24, 9, 3, 2, 'p');
  const q = new Pix(32, 16).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 3, 28, 15).rows();
})();

const DRIFTWOOD_ARCH: string[] = (() => {
  const p = new Pix(32, 32);
  const legs = (x: number, w: number): void => {
    p.rect(x, 12, w, 17, 'N').vline(x, 12, 17, 'x').vline(x + w - 1, 12, 17, 'Y');
    for (const y of [16, 22, 26]) p.set(x + 1, y, 'n');
  };
  legs(3, 4);
  legs(25, 4);
  for (let x = 3; x <= 28; x++) {
    const y = Math.round(11 - 8 * Math.sin((Math.PI * (x - 3)) / 25));
    p.rect(x, y, 1, 3, x % 5 === 0 ? 'x' : 'N').set(x, y + 2, 'Y');
  }
  p.rect(13, 3, 7, 2, 'x'); // a knot of bleached wood at the top
  // shells and a bit of rope
  p.rect(8, 8, 2, 2, 'I').set(8, 8, 'w').rect(23, 8, 2, 2, 'w').set(24, 9, 'i');
  p.vline(5, 15, 6, 'y').vline(26, 15, 6, 'y').set(6, 21, 'Y').set(27, 21, 'Y');
  p.rect(3, 29, 4, 1, 'y').rect(25, 29, 4, 1, 'y');
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 3, 28, 31).rows();
})();

const SHIP_FIGUREHEAD: string[] = (() => {
  const p = new Pix(32, 32);
  // a stone plinth, a curved timber post and a carved lady leaning into the wind
  p.rect(5, 26, 22, 4, 'N').hline(5, 26, 22, 'w').hline(5, 29, 22, 'n');
  p.rect(8, 22, 16, 4, 'N').hline(8, 22, 16, 'w').hline(8, 25, 16, 'n');
  p.rect(11, 12, 10, 10, 'M').vline(11, 12, 10, 'p').vline(20, 12, 10, 'm');
  for (let y = 12; y <= 21; y += 3) p.hline(12, y, 8, 'm');
  p.line(15, 12, 21, 5, 'M').line(16, 12, 22, 5, 'p').line(17, 12, 23, 6, 'M'); // the bow rising
  p.ellipse(22.5, 6, 3, 3, 'I'); // her face
  p.set(21, 5, 'k').set(23, 5, 'k').set(22, 7, 'q');
  p.rect(17, 2, 5, 3, 'O').rect(17, 3, 3, 5, 'o').rect(24, 4, 2, 9, 'o'); // hair streaming
  p.rect(16, 7, 5, 8, 'J').rect(17, 8, 3, 3, 'j'); // her gown
  p.line(13, 14, 11, 20, 'J'); // trailing cloth
  p.hline(9, 21, 4, 'u'); // gilded trim
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 5, 26, 31).rows();
})();

// ---------------------------------------------------------------- Harvest Fair

const STRAW_BALE: string[] = (() => {
  const p = new Pix(16, 16);
  p.ellipse(7.5, 8.5, 6.5, 6, 'U');
  p.ellipse(7.5, 8.5, 4.5, 4, 'u');
  p.ellipse(7.5, 8.5, 2.5, 2, 'U');
  p.set(7, 8, 'Y').set(8, 8, 'Y');
  p.ellipse(7.5, 8.5, 4.5, 4, 'u');
  p.ellipse(7.5, 8.5, 2.5, 2, 'U').set(7, 8, 'Y').set(8, 9, 'Y');
  // twine
  p.vline(4, 3, 11, 'M').vline(11, 3, 11, 'M');
  p.hline(3, 5, 3, 'Y').hline(9, 11, 4, 'Y').hline(9, 3, 3, 'Y');
  const q = new Pix(16, 16).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 2, 13, 15).rows();
})();

function pumpkinStack(snow: boolean): string[] {
  const p = new Pix(16, 16);
  const pump = (cx: number, cy: number, rx: number, ry: number): void => {
    p.ellipse(cx, cy, rx, ry, 'o');
    p.ellipse(cx - 0.8, cy, rx / 2, ry - 0.5, 'O');
    p.vline(Math.round(cx), Math.round(cy - ry), Math.round(ry * 2), 'q');
    p.vline(Math.round(cx - rx / 2) - 1, Math.round(cy - ry + 1), Math.round(ry * 2) - 2, 'q');
    p.vline(Math.round(cx + rx / 2) + 1, Math.round(cy - ry + 1), Math.round(ry * 2) - 2, 'q');
    p.set(Math.round(cx), Math.round(cy - ry) - 1, 'l').set(Math.round(cx) + 1, Math.round(cy - ry) - 1, 'l');
  };
  pump(4.5, 11, 4, 3);
  pump(11.5, 11, 4, 3);
  pump(8, 6, 3.5, 3);
  let rows = new Pix(16, 16).paste(p.outlinedRows(), 0, 0).rows();
  if (snow) {
    const s = new Pix(16, 16).paste(rows, 0, 0);
    for (const [x, y] of [
      [6, 3],
      [7, 3],
      [8, 3],
      [9, 3],
      [3, 8],
      [4, 8],
      [5, 8],
      [10, 8],
      [11, 8],
      [12, 8],
      [7, 4],
    ] as const)
      if (s.get(x, y) !== '.' && s.get(x, y) !== 'k') s.set(x, y, 'w');
    rows = s.rows();
  }
  return groundShadow(new Pix(16, 16).paste(rows, 0, 0), 1, 14, 15).rows();
}

const SUNFLOWER_PATCH: string[] = (() => {
  const p = new Pix(32, 32);
  p.rect(1, 25, 30, 5, 's').hline(1, 25, 30, 'S');
  const heads: [number, number][] = [
    [5, 7],
    [11, 4],
    [17, 8],
    [23, 5],
    [28, 10],
  ];
  for (const [x, y] of heads) {
    p.vline(x, y + 3, 22 - y, 'l');
    p.set(x - 1, y + 12, 'G').set(x - 2, y + 11, 'G').set(x + 1, y + 15, 'G').set(x + 2, y + 14, 'G');
    p.ellipse(x, y, 3, 3, 'u');
    p.rect(x - 4, y, 9, 1, 'u').vline(x, y - 4, 9, 'u');
    p.ellipse(x, y, 1.5, 1.5, 'm').set(x, y, 'd');
    p.set(x - 1, y - 1, 'U');
  }
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 1, 30, 31).rows();
})();

function lanternString(lit: boolean): string[] {
  const p = new Pix(32, 32);
  p.rect(2, 8, 3, 22, 'M').vline(2, 8, 22, 'p');
  p.rect(27, 8, 3, 22, 'M').vline(27, 8, 22, 'p');
  p.rect(2, 7, 3, 1, 'm').rect(27, 7, 3, 1, 'm');
  for (let x = 5; x <= 26; x++) p.set(x, 9 + Math.round(2 * Math.sin((Math.PI * (x - 5)) / 21)), 'm');
  const colours: [string, string][] = [
    ['q', 'Q'],
    ['o', 'O'],
    ['u', 'U'],
    ['q', 'Q'],
  ];
  [8, 13, 18, 23].forEach((x, i) => {
    const y0 = 11 + Math.round(2 * Math.sin((Math.PI * (x - 5)) / 21));
    const [c, hi] = colours[i]!;
    p.set(x + 1, y0, 'm').set(x + 1, y0 + 1, 'm');
    p.rect(x, y0 + 2, 3, 5, lit ? 'a' : c).set(x, y0 + 2, lit ? 'U' : hi);
    if (lit) p.set(x + 1, y0 + 4, 'w');
    p.hline(x, y0 + 7, 3, 'm');
  });
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 2, 29, 31).rows();
}

const APPLE_CART: string[] = (() => {
  const p = new Pix(32, 16);
  p.ellipse(15.5, 5, 11, 4, 'q');
  for (const [x, y] of [
    [8, 3],
    [12, 2],
    [17, 2],
    [22, 3],
    [10, 5],
    [15, 4],
    [20, 5],
  ] as const) {
    p.rect(x, y, 3, 3, 'q').set(x, y, 'Q').set(x + 2, y + 2, 'r');
  }
  p.rect(5, 8, 22, 4, 'M').hline(5, 8, 22, 'P').hline(5, 11, 22, 'm').vline(5, 8, 4, 'p');
  p.hline(5, 10, 22, 'p');
  p.line(26, 9, 31, 11, 'M').line(26, 10, 31, 12, 'p'); // the handles
  p.ellipse(10.5, 12, 3, 3, 'm').ellipse(10.5, 12, 1, 1, 'p'); // the wheel
  p.set(10, 12, 'P');
  const q = new Pix(32, 16).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 5, 30, 15).rows();
})();

const STONE_WELL: string[] = (() => {
  const p = new Pix(32, 32);
  p.ellipse(15.5, 23, 12, 5, 'N');
  p.rect(4, 19, 24, 6, 'N');
  p.ellipse(15.5, 19, 12, 4, 'N').ellipse(15.5, 19, 9, 2.5, 'b').ellipse(15.5, 19, 7, 1.5, 'B');
  p.hline(4, 23, 24, 'n').hline(5, 24, 22, 'n').hline(6, 25, 20, 'n');
  for (const x of [8, 14, 20]) p.vline(x, 21, 3, 'n');
  for (const x of [10, 17, 24]) p.vline(x, 23, 2, 'n');
  p.rect(5, 8, 2, 14, 'M').rect(25, 8, 2, 14, 'M').vline(5, 8, 14, 'p'); // the posts
  p.rect(4, 3, 24, 2, 'r'); // the little roof
  for (let i = 0; i < 4; i++) p.hline(5 + i, 5 + i, 22 - i * 2, i % 2 === 0 ? 'R' : 'r');
  p.hline(4, 3, 24, 'R').hline(8, 1, 16, 'r').hline(6, 2, 20, 'R');
  p.vline(15, 9, 6, 'm').rect(14, 15, 4, 3, 'p').hline(14, 15, 4, 'P'); // rope and bucket
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 4, 27, 31).rows();
})();

const FAIR_STALL: string[] = (() => {
  const p = new Pix(32, 32);
  p.rect(3, 12, 2, 18, 'M').rect(27, 12, 2, 18, 'M').vline(3, 12, 18, 'p');
  // the striped awning
  for (let x = 1; x <= 30; x++) {
    const c = Math.floor((x - 1) / 3) % 2 === 0 ? 'q' : 'w';
    p.rect(x, 4, 1, 7, c);
    p.set(x, 11, c === 'q' ? 'r' : 'x').set(x, 12, c === 'q' ? 'q' : 'w');
  }
  p.hline(1, 4, 30, 'Q').hline(2, 3, 28, 'r');
  p.set(1, 12, '.').set(30, 12, '.');
  // the counter and its jars
  p.rect(2, 22, 28, 8, 'P').hline(2, 22, 28, 'w').hline(2, 29, 28, 'p').rect(2, 24, 28, 1, 'p');
  for (const [x, c] of [
    [6, 'v'],
    [11, 'o'],
    [16, 'u'],
    [21, 'q'],
  ] as const) {
    p.rect(x, 17, 4, 5, c).set(x, 17, 'w').hline(x, 16, 4, 'k').hline(x, 16, 4, 'M');
  }
  p.rect(25, 18, 4, 4, 'f').hline(25, 18, 4, 'U');
  const q = new Pix(32, 32).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 2, 29, 31).rows();
})();

const WINDMILL: string[] = (() => {
  const p = new Pix(32, 64);
  // a tapering tower: brick below, whitewashed above, a dark cap and a hub for the sails
  for (let y = 18; y <= 58; y++) {
    const half = 9 - Math.floor((58 - y) / 9) + 3;
    const x0 = 16 - half;
    const w = half * 2;
    const brickBand = y >= 42;
    p.rect(x0, y, w, 1, brickBand ? 'R' : 'x');
    p.set(x0, y, brickBand ? 'Q' : 'w').set(x0 + w - 1, y, brickBand ? 'r' : 'Y');
    if (brickBand && y % 3 === 0) p.hline(x0 + 1, y, w - 2, 'r');
  }
  p.rect(5, 58, 22, 2, 'n').hline(5, 58, 22, 'N');
  for (let y = 11; y <= 18; y++) p.hline(16 - (y - 8), y, (y - 8) * 2, y < 14 ? 'm' : 'M');
  p.hline(9, 18, 14, 'p').hline(10, 10, 12, 'M').hline(12, 9, 8, 'M').hline(14, 8, 4, 'p');
  p.rect(14, 51, 5, 8, 'm').hline(14, 51, 5, 'M').set(17, 55, 'f'); // the door
  p.rect(13, 31, 6, 5, 'c').frame(13, 31, 6, 5, 'm').vline(16, 31, 5, 'm'); // a window
  p.rect(13, 42, 6, 4, 'c').frame(13, 42, 6, 4, 'm');
  p.ellipse(15.5, 15, 3, 3, 'M').ellipse(15.5, 15, 1.5, 1.5, 'p'); // the hub
  const q = new Pix(32, 64).paste(p.outlinedRows(), 0, 0);
  return groundShadow(q, 5, 26, 63).rows();
})();

/** The windmill's sails: a cross, then a saltire; the renderer draws them over the hub, turning in two frames. */
function sails(saltire: boolean): string[] {
  const p = new Pix(32, 32);
  const arms: [number, number][] = saltire
    ? [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]
    : [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
  for (const [dx, dy] of arms) {
    for (let i = 3; i <= 14; i++) {
      const x = 16 + dx * i;
      const y = 16 + dy * i;
      p.set(x, y, 'M');
      if (i >= 5) {
        // the lattice of the blade, one side of the arm
        const sx = dy !== 0 && dx === 0 ? 1 : dx !== 0 && dy === 0 ? 0 : 1;
        const sy = dx !== 0 && dy === 0 ? 1 : dy !== 0 && dx === 0 ? 0 : -1;
        p.set(x + sx, y + sy, 'P').set(x + sx * 2, y + sy * 2, i % 2 === 0 ? 'p' : 'P');
      }
    }
  }
  p.rect(15, 15, 3, 3, 'm');
  return new Pix(32, 32).paste(p.outlinedRows(), 0, 0).rows();
}

export const DECOR_PIECE_SPRITES: readonly SpriteDef[] = [
  // Cottage
  def('flower_bed', [flowerBed('summer')]),
  ...SEASONS.map((s) => def(`flower_bed_${s}`, [flowerBed(s)])),
  def('garden_lamp', [gardenLamp(false), gardenLamp(true)], { lit: true }),
  def('wooden_bench', [WOODEN_BENCH]),
  def('birdbath', [BIRDBATH]),
  def('rose_arch', [ROSE_ARCH]),
  // Seaside
  def('sandcastle', [sandcastle(false)]),
  def('sandcastle_winter', [sandcastle(true)]),
  def('lobster_pots', [LOBSTER_POTS]),
  def('deck_chair', [DECK_CHAIR]),
  def('beach_umbrella', [BEACH_UMBRELLA]),
  def('harbour_lamp', [harbourLamp(false), harbourLamp(true)], { lit: true }),
  def('rowboat', [ROWBOAT]),
  def('driftwood_arch', [DRIFTWOOD_ARCH]),
  def('ship_figurehead', [SHIP_FIGUREHEAD]),
  // Harvest Fair
  def('straw_bale', [STRAW_BALE]),
  def('pumpkin_stack', [pumpkinStack(false)]),
  def('pumpkin_stack_winter', [pumpkinStack(true)]),
  def('sunflower_patch', [SUNFLOWER_PATCH]),
  def('lantern_string', [lanternString(false), lanternString(true)], { lit: true }),
  def('apple_cart', [APPLE_CART]),
  def('stone_well', [STONE_WELL]),
  def('fair_stall', [FAIR_STALL]),
  def('windmill', [WINDMILL]),
  { id: 'decor_windmill_sails', anchor: 'bottom-center', frameMs: 1200, frames: [sails(false), sails(true)] },
];
