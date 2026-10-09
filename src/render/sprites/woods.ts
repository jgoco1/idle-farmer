// v4 phase 04 art (ART_STYLE.md §7.2, §7.4, §7.5): the North Woods' forage spots and the forage item
// icons. A spot is small and low (16 × 16, bottom-centre on its tile, never taller than a tile) so the
// woods stay readable: mushrooms as two or three caps, mint as a green clump, elderflower as cream
// umbels, blackberries and rose hips as dark and red dots on a bramble, hazelnuts as brown clusters
// under a leaf. A resting spot is bare earth with a leaf or two (snow in winter). The item icons are the
// same things, larger. Shapes are drawn with the shape kit and wrapped in the 1 px outline.

import { FORAGE_IDS, type ForageId } from '../../data/ids';
import { Pix } from './draw';
import type { SpriteDef } from './types';

/** One morel: a tall honeycombed cap on a pale stem, its base at (x, y). */
function morel(p: Pix, x: number, y: number, h: number): void {
  p.vline(x, y - 1, 2, 'x').vline(x + 1, y - 1, 2, 'x');
  p.rect(x - 1, y - 1 - h, 4, h, 'm');
  p.set(x, y - 1 - h - 1, 'm').set(x + 1, y - 1 - h - 1, 'm');
  for (let j = 0; j < h; j += 2) p.set(x + (j % 4 === 0 ? 0 : 1), y - 2 - j, 'P');
}

/** One chanterelle: a golden funnel cap on a short stem. */
function chanterelle(p: Pix, x: number, y: number, w: number): void {
  p.vline(x, y - 2, 2, 'u');
  p.hline(x - w, y - 3, 2 * w + 1, 'u').hline(x - w + 1, y - 4, 2 * w - 1, 'O');
  p.set(x - w, y - 4, 'O').set(x + w, y - 4, 'O');
}

/** A clump of mint leaves around (x, y). */
function mint(p: Pix, x: number, y: number, big: boolean): void {
  const s = big ? 2 : 1;
  p.ellipse(x - 2 * s, y - 2 * s, 1.5 * s, 1 * s, 'G');
  p.ellipse(x + 2 * s, y - 2 * s, 1.5 * s, 1 * s, 'G');
  p.ellipse(x, y - 4 * s, 1.5 * s, 1.5 * s, 'H');
  p.vline(x, y - 3 * s, 3 * s, 'h');
  p.set(x - 2 * s, y - 2 * s, 'H').set(x + 2 * s, y - 2 * s, 'H');
}

/** Elderflower: a flat cream umbel on green stalks. */
function elder(p: Pix, x: number, y: number, big: boolean): void {
  const s = big ? 2 : 1;
  p.line(x, y, x - 2 * s, y - 3 * s, 'h')
    .line(x, y, x + 2 * s, y - 3 * s, 'h')
    .vline(x, y - 3 * s, 3 * s, 'h');
  p.ellipse(x, y - 4 * s, 3 * s, 1.2 * s, 'x');
  for (let i = -3 * s; i <= 3 * s; i += 2) p.set(x + i, y - 4 * s - (i % 4 === 0 ? 1 : 0), 'w');
}

/** A bramble with berries of `berry` (with `shine` highlights). */
function bramble(p: Pix, x: number, y: number, big: boolean, berry: string, shine: string): void {
  const s = big ? 2 : 1;
  p.line(x - 4 * s, y, x + 3 * s, y - 4 * s, 'l').line(x - 3 * s, y - 3 * s, x + 4 * s, y, 'l');
  p.ellipse(x - 2 * s, y - 4 * s, 1.4 * s, 1 * s, 'g').ellipse(x + 3 * s, y - 2 * s, 1.4 * s, 1 * s, 'g');
  const dots: readonly (readonly [number, number])[] = [
    [-3, -1],
    [0, -2],
    [2, -4],
    [-1, -5],
    [3, -1],
  ];
  for (const [dx, dy] of dots) {
    p.rect(x + dx * s, y + dy * s, s, s, berry);
    if (big) p.set(x + dx * s, y + dy * s, shine);
  }
}

