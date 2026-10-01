// v2 phase 03 art (ART_STYLE.md §6.3): the orchard's fruit trees and their fruit. Every tree stage is a
// 32 × 48 sprite on the tree's 2 × 2 spot (bottom-centre): a sapling, a young tree, and a mature tree in each
// season. Fruit is an overlay in three fullness levels, so seven trees need 21 overlays, not 7 × 4 × 3 full
// sprites. Three canopy families (round, tall, spread) keep the seven consistent; each has its own leaf
// tones and blossom colour. The shapes are drawn with the shape kit (`Pix`), then wrapped in `outlined()`.
// Fruit icons and sapling icons are 16 × 16 item art, in the same file so a tree's whole look is in one place.

import { FRUIT_IDS, type FruitId, type SeasonId } from '../../data/ids';
import { TREES } from '../../data/trees';
import { treeOfFruit } from '../../data/ids';
import { overlay, Pix } from './draw';
import { outlined, snowdusted, type SpriteDef } from './types';

const W = 32;
const H = 48;

type Shape = 'round' | 'tall' | 'spread';
type Ellipse = readonly [cx: number, cy: number, rx: number, ry: number];

/** A canopy is a union of ellipses (a main mass and lobes), kept 1 px inside the frame so the outline fits. */
const CANOPY: Record<Shape, readonly Ellipse[]> = {
  round: [
    [16, 17, 12, 10],
    [9, 20, 7, 6],
    [23, 20, 7, 6],
    [16, 10, 8, 6],
  ],
  tall: [
    [16, 16, 9, 13],
    [11, 13, 5, 7],
    [21, 14, 5, 7],
  ],
  spread: [
    [16, 19, 14, 8],
    [9, 16, 6, 6],
    [23, 16, 6, 6],
    [16, 13, 9, 6],
  ],
};

/** The young tree's smaller canopy. */
const YOUNG_CANOPY: Record<Shape, readonly Ellipse[]> = {
  round: [
    [16, 28, 8, 7],
    [12, 30, 5, 4],
    [20, 30, 5, 4],
  ],
  tall: [
    [16, 27, 6, 9],
    [13, 25, 3, 5],
    [19, 26, 3, 5],
  ],
  spread: [
    [16, 30, 10, 5],
    [11, 28, 5, 4],
    [21, 28, 5, 4],
  ],
};

/** Bare branches for winter, as line segments from the trunk top: [x0, y0, x1, y1]. */
const BRANCHES: Record<Shape, readonly (readonly [number, number, number, number])[]> = {
  round: [
    [16, 30, 16, 12],
    [16, 24, 8, 16],
    [16, 22, 24, 15],
    [16, 16, 11, 8],
    [16, 14, 21, 8],
    [8, 16, 5, 19],
    [24, 15, 27, 18],
  ],
  tall: [
    [16, 30, 16, 4],
    [16, 22, 10, 13],
    [16, 20, 22, 11],
    [16, 12, 12, 5],
    [16, 10, 20, 5],
    [10, 13, 8, 8],
    [22, 11, 24, 7],
  ],
  spread: [
    [16, 30, 16, 14],
    [16, 24, 5, 17],
    [16, 23, 27, 16],
    [16, 18, 9, 11],
    [16, 17, 23, 11],
    [5, 17, 3, 21],
    [27, 16, 29, 20],
  ],
};

interface Tones {
  light: string;
  base: string;
  mid: string;
  dark: string;
}

const GREEN: Tones = { light: 'H', base: 'G', mid: 'g', dark: 'h' };
const WINTER_LEAF: Tones = { light: 'g', base: 'h', mid: 'h', dark: 'l' };

