// v4 phase 01 art (ART_STYLE.md §7): the north band's scenery. Pines for the tree line and the woods
// (two shapes, each with a winter look), the woods floor, the hawthorn hedge in its four seasons, the
// mountain lake's water and banks, its jetty, and the little sign on an empty building lot.

import { tileGrassA, tileGrassB, tilePondCornerNW, tilePondEdgeN, tileWater } from './terrain';
import { objDock } from './fishing';
import { outlined, recolored, rotateSprite, type SpriteDef } from './types';

const W = 16;

/** Sets the given pixels of a 16-wide grid. */
function dotted(rows: readonly string[], dots: readonly (readonly [number, number])[], ch: string): string[] {
  const out = rows.map((r) => [...r]);
  for (const [x, y] of dots) if (out[y]?.[x] !== undefined) out[y]![x] = ch;
  return out.map((r) => r.join(''));
}

// ---- pines (16 × 32, bottom-centre)

/**
 * A pine of stacked tiers: each tier is `[top row, height, half-width at its foot]`. The left edge
 * catches the light (`L`), the right third is in shade (`h`), the trunk is `M`/`m` over a `K` shadow.
 */
function pineRows(tiers: readonly (readonly [number, number, number])[]): string[] {
  const g: string[][] = Array.from({ length: 32 }, () => Array.from({ length: W }, () => '.'));
  for (const [top, height, half] of tiers) {
    for (let i = 0; i < height; i++) {
      const hw = Math.max(1, Math.round(1 + ((half - 1) * i) / Math.max(1, height - 1)));
      for (let x = 8 - hw; x < 8 + hw; x++) {
        const right = x >= 8 + Math.floor(hw / 3);
        g[top + i]![x] = x === 8 - hw && i > 0 ? 'L' : right ? 'h' : 'l';
      }
    }
  }
  for (let y = 26; y < 30; y++) {
    g[y]![7] = 'M';
    g[y]![8] = 'm';
  }
  for (let x = 5; x < 11; x++) g[30]![x] = 'K';
  return outlined(g.map((r) => r.join('')));
}

/** Snow on the top edge of each tier: a needle pixel with open air above it turns white. */
function snowOnTiers(rows: readonly string[]): string[] {
  const out = rows.map((r) => [...r]);
  for (let y = 1; y < rows.length; y++)
    for (let x = 0; x < W; x++) {
      const ch = rows[y]![x]!;
      const above = rows[y - 1]![x]!;
      if ((ch === 'l' || ch === 'L' || ch === 'h') && (above === '.' || above === 'k')) out[y]![x] = 'w';
    }
  return out.map((r) => r.join(''));
}

const PINE_A = pineRows([
  [1, 6, 3],
  [5, 7, 5],
  [10, 8, 6],
  [16, 10, 7],
]);
const PINE_B = pineRows([
  [2, 5, 2],
  [6, 6, 4],
  [11, 7, 5],
  [17, 9, 6],
]);

export const objPine: SpriteDef = { id: 'obj_pine', anchor: 'bottom-center', frames: [PINE_A] };
export const objPineB: SpriteDef = { id: 'obj_pine_b', anchor: 'bottom-center', frames: [PINE_B] };
export const objPineWinter: SpriteDef = {
  id: 'obj_pine_winter',
  anchor: 'bottom-center',
  frames: [snowOnTiers(PINE_A)],
};
export const objPineBWinter: SpriteDef = {
  id: 'obj_pine_b_winter',
  anchor: 'bottom-center',
  frames: [snowOnTiers(PINE_B)],
};

// ---- the woods floor (16 × 16 tiles): grass with fallen needles and moss

export const tileWoodsA: SpriteDef = {
  id: 'tile_woods_a',
  frames: [
    dotted(
      dotted(
        tileGrassA.frames[0]!,
        [
          [3, 3],
          [4, 4],
          [11, 9],
          [12, 10],
          [6, 13],
        ],
        'M',
      ),
      [
        [9, 2],
        [10, 2],
        [2, 10],
        [3, 10],
        [13, 14],
      ],
      'l',
    ),
  ],
};

export const tileWoodsB: SpriteDef = {
  id: 'tile_woods_b',
  frames: [
    dotted(
      dotted(
        tileGrassB.frames[0]!,
        [
          [12, 3],
          [13, 4],
          [5, 8],
          [6, 9],
          [9, 14],
        ],
        'M',
      ),
      [
        [2, 4],
        [3, 4],
        [10, 11],
        [11, 11],
        [14, 7],
      ],
      'l',
    ),
  ],
};

// ---- the hawthorn hedge (16 × 16, top-left; tiles join left and right)