/** Hazelnuts: a brown cluster under a green leaf. */
function hazel(p: Pix, x: number, y: number, big: boolean): void {
  const s = big ? 2 : 1;
  p.ellipse(x, y - 5 * s, 3.5 * s, 1.5 * s, 'g').hline(x - 3 * s, y - 5 * s, 7 * s, 'h');
  p.ellipse(x - 2 * s, y - 2 * s, 1.5 * s, 1.5 * s, 'M');
  p.ellipse(x + 2 * s, y - 2 * s, 1.5 * s, 1.5 * s, 'M');
  p.ellipse(x, y - 1 * s, 1.5 * s, 1.5 * s, 'm');
  p.set(x - 2 * s, y - 3 * s, 'p')
    .set(x + 2 * s, y - 3 * s, 'p')
    .set(x, y - 2 * s, 'M');
}

/** Draws `item` with its base at (x, y): the spot (small) or the icon (big). */
function drawItem(p: Pix, item: ForageId, x: number, y: number, big: boolean): void {
  switch (item) {
    case 'morel':
      if (big) {
        morel(p, x - 4, y, 7);
        morel(p, x + 2, y - 1, 9);
      } else {
        morel(p, x - 3, y, 4);
        morel(p, x + 1, y, 6);
      }
      return;
    case 'chanterelle':
      if (big) {
        chanterelle(p, x - 3, y, 3);
        chanterelle(p, x + 3, y - 3, 3);
        chanterelle(p, x - 1, y - 7, 2);
      } else {
        chanterelle(p, x - 3, y, 2);
        chanterelle(p, x + 2, y - 1, 2);
      }
      return;
    case 'wild_mint':
      return mint(p, x, y, big);
    case 'elderflower':
      return elder(p, x, y, big);
    case 'blackberry':
      return bramble(p, x, y, big, 'k', 'v');
    case 'rose_hip':
      return bramble(p, x, y, big, 'q', 'Q');
    case 'hazelnut':
      return hazel(p, x, y, big);
  }
}

/** The woods floor under a spot: a little patch of earth and fallen needles. */
function patch(p: Pix): void {
  p.ellipse(7.5, 13.5, 5, 1.5, 's').hline(4, 14, 8, 'd');
}

function spotRows(item: ForageId): string[] {
  const p = new Pix(16, 16);
  patch(p);
  drawItem(p, item, 8, 13, false);
  return p.outlinedRows();
}

function iconRows(item: ForageId): string[] {
  const p = new Pix(16, 16);
  drawItem(p, item, 8, 13, true);
  return p.outlinedRows();
}

/** A spot resting this season: bare earth with a fallen leaf or two, or a drift of snow in winter. */
function restRows(winter: boolean): string[] {
  const p = new Pix(16, 16);
  if (winter) {
    p.ellipse(7.5, 13, 5, 2, 'w').hline(4, 14, 8, 'C').set(6, 12, 'x');
  } else {
    patch(p);
    p.set(5, 12, 'o').set(6, 12, 'O').set(10, 13, 'M').set(11, 12, 'p');
  }
  return p.outlinedRows();
}

const SPOT_SPRITES: SpriteDef[] = FORAGE_IDS.map((id) => ({
  id: `forage_${id}`,
  anchor: 'bottom-center',
  frames: [spotRows(id)],
}));

const ICON_SPRITES: SpriteDef[] = FORAGE_IDS.map((id) => ({ id: `item_${id}`, frames: [iconRows(id)] }));

export const WOODS_SPRITES: readonly SpriteDef[] = [
  ...SPOT_SPRITES,
  { id: 'forage_rest', anchor: 'bottom-center', frames: [restRows(false)] },
  { id: 'forage_rest_winter', anchor: 'bottom-center', frames: [restRows(true)] },
  ...ICON_SPRITES,
];
