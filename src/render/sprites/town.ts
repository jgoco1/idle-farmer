// The town's building sites at each stage (ART_STYLE.md §6.2, GDD §12.2): `obj_<project>_<n>`, where 0 is the
// ruin and n the state after stage n. Each is the site's size in tiles plus one tile of height, drawn as shapes
// on a `Pix` canvas. They sit with their bottom edge on the bottom of the site (see `townSpritePos`). The
// fountain's water has two frames; the lighthouse's beam, the bakery's smoke and the band are drawn by the
// renderer (glow, particles and `fx_band`), not here.

import type { TownProjectId } from '../../data/ids';
import { Pix } from './draw';
import type { SpriteDef } from './types';

/** Running-bond stone blocks, a light edge on the top and left of each. */
function blocks(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  base = 'N',
  mortar = 'n',
  light = 'w',
): void {
  p.rect(x, y, w, h, base);
  for (let j = 0; j < h; j++) {
    const row = Math.floor(j / 4);
    const off = (row % 2) * 3;
    if (j % 4 === 3) p.hline(x, y + j, w, mortar);
    else
      for (let i = 0; i < w; i++)
        if ((i + off) % 6 === 5) p.set(x + i, y + j, mortar);
        else if (j % 4 === 0 && (i + off) % 6 === 0 && (i + row) % 3 === 0) p.set(x + i, y + j, light);
  }
}

/** A pitched roof of shingles: a trapezoid from `x` (wide eaves, width `w`) at `y + h` up to a narrow ridge at `y`. */
function roof(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  light: string,
  mid: string,
  dark: string,
  ridgeW = 6,
): void {
  for (let j = 0; j < h; j++) {
    const t = j / Math.max(1, h - 1);
    const inset = Math.round((1 - t) * ((w - ridgeW) / 2));
    const rowW = w - inset * 2;
    p.hline(x + inset, y + j, rowW, j % 3 === 2 ? dark : mid);
    if (j % 3 === 0) for (let i = 0; i < rowW; i += 4) p.set(x + inset + i, y + j, light);
  }
  p.hline(x, y + h - 1, w, dark);
}

function weeds(p: Pix, xs: number[], y: number): void {
  for (const x of xs)
    p.set(x, y, 'g')
      .set(x + 1, y - 1, 'G')
      .set(x + 2, y, 'g')
      .set(x + 1, y, 'h');
}

function shadowRow(p: Pix, x0: number, x1: number, y: number): Pix {
  for (let x = x0; x <= x1; x++) if (p.get(x, y) === '.') p.set(x, y, 'K');
  return p;
}

function finish(p: Pix, groundY: number, x0: number, x1: number): string[] {
  const out = new Pix(p.w, p.h).paste(p.outlinedRows(), 0, 0);
  return shadowRow(out, x0, x1, groundY).rows();
}

// ---------------------------------------------------------------- Bakery (3 × 3, 48 × 64)

