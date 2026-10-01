// The auto-tiled decorations (ART_STYLE.md §6.2, §6.6): three paths and three fences, each drawn in all 16
// neighbour masks (N 1, E 2, S 4, W 8 of same-id neighbours). A path is terrain-like (no outline, joined
// into one patch); a fence has the usual 1 px outline. The base sprite `decor_<id>` is the straight
// east-west piece, for the shop and the placement preview.

import { Pix } from './draw';
import type { SpriteDef } from './types';

const N = 1;
const E = 2;
const S = 4;
const W = 8;

type PathPaint = (x: number, y: number, mask: number) => string;

/** Which pixels of a 16 × 16 tile belong to a path with this mask: a rounded patch with arms to joined sides. */
function pathRegion(mask: number): boolean[][] {
  const r = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => false));
  const put = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) r[y]![x] = true;
  };
  put(1, 1, 14, 14);
  if (mask & N) put(1, 0, 14, 0);
  if (mask & S) put(1, 15, 14, 15);
  if (mask & E) put(15, 1, 15, 14);
  if (mask & W) put(0, 1, 0, 14);
  if (!(mask & (N | W))) r[1]![1] = false;
  if (!(mask & (N | E))) r[1]![14] = false;
  if (!(mask & (S | W))) r[14]![1] = false;
  if (!(mask & (S | E))) r[14]![14] = false;
  return r;
}

function pathTile(mask: number, paint: PathPaint): string[] {
  const region = pathRegion(mask);
  const at = (x: number, y: number): boolean =>
    region[y]?.[x] ?? (x < 0 ? !!(mask & W) : x > 15 ? !!(mask & E) : y < 0 ? !!(mask & N) : !!(mask & S));
  const out = new Pix(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!region[y]![x]) continue;
      const rim = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      out.set(x, y, rim ? paint(x, y, -1) : paint(x, y, mask));
    }
  return out.rows();
}

/** Cottage: round cobbles in running bond, dark grout, a few bright stones. */
const cobble: PathPaint = (x, y, mask) => {
  if (mask < 0) return 'n';
  const band = y >> 2;
  const ox = (band & 1) * 2;
  const sx = (x + ox) >> 2;
  if (y % 4 === 3 || (x + ox) % 4 === 3) return 'n';
  const hash = (sx * 7 + band * 13) % 5;
  if (y % 4 === 0 && (x + ox) % 4 === 0 && hash < 2) return 'w';
  return hash === 3 && y % 4 === 2 ? 'n' : 'N';
};

/** Seaside: weathered boards, along the run (across it when the path runs north-south). */
const planks: PathPaint = (x, y, mask) => {
  if (mask < 0) return 'M';
  const vertical = !!(mask & (N | S)) && !(mask & (E | W));
  const a = vertical ? x : y;
  const b = vertical ? y : x;
  if (a % 4 === 3) return 'm';
  if (b % 8 === 1 && a % 4 === 1) return 'K';
  return a % 4 === 0 ? 'P' : 'p';
};

/** Harvest Fair: red brick in running bond with cream mortar. */
const brick: PathPaint = (x, y, mask) => {
  if (mask < 0) return 'r';
  const band = y >> 2;
  const ox = (band & 1) * 4;
  if (y % 4 === 3 || (x + ox) % 8 === 7) return 'x';
  if (y % 4 === 0) return 'Q';
  return y % 4 === 2 ? 'r' : 'R';
};

const wood = {
  light: 'P',
  mid: 'p',
  dark: 'M',
};