/** Autumn tones per tree: gold and orange leaves mixed into green (ART_STYLE.md §6.3). */
const AUTUMN: Record<FruitId, Tones> = {
  cherry: { light: 'U', base: 'u', mid: 'O', dark: 'o' },
  apricot: { light: 'U', base: 'u', mid: 'O', dark: 'o' },
  peach: { light: 'U', base: 'u', mid: 'O', dark: 'o' },
  apple: { light: 'U', base: 'O', mid: 'u', dark: 'o' },
  pear: { light: 'U', base: 'u', mid: 'Y', dark: 'o' },
  persimmon: { light: 'H', base: 'u', mid: 'G', dark: 'o' }, // stays leafy so its orange fruit shows
  lemon: { light: 'G', base: 'g', mid: 'h', dark: 'l' }, // evergreen, a deeper green than summer
};

interface Blossom {
  main: string;
  light: string;
  /** Of every 10 canopy pixels, about this many are blossom. */
  density: number;
}

const BLOSSOM: Record<FruitId, Blossom> = {
  cherry: { main: 'i', light: 'I', density: 7 },
  apricot: { main: 'i', light: 'I', density: 5 },
  peach: { main: 'i', light: 'I', density: 6 },
  apple: { main: 'x', light: 'w', density: 5 },
  pear: { main: 'x', light: 'w', density: 5 },
  persimmon: { main: 'x', light: 'w', density: 2 },
  lemon: { main: 'x', light: 'w', density: 4 },
};

/** Fruit tones as a 2 × 2 pattern: [top-left, top-right, bottom-left, bottom-right] (highlight, two body, shade). */
const FRUIT_PIXELS: Record<FruitId, readonly [string, string, string, string]> = {
  cherry: ['Q', 'q', 'q', 'r'],
  apricot: ['O', 'o', 'o', 'q'],
  peach: ['I', 'i', 'i', 'O'],
  apple: ['Q', 'q', 'q', 'r'],
  pear: ['L', 'u', 'u', 'Y'],
  persimmon: ['O', 'o', 'o', 'q'],
  lemon: ['U', 'u', 'u', 'F'],
};

function inEllipse(e: Ellipse, x: number, y: number): boolean {
  const nx = (x - e[0]) / (e[2] + 0.35);
  const ny = (y - e[1]) / (e[3] + 0.35);
  return nx * nx + ny * ny <= 1;
}

function inCanopy(shape: Ellipse[] | readonly Ellipse[], x: number, y: number): boolean {
  for (let i = 0; i < shape.length; i++) if (inEllipse(shape[i]!, x, y)) return true;
  return false;
}

/** A fixed noise in 0..10 per pixel, so leaf texture is the same every time and in every season. */
function noise(x: number, y: number): number {
  return (x * 7 + y * 13 + ((x * y) % 5)) % 11;
}

function trunk(p: Pix, top: number, wide: boolean): void {
  const x0 = wide ? 14 : 15;
  const w = wide ? 5 : 3;
  const bottom = H - 2; // the last two rows stay clear for the outline
  p.rect(x0, top, w, bottom - top + 1, 'M');
  p.vline(x0, top, bottom - top + 1, 'p');
  p.vline(x0 + w - 1, top, bottom - top + 1, 'm');
  // roots flare a little at the foot
  p.set(x0 - 1, bottom, 'M').set(x0 + w, bottom, 'm');
  if (wide) p.set(x0 - 1, bottom - 1, 'M').set(x0 + w, bottom - 1, 'm');
}

/** Fills a canopy with tones by its position (light top-left, dark bottom-right) and a little texture. */
function leaves(
  p: Pix,
  ellipses: readonly Ellipse[],
  tones: Tones,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inCanopy(ellipses, x, y)) continue;
      const t = (x - cx) / rx + (y - cy) / ry; // about -2 (top-left) … 2 (bottom-right)
      const n = noise(x, y);
      let ch = tones.base;
      if (t < -0.9) ch = tones.light;
      else if (t > 1.0) ch = tones.dark;
      else if (t > 0.35) ch = tones.mid;
      if (n === 0) ch = t > 0 ? tones.dark : tones.light;
      p.set(x, y, ch);
    }
}

function centreOf(shape: Shape): [number, number, number, number] {
  return shape === 'round' ? [16, 17, 12, 10] : shape === 'tall' ? [16, 16, 9, 13] : [16, 19, 14, 8];
}