function bakery(stage: number): string[] {
  const p = new Pix(48, 64);
  if (stage === 0) {
    // rubble of an old bakery: a ragged stub of wall, fallen blocks and a broken beam
    blocks(p, 5, 52, 38, 8);
    for (const [x, h] of [
      [5, 3],
      [9, 6],
      [14, 2],
      [19, 5],
      [30, 4],
      [36, 7],
    ] as const)
      blocks(p, x, 52 - h, 5, h);
    blocks(p, 4, 30, 7, 24);
    p.set(5, 29, 'N').set(6, 28, 'N').set(8, 29, 'n');
    p.line(14, 47, 26, 41, 'M').line(14, 48, 26, 42, 'p');
    p.rect(30, 56, 5, 3, 'N').rect(37, 57, 4, 2, 'n').rect(21, 57, 3, 2, 'N');
    weeds(p, [7, 17, 27, 38], 61);
    return finish(p, 63, 4, 44);
  }
  blocks(p, 3, 54, 42, 7);
  if (stage === 1) {
    // the timber frame goes up
    for (const x of [4, 17, 29, 41]) p.rect(x, 24, 3, 30, 'M').vline(x, 24, 30, 'p');
    p.rect(3, 24, 42, 3, 'M').hline(3, 24, 42, 'p').rect(3, 40, 42, 2, 'M').hline(3, 40, 42, 'p');
    p.line(7, 40, 17, 27, 'm').line(32, 27, 41, 40, 'm');
    for (const [x0, x1] of [
      [4, 24],
      [24, 44],
    ] as const) {
      p.line(x0, 24, (x0 + x1) / 2, 8, 'M');
    }
    p.line(4, 25, 24, 9, 'p').line(24, 9, 44, 25, 'p').line(5, 24, 24, 8, 'M').line(24, 8, 43, 24, 'M');
    p.vline(24, 8, 17, 'M');
    p.rect(44, 36, 2, 24, 'p').hline(44, 40, 2, 'M').hline(44, 46, 2, 'M').hline(44, 52, 2, 'M'); // a ladder
    return finish(p, 63, 3, 46);
  }
  // walls and roof
  p.rect(4, 34, 40, 20, 'x').hline(4, 34, 40, 'w').vline(4, 34, 20, 'w').vline(43, 34, 20, 'Y');
  for (const x of [4, 21, 40]) p.rect(x, 34, 3, 20, 'M').vline(x, 34, 20, 'p');
  p.hline(4, 44, 40, 'M');
  p.rect(18, 42, 11, 12, 'm').hline(18, 42, 11, 'M'); // the doorway
  p.rect(7, 38, 8, 8, 'c').frame(7, 38, 8, 8, 'M').vline(11, 38, 8, 'M');
  p.rect(33, 38, 8, 8, 'c').frame(33, 38, 8, 8, 'M').vline(37, 38, 8, 'M');
  roof(p, 1, 12, 46, 22, 'Q', 'R', 'r', 8);
  if (stage === 3) {
    p.rect(31, 8, 6, 15, 'N')
      .vline(31, 8, 15, 'w')
      .vline(36, 8, 15, 'n')
      .rect(30, 7, 8, 2, 'n')
      .hline(30, 7, 8, 'N');
    p.rect(18, 42, 11, 12, 'M').hline(18, 42, 11, 'p').vline(23, 42, 12, 'm').set(26, 48, 'f'); // a real door
    p.rect(7, 38, 8, 8, 'U').frame(7, 38, 8, 8, 'M').vline(11, 38, 8, 'M').hline(7, 41, 8, 'M');
    p.rect(33, 38, 8, 8, 'U').frame(33, 38, 8, 8, 'M').vline(37, 38, 8, 'M').hline(33, 41, 8, 'M');
    p.rect(5, 46, 10, 2, 'M').rect(6, 45, 8, 1, 'i').rect(33, 46, 10, 2, 'M').rect(34, 45, 8, 1, 'u'); // flower boxes
    // a striped awning over the door and a hanging bread sign
    for (let i = 0; i < 13; i++)
      p.hline(17 + i, 40, 1, i % 2 === 0 ? 'q' : 'w').hline(17 + i, 41, 1, i % 2 === 0 ? 'r' : 'x');
    p.hline(1, 33, 46, 'r');
    p.rect(1, 50, 5, 5, 'M').ellipse(3.5, 52, 2, 1.2, 'o');
  } else {
    p.rect(18, 42, 11, 12, 'm').hline(18, 42, 11, 'M');
  }
  return finish(p, 63, 3, 46);
}

// ---------------------------------------------------------------- Fountain (3 × 3, 48 × 64)