/** A picket fence: a post at the tile's middle, white pickets and two rails towards joined east and west neighbours, rails towards north and south. */
function picket(mask: number): string[] {
  const p = new Pix(16, 16);
  const east = !!(mask & E);
  const west = !!(mask & W);
  const x0 = west ? 0 : east ? 7 : 6;
  const x1 = east ? 15 : west ? 8 : 9;
  if (east || west) {
    for (let x = x0; x <= x1; x++) {
      if (x % 4 === 3) continue;
      const tall = x % 4 === 1;
      p.vline(x, tall ? 4 : 5, tall ? 9 : 8, x % 4 === 2 ? wood.mid : wood.light);
    }
    p.hline(x0, 7, x1 - x0 + 1, wood.dark).hline(x0, 10, x1 - x0 + 1, wood.dark);
  }
  if (mask & N) p.rect(7, 0, 2, 8, wood.mid).vline(8, 0, 8, wood.dark);
  if (mask & S) p.rect(7, 9, 2, 7, wood.mid).vline(8, 9, 7, wood.dark);
  // The post stands on top of the rails.
  p.rect(6, 4, 4, 10, wood.light)
    .vline(9, 4, 10, wood.mid)
    .hline(6, 3, 4, wood.mid)
    .hline(6, 13, 4, wood.dark);
  p.set(6, 3, '.').set(9, 3, '.');
  const rows = p.outlinedRows();
  return rows;
}

/** Seaside: a driftwood post at the middle with rope sagging towards joined sides. */
function rope(mask: number): string[] {
  const p = new Pix(16, 16);
  if (mask & E)
    for (let x = 8; x <= 15; x++)
      p.set(x, 5 + Math.floor(((x - 8) * (x - 8)) / 18), 'y').set(
        x,
        6 + Math.floor(((x - 8) * (x - 8)) / 18),
        'Y',
      );
  if (mask & W)
    for (let x = 0; x <= 7; x++)
      p.set(x, 5 + Math.floor(((7 - x) * (7 - x)) / 18), 'y').set(
        x,
        6 + Math.floor(((7 - x) * (7 - x)) / 18),
        'Y',
      );
  if (mask & N) p.rect(7, 0, 2, 5, 'y').vline(8, 0, 5, 'Y');
  if (mask & S) p.rect(7, 9, 2, 7, 'y').vline(8, 9, 7, 'Y');
  p.rect(6, 3, 4, 11, 'p').vline(6, 3, 11, 'P').vline(9, 3, 11, 'M').hline(6, 3, 4, 'P');
  p.hline(6, 5, 4, 'y').hline(6, 6, 4, 'Y'); // the rope's turn round the post
  return p.outlinedRows();
}

/** Harvest Fair: a split-rail fence, two rails on dark posts. */
function rail(mask: number): string[] {
  const p = new Pix(16, 16);
  const east = !!(mask & E);
  const west = !!(mask & W);
  const x0 = west ? 0 : 6;
  const x1 = east ? 15 : 9;
  if (east || west) {
    for (const y of [5, 9]) p.rect(x0, y, x1 - x0 + 1, 2, 'M').hline(x0, y, x1 - x0 + 1, 'p');
  }
  if (mask & N) p.rect(7, 0, 2, 8, 'M').vline(7, 0, 8, 'p');
  if (mask & S) p.rect(7, 9, 2, 7, 'M').vline(7, 9, 7, 'p');
  p.rect(6, 3, 4, 11, 'm').vline(6, 3, 11, 'M').hline(6, 3, 4, 'M');
  return p.outlinedRows();
}

function family(id: string, make: (mask: number) => string[]): SpriteDef[] {
  const sprites: SpriteDef[] = [];
  for (let mask = 0; mask < 16; mask++)
    sprites.push({ id: `decor_${id}_${mask}`, anchor: 'top-left', frames: [make(mask)] });
  sprites.push({ id: `decor_${id}`, anchor: 'top-left', frames: [make(E | W)] });
  return sprites;
}

export const DECOR_TILE_SPRITES: readonly SpriteDef[] = [
  ...family('cobble_path', (m) => pathTile(m, cobble)),
  ...family('plank_path', (m) => pathTile(m, planks)),
  ...family('brick_path', (m) => pathTile(m, brick)),
  ...family('picket_fence', picket),
  ...family('rope_fence', rope),
  ...family('rail_fence', rail),
];