/** Scatters blossom over the leaves. */
function blossoms(p: Pix, b: Blossom): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = p.get(x, y);
      if (ch === '.' || ch === 'k') continue;
      const n = (x * 5 + y * 3 + ((x ^ y) % 3)) % 10;
      if (n < b.density) p.set(x, y, (x + y) % 3 === 0 ? b.light : b.main);
    }
}

function matureFill(fruit: FruitId, season: SeasonId): string[] {
  const shape = TREES[treeOfFruit(fruit)].shape;
  const [cx, cy, rx, ry] = centreOf(shape);
  const p = new Pix(W, H);
  trunk(p, 24, true);
  if (season === 'winter' && !TREES[treeOfFruit(fruit)].seasons.includes('winter')) {
    for (const [x0, y0, x1, y1] of BRANCHES[shape]) p.line(x0, y0, x1, y1, 'm');
    // a trunk-thick lower part of the main branch, and highlights on the left sides
    for (const [x0, y0, x1, y1] of BRANCHES[shape].slice(0, 3)) p.line(x0 - 1, y0, x1 - 1, y1, 'M');
    const rows = p.rows();
    // snow lies on branch tops: a branch pixel with open air above it turns white, in a broken line
    const out = rows.map((r) => [...r]);
    for (let y = 1; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ch = rows[y]![x]!;
        if ((ch === 'm' || ch === 'M') && rows[y - 1]![x] === '.' && y < 30 && (x + y) % 3 !== 0)
          out[y - 1]![x] = 'w';
      }
    return outlined(out.map((r) => r.join('')));
  }
  const tones = season === 'autumn' ? AUTUMN[fruit] : season === 'winter' ? WINTER_LEAF : GREEN;
  // the canopy is made on its own, so blossom never lands on the trunk, then laid over the trunk
  const canopy = new Pix(W, H);
  leaves(canopy, CANOPY[shape], tones, cx, cy, rx, ry);
  if (season === 'spring') blossoms(canopy, BLOSSOM[fruit]);
  const rows = outlined(overlay(p.rows(), canopy.rows()));
  return season === 'winter' ? snowdusted(rows) : rows;
}

function youngFill(fruit: FruitId): string[] {
  const shape = TREES[treeOfFruit(fruit)].shape;
  const p = new Pix(W, H);
  trunk(p, 30, false);
  const c = YOUNG_CANOPY[shape][0]!;
  leaves(p, YOUNG_CANOPY[shape], GREEN, c[0], c[1], c[2], c[3]);
  return outlined(p.rows());
}

function saplingFill(): string[] {
  const p = new Pix(W, H);
  // a thin stick with a little root mound, a few leaves, all in the bottom 16 px
  p.vline(16, 38, 9, 'M').vline(15, 42, 5, 'p').vline(17, 42, 5, 'm');
  p.set(14, 46, 'M').set(18, 46, 'm').set(13, 46, 'm').set(19, 46, 'M');
  p.rect(13, 36, 3, 2, 'G')
    .rect(17, 34, 3, 2, 'G')
    .rect(15, 32, 3, 3, 'H')
    .rect(12, 40, 3, 2, 'g')
    .rect(18, 39, 3, 2, 'g');
  p.set(14, 36, 'H').set(18, 34, 'H').set(16, 32, 'L');
  return outlined(p.rows());
}

// ---- fruit overlays

/** Where fruit hangs on each canopy: up to 12 spots well inside the leaves, spread out, in a fixed order. */
const FRUIT_SPOTS: Record<Shape, readonly (readonly [number, number])[]> = (() => {
  const out = {} as Record<Shape, (readonly [number, number])[]>;
  for (const shape of ['round', 'tall', 'spread'] as const) {
    const canopy = CANOPY[shape];
    // inside the canopy with 2 px to spare on every side, so a 2 × 2 fruit never touches the outline
    const inside = (x: number, y: number): boolean =>
      [-2, 0, 3].every((dx) => [-2, 0, 3].every((dy) => inCanopy(canopy, x + dx, y + dy)));
    const candidates: [number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) candidates.push([x, y]);
    // a fixed shuffle (a small LCG, not the game's RNG: this is art, built once)
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const picked: [number, number][] = [];
    for (const gap of [5, 4, 3]) {
      for (const c of candidates) {
        if (picked.length >= 12) break;
        if (picked.every((q) => Math.max(Math.abs(q[0] - c[0]), Math.abs(q[1] - c[1])) >= gap))
          picked.push(c);
      }
    }
    out[shape] = picked;
  }
  return out;
})();