function fountain(stage: number, frame: number): string[] {
  const p = new Pix(48, 64);
  p.ellipse(23.5, 52, 21, 9, 'N');
  p.rect(3, 50, 41, 8, 'N');
  p.ellipse(23.5, 50, 21, 8.5, 'N');
  p.hline(5, 58, 38, 'n').hline(7, 59, 34, 'n').hline(10, 60, 28, 'n');
  for (const x of [8, 16, 24, 32, 40]) p.vline(x, 55, 3, 'n');
  if (stage === 0) {
    p.ellipse(23.5, 50, 17, 6, 'y');
    p.ellipse(23.5, 50, 14, 4, 'Y');
    p.line(10, 48, 18, 52, 'n').line(30, 47, 36, 52, 'n').line(20, 54, 22, 56, 'n');
    blocks(p, 20, 38, 8, 12, 'n', 'k', 'N');
    p.set(20, 37, 'n').set(23, 36, 'n');
    weeds(p, [11, 33, 38], 52);
    for (const [x, y] of [
      [6, 50],
      [41, 51],
    ] as const)
      p.set(x, y, 'k').set(x + 1, y + 1, 'n');
    return finish(p, 63, 3, 44);
  }
  p.ellipse(23.5, 50, 17, 6, stage >= 2 ? 'b' : 'y');
  if (stage >= 2) {
    p.ellipse(23.5, 50, 15, 5, 'B');
    const ripple =
      frame === 0
        ? [
            [12, 50],
            [28, 53],
            [34, 48],
          ]
        : [
            [16, 52],
            [30, 50],
            [22, 47],
          ];
    for (const [x, y] of ripple as [number, number][]) p.hline(x, y, 4, 'c').set(x + 1, y - 1, 'C');
    p.hline(8, 50, 3, 'C').hline(37, 50, 2, 'C');
  } else {
    p.ellipse(23.5, 50, 14, 4, 'y');
  }
  // the pedestal and its bowl
  p.rect(21, 34, 6, 16, 'N').vline(21, 34, 16, 'w').vline(26, 34, 16, 'n');
  p.ellipse(23.5, 33, 8, 2.5, 'N').ellipse(23.5, 33, 6, 1.5, stage >= 2 ? 'B' : 'y');
  p.hline(15, 34, 17, 'n');
  if (stage >= 2) p.vline(23, 26, 7, 'c').vline(24, 27, 6, 'C');
  if (stage === 3) {
    // the water plays: a plume and falling drops, different in each frame
    p.vline(23, 20, 12, 'C').vline(24, 20, 12, 'c');
    p.set(22, 19 + frame, 'C')
      .set(25, 19 + frame, 'C')
      .set(23, 18, 'w')
      .set(24, 18, 'w');
    const drops: [number, number][] =
      frame === 0
        ? [
            [-6, 26],
            [-3, 22],
            [4, 22],
            [7, 26],
          ]
        : [
            [-7, 28],
            [-4, 24],
            [5, 24],
            [8, 28],
          ];
    for (const [dx, dy] of drops) p.set(24 + dx, dy, 'C').set(24 + dx + (dx < 0 ? 1 : -1), dy - 1, 'c');
    p.hline(17, 38, 3, 'c').hline(28, 38, 3, 'c');
    // a koi swimming in the pool
    const kx = frame === 0 ? 12 : 14;
    p.rect(kx, 52, 4, 2, 'o')
      .set(kx - 1, 52, 'O')
      .set(kx + 4, 53, 'o')
      .set(kx + 1, 52, 'w');
    p.rect(kx + 18, 49, 3, 2, 'w')
      .set(kx + 21, 50, 'O')
      .set(kx + 18, 49, 'q');
  } else if (stage === 2) {
    p.hline(20, 34, 8, 'c');
  }
  return finish(p, 63, 3, 44);
}

// ---------------------------------------------------------------- Bandstand (3 × 2, 48 × 48)