function hedgeRows(): string[] {
  const g: string[][] = Array.from({ length: 16 }, () => Array.from({ length: W }, () => '.'));
  for (let x = 0; x < W; x++) {
    // Two rounded bumps per tile, so a row of hedges reads as one long, soft hedge.
    const top = 3 + ([1, 0, 0, 0, 0, 0, 1, 1][x % 8] ?? 0);
    g[top - 1]![x] = 'k';
    for (let y = top; y < 15; y++) {
      const shade = y >= 12 ? 'h' : y <= top + 1 ? 'H' : (x * 7 + y * 3) % 11 === 0 ? 'h' : 'G';
      g[y]![x] = shade;
    }
    g[15]![x] = 'K';
  }
  return g.map((r) => r.join(''));
}
const HEDGE = hedgeRows();

export const objHedge: SpriteDef = { id: 'obj_hedge', frames: [HEDGE] };
export const objHedgeSpring: SpriteDef = {
  id: 'obj_hedge_spring',
  frames: [
    dotted(
      HEDGE,
      [
        [2, 5],
        [6, 7],
        [10, 5],
        [13, 8],
        [4, 10],
        [9, 10],
        [15, 6],
      ],
      'w',
    ),
  ],
};
export const objHedgeAutumn: SpriteDef = {
  id: 'obj_hedge_autumn',
  frames: [
    dotted(
      recolored(HEDGE, { H: 'o', G: 'G' }),
      [
        [3, 6],
        [7, 9],
        [11, 6],
        [14, 9],
        [5, 11],
      ],
      'q',
    ),
  ],
};
export const objHedgeWinter: SpriteDef = {
  id: 'obj_hedge_winter',
  frames: [recolored(HEDGE, { H: 'w' })],
};

// ---- the mountain lake: deeper than the pond (`b` with slate in its depths), banks like the pond's

const LAKE_COLOURS = { B: 'b', b: 'A', c: 'B', C: 'c' } as const;

export const tileLakeA: SpriteDef = {
  id: 'tile_lake_a',
  frameMs: 700,
  frames: tileWater.frames.map((f) => recolored(f, LAKE_COLOURS)),
};
export const tileLakeB: SpriteDef = {
  id: 'tile_lake_b',
  frameMs: 700,
  frames: [tileWater.frames[1]!, tileWater.frames[0]!].map((f) =>
    dotted(
      recolored(f, LAKE_COLOURS),
      [
        [6, 6],
        [7, 6],
        [8, 7],
        [11, 12],
      ],
      'A',
    ),
  ),
};

const lakeEdgeN: SpriteDef = {
  id: 'tile_lake_edge_n',
  frames: tilePondEdgeN.frames.map((f) => recolored(f, LAKE_COLOURS)),
};
const lakeCornerNW: SpriteDef = {
  id: 'tile_lake_corner_nw',
  frames: tilePondCornerNW.frames.map((f) => recolored(f, LAKE_COLOURS)),
};
export const tileLakeEdgeN = lakeEdgeN;
export const tileLakeEdgeE = rotateSprite(lakeEdgeN, 'tile_lake_edge_e', 1);
export const tileLakeEdgeS = rotateSprite(lakeEdgeN, 'tile_lake_edge_s', 2);
export const tileLakeEdgeW = rotateSprite(lakeEdgeN, 'tile_lake_edge_w', 3);
export const tileLakeCornerNW = lakeCornerNW;
export const tileLakeCornerNE = rotateSprite(lakeCornerNW, 'tile_lake_corner_ne', 1);
export const tileLakeCornerSE = rotateSprite(lakeCornerNW, 'tile_lake_corner_se', 2);
export const tileLakeCornerSW = rotateSprite(lakeCornerNW, 'tile_lake_corner_sw', 3);

/** The lake's jetty: the dock's planks, weathered paler. */
export const objJetty: SpriteDef = {
  id: 'obj_jetty',
  frames: objDock.frames.map((f) => recolored(f, { P: 'x' })),
};

/** A little post with a hammer on its board: an empty building lot, kept for a later building. */
export const objLotSign: SpriteDef = {
  id: 'obj_lot_sign',
  anchor: 'bottom-center',
  frames: [
    [
      '................',
      '................',
      '...kkkkkkkkkk...',
      '..kPPPPPPPPPPk..',
      '..kPPnnnPPPPPk..',
      '..kPPnnnmPPPPk..',
      '..kPPPPPmPPPPk..',
      '..kPPPPPPmPPPk..',
      '..kPPPPPPPmPPk..',
      '..kppppppppppk..',
      '...kkkkMmkkkk...',
      '......kMmk......',
      '......kMmk......',
      '.....kkMmkk.....',
      '....khhMmhhk....',
      '.....kkkkkk.....',
    ],
  ],
};

export const NORTH_SPRITES: readonly SpriteDef[] = [
  objPine,
  objPineB,
  objPineWinter,
  objPineBWinter,
  tileWoodsA,
  tileWoodsB,
  objHedge,
  objHedgeSpring,
  objHedgeAutumn,
  objHedgeWinter,
  tileLakeA,
  tileLakeB,
  tileLakeEdgeN,
  tileLakeEdgeE,
  tileLakeEdgeS,
  tileLakeEdgeW,
  tileLakeCornerNW,
  tileLakeCornerNE,
  tileLakeCornerSE,
  tileLakeCornerSW,
  objJetty,
  objLotSign,
];