/** Fruit on the canopy at fullness level 1 (a little: 4), 2 (some: 8) or 3 (full: 12). */
function fruitOverlay(fruit: FruitId, level: 1 | 2 | 3): string[] {
  const shape = TREES[treeOfFruit(fruit)].shape;
  const [a, b, c, d] = FRUIT_PIXELS[fruit];
  const p = new Pix(W, H);
  for (const [x, y] of FRUIT_SPOTS[shape].slice(0, level * 4)) {
    p.set(x, y, a)
      .set(x + 1, y, b)
      .set(x, y + 1, c)
      .set(x + 1, y + 1, d);
  }
  return p.rows();
}

// ---- item icons (16 × 16)

const ICON = 16;

function fruitIconFill(fruit: FruitId): string[] {
  const p = new Pix(ICON, ICON);
  switch (fruit) {
    case 'cherry':
      p.line(8, 2, 5, 8, 'm').line(8, 2, 11, 7, 'm').set(9, 2, 'G').set(10, 2, 'G').set(9, 3, 'g');
      p.ellipse(5, 10, 2.5, 2.5, 'q')
        .ellipse(11, 10, 2.5, 2.5, 'q')
        .set(4, 9, 'Q')
        .set(10, 9, 'Q')
        .set(6, 12, 'r')
        .set(12, 12, 'r');
      break;
    case 'apricot':
      p.ellipse(8, 9, 5, 4.5, 'o')
        .ellipse(7, 7, 2.5, 2, 'O')
        .set(6, 6, 'U')
        .vline(8, 3, 2, 'm')
        .set(9, 3, 'G')
        .set(10, 3, 'G')
        .vline(8, 6, 6, 'q');
      p.set(8, 7, 'o').set(8, 8, 'o').set(8, 9, 'o').set(8, 10, 'o').set(8, 11, 'o');
      break;
    case 'peach':
      p.ellipse(8, 9, 5, 5, 'I')
        .ellipse(10, 11, 3, 3, 'i')
        .set(6, 6, 'w')
        .vline(8, 3, 2, 'm')
        .set(9, 3, 'G')
        .set(10, 3, 'G')
        .set(10, 4, 'g');
      p.set(8, 6, 'i').set(8, 7, 'i').set(8, 8, 'i');
      break;
    case 'apple':
      p.ellipse(8, 9, 5, 4.5, 'q')
        .ellipse(6, 7, 1.5, 1.5, 'Q')
        .set(5, 6, 'w')
        .vline(8, 3, 3, 'm')
        .set(9, 3, 'G')
        .set(10, 3, 'G')
        .set(10, 4, 'g');
      p.set(11, 12, 'r').set(10, 13, 'r').set(9, 13, 'r');
      break;
    case 'pear':
      p.ellipse(8, 5.5, 2.5, 3, 'L')
        .ellipse(8, 10, 4.5, 4, 'L')
        .rect(7, 5, 2, 3, 'L')
        .set(6, 9, 'U')
        .set(6, 10, 'U')
        .vline(8, 1, 3, 'm')
        .set(9, 2, 'G')
        .set(10, 2, 'G');
      p.set(10, 12, 'u').set(9, 13, 'u').set(11, 10, 'u').set(11, 11, 'u');
      break;
    case 'persimmon':
      p.ellipse(8, 10, 5.5, 4, 'o')
        .ellipse(6, 8, 2.5, 1.5, 'O')
        .rect(5, 5, 6, 2, 'G')
        .rect(7, 3, 2, 3, 'g')
        .set(8, 3, 'm')
        .set(11, 6, 'G')
        .set(4, 6, 'G');
      p.set(11, 12, 'q').set(10, 13, 'q').set(9, 13, 'q');
      break;
    case 'lemon':
      p.ellipse(8, 9, 5.5, 4, 'u')
        .set(2, 9, 'u')
        .set(14, 9, 'u')
        .set(1, 9, 'U')
        .ellipse(6, 7, 2.5, 1.5, 'U')
        .set(5, 6, 'w')
        .set(8, 4, 'm')
        .set(9, 4, 'G')
        .set(10, 4, 'G');
      p.set(11, 11, 'F').set(10, 12, 'F').set(9, 12, 'F');
      break;
  }
  return outlined(p.rows());
}