function bandstand(stage: number): string[] {
  const p = new Pix(48, 48);
  if (stage === 0) {
    // a ring of stones and stakes where the platform will go
    for (const [x, y] of [
      [4, 42],
      [12, 44],
      [22, 43],
      [32, 44],
      [40, 42],
      [6, 36],
      [41, 36],
    ] as const)
      p.rect(x, y, 4, 3, 'N')
        .hline(x, y + 2, 4, 'n')
        .set(x, y, 'w');
    for (const x of [8, 38]) {
      p.vline(x, 30, 8, 'M').set(x, 29, 'p');
    }
    p.hline(9, 31, 29, 'y');
    weeds(p, [16, 27], 46);
    return finish(p, 47, 3, 44);
  }
  // the platform
  p.rect(2, 33, 44, 12, 'M').hline(2, 33, 44, 'P').hline(2, 36, 44, 'p');
  for (let x = 2; x < 46; x += 4) p.vline(x, 36, 9, 'm');
  p.hline(2, 44, 44, 'm');
  p.rect(2, 28, 44, 5, 'p').hline(2, 28, 44, 'P').hline(2, 30, 44, 'M').hline(2, 32, 44, 'M');
  p.rect(18, 36, 12, 9, 'P').hline(18, 36, 12, 'w');
  for (let y = 38; y <= 44; y += 2) p.hline(18, y, 12, 'p'); // steps
  if (stage >= 2) {
    for (const x of [4, 42]) p.rect(x, 8, 3, 21, 'M').vline(x, 8, 21, 'p');
    p.rect(20, 8, 8, 2, 'M');
    p.rect(5, 14, 38, 14, 'm'); // the back of the stage in shadow
    p.rect(5, 14, 38, 2, 'M');
    roof(p, 0, 2, 48, 12, 'Q', 'R', 'r', 14);
    p.hline(0, 13, 48, 'r').hline(0, 14, 48, 'm');
  }
  if (stage === 3) {
    // bunting along the roof's front edge and a gold finial
    p.set(23, 0, 'f').set(24, 0, 'f').set(23, 1, 'F');
    const flags = ['q', 'u', 'j', 'i', 'o', 'v'];
    for (let x = 2, n = 0; x < 46; x += 4, n++) {
      const sag = Math.round(2 * Math.sin((Math.PI * ((x - 2) % 16)) / 16));
      p.hline(x, 15 + sag, 3, flags[n % flags.length]!)
        .hline(x, 16 + sag, 3, flags[n % flags.length]!)
        .set(x + 1, 17 + sag, flags[n % flags.length]!);
    }
    p.rect(21, 20, 6, 8, 'm');
    p.rect(11, 20, 2, 8, 'u').rect(35, 20, 2, 8, 'u'); // lanterns lit
  }
  return finish(p, 47, 3, 45);
}

// ---------------------------------------------------------------- Lighthouse (2 × 3, 32 × 64)

function lighthouse(stage: number): string[] {
  const p = new Pix(32, 64);
  const tower = (
    top: number,
    bottom: number,
    paint: (y: number) => string,
    wBottom = 20,
    wTop = 13,
  ): void => {
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / Math.max(1, bottom - top);
      const w = Math.round(wTop + (wBottom - wTop) * t);
      const x0 = 16 - Math.floor(w / 2);
      p.hline(x0, y, w, paint(y));
      p.set(x0, y, 'w').set(x0 + w - 1, y, 'n');
    }
  };
  if (stage === 0) {
    tower(34, 61, () => 'n', 20, 15);
    for (let x = 6; x <= 25; x++) p.set(x, 34 - ((x * 7) % 5), 'n').set(x, 33 - ((x * 3) % 4), 'K');
    p.line(14, 38, 17, 44, 'k').line(17, 44, 15, 52, 'k').line(20, 40, 22, 47, 'k');
    p.rect(2, 57, 5, 4, 'n').rect(26, 58, 4, 3, 'n').rect(1, 60, 4, 2, 'K');
    weeds(p, [8, 22], 62);
    return finish(p, 63, 2, 30);
  }
  const painted = stage >= 2;
  tower(15, 61, (y) => (painted ? (Math.floor((y - 15) / 6) % 2 === 0 ? 'q' : 'w') : 'N'));
  if (painted) {
    // shade the dark side of each stripe
    for (let y = 15; y <= 61; y++) {
      const t = (y - 15) / 46;
      const w = Math.round(13 + 7 * t);
      p.set(16 + Math.floor(w / 2) - 1, y, Math.floor((y - 15) / 6) % 2 === 0 ? 'r' : 'x');
    }
  } else {
    for (let y = 18; y <= 60; y += 4) p.hline(11, y, 10, 'n');
  }
  p.rect(14, 52, 5, 9, 'm').hline(14, 52, 5, 'M').set(17, 57, 'f'); // the door
  p.rect(14, 33, 4, 5, 'c').frame(14, 33, 4, 5, 'm');
  p.rect(14, 43, 4, 4, 'c').frame(14, 43, 4, 4, 'm');
  // the gallery, lamp room and cap
  p.rect(8, 13, 16, 2, 'A').hline(8, 13, 16, 'n');
  for (const x of [8, 12, 16, 20, 23]) p.vline(x, 10, 3, 'A');
  p.hline(8, 10, 16, 'A');
  p.rect(11, 3, 10, 8, stage === 3 ? 'a' : painted ? 'c' : 'b');
  if (stage === 3) p.rect(13, 5, 6, 4, 'U').rect(15, 6, 2, 2, 'w');
  p.vline(11, 3, 8, 'A').vline(20, 3, 8, 'A').vline(15, 3, 8, 'A').vline(16, 3, 8, 'A');
  p.rect(9, 1, 14, 3, 'A').hline(9, 1, 14, 'n').rect(14, 0, 4, 1, 'A');
  if (stage === 1) {
    // scaffolding up the left side
    for (const y of [24, 36, 48]) p.hline(2, y, 11, 'p').vline(3, y, 13, 'M').vline(11, y, 13, 'M');
  }
  return finish(p, 63, 3, 29);
}