/** A burlap-wrapped root ball with a sprout, and a coloured tag in the fruit's colour. */
function saplingIconFill(fruit: FruitId): string[] {
  const p = new Pix(ICON, ICON);
  // sprout
  p.vline(8, 3, 6, 'M')
    .rect(5, 3, 3, 2, 'G')
    .rect(9, 2, 3, 2, 'G')
    .rect(6, 5, 2, 1, 'g')
    .rect(9, 5, 3, 1, 'g')
    .set(5, 3, 'H')
    .set(9, 2, 'H');
  // sack
  p.ellipse(8, 11, 5, 3.5, 'P')
    .ellipse(7, 10, 3, 1.5, 'x')
    .hline(5, 8, 7, 'p')
    .set(4, 12, 'p')
    .set(11, 13, 'p');
  p.hline(6, 8, 5, 'M');
  // tag
  const [, body] = FRUIT_PIXELS[fruit];
  p.rect(10, 11, 3, 2, body).set(10, 11, FRUIT_PIXELS[fruit][0]);
  return outlined(p.rows());
}

// ---- the sprite list

const SEASONS_LIST: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

function treeSprites(fruit: FruitId): SpriteDef[] {
  const sprite = (id: string, rows: string[]): SpriteDef => ({ id, frames: [rows], anchor: 'bottom-center' });
  return [
    sprite(`tree_${fruit}_sapling`, saplingFill()),
    sprite(`tree_${fruit}_young`, youngFill(fruit)),
    ...SEASONS_LIST.map((s) => sprite(`tree_${fruit}_${s}`, matureFill(fruit, s))),
    ...([1, 2, 3] as const).map((n) => sprite(`fx_fruit_${fruit}_${n}`, fruitOverlay(fruit, n))),
    { id: `item_${fruit}`, frames: [fruitIconFill(fruit)] },
    { id: `item_sapling_${fruit}`, frames: [saplingIconFill(fruit)] },
  ];
}

export const TREE_SPRITES: readonly SpriteDef[] = FRUIT_IDS.flatMap(treeSprites);

/** Sprite ids per fruit, built once so the renderer never builds a string per frame. */
export interface TreeSpriteIds {
  sapling: string;
  young: string;
  /** Mature, by season index (spring, summer, autumn, winter). */
  mature: readonly [string, string, string, string];
  /** Fruit overlays for a little, some and a full tree. */
  fruit: readonly [string, string, string];
}

export const TREE_SPRITE_IDS: Readonly<Record<FruitId, TreeSpriteIds>> = Object.fromEntries(
  FRUIT_IDS.map((f) => [
    f,
    {
      sapling: `tree_${f}_sapling`,
      young: `tree_${f}_young`,
      mature: SEASONS_LIST.map((s) => `tree_${f}_${s}`) as unknown as TreeSpriteIds['mature'],
      fruit: [1, 2, 3].map((n) => `fx_fruit_${f}_${n}`) as unknown as TreeSpriteIds['fruit'],
    },
  ]),
) as Record<FruitId, TreeSpriteIds>;

/** 0, 1 or 2: which fruit overlay a tree holding `n` of `cap` shows (a little ≤ ⅓, some ≤ ⅔, full). */
export function fruitLevel(n: number, cap: number): 0 | 1 | 2 {
  return n * 3 <= cap ? 0 : n * 3 <= cap * 2 ? 1 : 2;
}