// ---------------------------------------------------------------- Community Hall (4 × 3, 64 × 64)

function hall(stage: number): string[] {
  const p = new Pix(64, 64);
  if (stage === 0) {
    // a few courses of old foundation stone, and weeds
    for (const [x, w, h] of [
      [4, 12, 4],
      [16, 10, 7],
      [26, 6, 3],
      [34, 14, 6],
      [50, 10, 4],
    ] as const)
      blocks(p, x, 60 - h, w, h);
    p.rect(8, 56, 3, 3, 'N').rect(44, 57, 4, 2, 'n');
    p.line(22, 47, 36, 53, 'M').line(22, 48, 36, 54, 'p');
    weeds(p, [6, 20, 32, 46, 58], 62);
    return finish(p, 63, 3, 60);
  }
  blocks(p, 2, 52, 60, 9);
  if (stage === 1) {
    // foundations laid, posts standing at the corners
    for (const x of [3, 20, 40, 58]) p.rect(x, 34, 3, 19, 'M').vline(x, 34, 19, 'p');
    p.hline(3, 34, 58, 'M').hline(3, 35, 58, 'p');
    return finish(p, 63, 2, 62);
  }
  // walls
  p.rect(4, 30, 56, 22, 'x').hline(4, 30, 56, 'w').vline(4, 30, 22, 'w').vline(59, 30, 22, 'Y');
  for (const x of [4, 20, 42, 57]) p.rect(x, 30, 3, 22, 'M').vline(x, 30, 22, 'p');
  p.hline(4, 40, 56, 'M');
  p.rect(26, 36, 12, 16, 'm').hline(26, 36, 12, 'M').vline(31, 36, 16, 'M').vline(32, 36, 16, 'M'); // double doors
  for (const x of [9, 46])
    p.rect(x, 34, 7, 9, 'c')
      .frame(x, 34, 7, 9, 'M')
      .vline(x + 3, 34, 9, 'M');
  if (stage === 2) {
    // open to the sky: rafters
    for (let x = 6; x < 60; x += 8) p.line(x, 30, x + 4, 22, 'M');
    p.hline(4, 29, 56, 'M');
    return finish(p, 63, 2, 62);
  }
  roof(p, 0, 8, 64, 22, 'Q', 'R', 'r', 20);
  p.rect(30, 3, 4, 6, 'N').vline(30, 3, 6, 'w').rect(29, 2, 6, 2, 'n'); // a chimney
  p.rect(24, 20, 16, 8, 'x').frame(24, 20, 16, 8, 'k').hline(24, 20, 16, 'k'); // a gable window
  p.rect(30, 22, 4, 5, 'c').vline(32, 22, 5, 'M');
  p.rect(26, 36, 12, 16, 'M')
    .hline(26, 36, 12, 'p')
    .vline(31, 36, 16, 'm')
    .vline(32, 36, 16, 'm')
    .set(30, 45, 'f')
    .set(33, 45, 'f');
  if (stage === 4) {
    // festival lights strung along the eaves and a pennant on the ridge
    for (let x = 1; x < 63; x += 4) {
      const sag = Math.round(2 * Math.sin((Math.PI * ((x - 1) % 20)) / 20));
      const c = ['q', 'u', 'j', 'i', 'o'][Math.floor(x / 4) % 5]!;
      p.set(x, 31 + sag, 'm')
        .rect(x, 32 + sag, 2, 2, c)
        .set(x, 32 + sag, 'U');
    }
    p.rect(9, 34, 7, 9, 'u').frame(9, 34, 7, 9, 'M').vline(12, 34, 9, 'M');
    p.rect(46, 34, 7, 9, 'u').frame(46, 34, 7, 9, 'M').vline(49, 34, 9, 'M');
    p.vline(32, 0, 3, 'm').rect(33, 0, 5, 3, 'q');
  }
  return finish(p, 63, 2, 62);
}

// ---------------------------------------------------------------- The Old Bridge (5 × 1, 80 × 32)

function bridge(stage: number): string[] {
  const p = new Pix(80, 32);
  const post = (x: number, top: number): void => {
    p.rect(x, top, 3, 31 - top, 'M')
      .vline(x, top, 31 - top, 'p')
      .set(x + 1, top - 1, 'M');
  };
  if (stage === 0) {
    // the two end posts, and the stumps of planks that once reached out
    post(3, 14);
    post(74, 14);
    p.rect(6, 22, 8, 2, 'p').rect(6, 24, 6, 1, 'M').rect(66, 22, 8, 2, 'p').rect(68, 24, 6, 1, 'M');
    p.set(14, 23, 'M').set(65, 23, 'M');
    return finish(p, 31, 3, 76);
  }
  for (const x of [3, 74]) post(x, 14);
  if (stage === 1) {
    for (const x of [22, 40, 58]) post(x, 20);
    p.rect(6, 22, 8, 2, 'p').rect(66, 22, 8, 2, 'p');
    return finish(p, 31, 3, 76);
  }
  // planks across, on beams
  for (const x of [22, 40, 58]) post(x, 22);
  p.rect(3, 29, 74, 2, 'm');
  p.rect(2, 20, 76, 9, 'p');
  for (let x = 2; x < 78; x += 5) p.vline(x + 4, 20, 9, 'M');
  p.hline(2, 20, 76, 'P').hline(2, 28, 76, 'M');
  if (stage === 3) {
    // railings at the back, a lantern post at each end and one in the middle
    p.hline(3, 12, 74, 'M').hline(3, 13, 74, 'p');
    for (let x = 6; x < 76; x += 6) p.vline(x, 12, 8, 'M');
    p.hline(3, 17, 74, 'M');
    for (const x of [3, 38, 74]) {
      p.rect(x, 4, 3, 16, 'm').vline(x, 4, 16, 'M');
      p.rect(x - 1, 0, 5, 5, 'u')
        .set(x - 1, 0, 'U')
        .hline(x - 1, 4, 5, 'F')
        .set(x + 1, 2, 'w');
    }
  }
  return finish(p, 31, 3, 76);
}

type Builder = (stage: number, frame: number) => string[];

const BUILDERS: Readonly<Record<TownProjectId, { stages: number; make: Builder; animated?: true }>> = {
  old_bridge: { stages: 3, make: (s) => bridge(s) },
  fountain: { stages: 3, make: fountain, animated: true },
  bakery: { stages: 3, make: (s) => bakery(s) },
  bandstand: { stages: 3, make: (s) => bandstand(s) },
  lighthouse: { stages: 3, make: (s) => lighthouse(s) },
  community_hall: { stages: 4, make: (s) => hall(s) },
};

export const TOWN_SPRITES: readonly SpriteDef[] = (Object.keys(BUILDERS) as TownProjectId[]).flatMap((id) => {
  const { stages, make, animated } = BUILDERS[id];
  return Array.from({ length: stages + 1 }, (_, stage): SpriteDef => {
    const water = animated === true && stage >= 2;
    return {
      id: `obj_${id}_${stage}`,
      anchor: 'top-left',
      frames: water ? [make(stage, 0), make(stage, 1)] : [make(stage, 0)],
      ...(water ? { frameMs: 400 } : {}),
    };
  });
});

/** The sprite of a project at `stagesDone` stages. */
export function townSpriteId(project: TownProjectId, stagesDone: number): string {
  return `obj_${project}_${Math.min(stagesDone, BUILDERS[project].stages)}`;
}
