// The farm scene as data: a 20 × 12 tile map, the objects placed on it, and the clickable zones
// (GDD §5). Pure (no DOM), so layout and hit-testing are unit-tested.

import type { Plot } from '../core/state';
import { GREENHOUSE_BASE } from '../data/balance';
import type { ExpansionId, FishLocationId } from '../data/ids';
import { anchoredPosition } from './spriteCache';
import { spriteDef } from './sprites';

export const TILE = 16;
export const SCENE_COLS = 20;
export const SCENE_ROWS = 12;
export const SCENE_W = SCENE_COLS * TILE; // 320
export const SCENE_H = SCENE_ROWS * TILE; // 192

/** Top-left tile of the plot grid. The grid grows right and down from here (4 × 2 → 8 × 6). */
export const PLOT_ORIGIN = { col: 6, row: 2 } as const;

export interface TileRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export type ZoneId =
  'plots' | 'pet' | 'farmhouse' | 'pond' | 'market' | 'bin' | 'greenhouse' | 'river' | 'dock';

/** The water tiles where each location's fish traps float, by slot (BALANCE.md §4: two per location, a third once the Pond Fish bundle is done). */
export const TRAP_TILES: Readonly<Record<FishLocationId, readonly { col: number; row: number }[]>> = {
  pond: [
    { col: 2, row: 9 },
    { col: 3, row: 8 },
    { col: 3, row: 9 },
  ],
  river: [
    { col: 8, row: 11 },
    { col: 12, row: 11 },
    { col: 13, row: 11 },
  ],
  ocean: [
    { col: 17, row: 11 },
    { col: 19, row: 11 },
    { col: 19, row: 10 },
  ],
};

export function trapTile(location: FishLocationId, slot: number): { col: number; row: number } {
  const tiles = TRAP_TILES[location];
  return tiles[slot] ?? tiles[0]!;
}

/** The zone that opens fishing at each location. */
export const LOCATION_ZONE: Readonly<Record<FishLocationId, ZoneId>> = {
  pond: 'pond',
  river: 'river',
  ocean: 'dock',
};

/** The Shipping Bin tile (GDD §5). */
export const BIN_TILE = { col: 18, row: 7 } as const;

export interface Zone {
  id: ZoneId;
  rect: TileRect;
  label: string;
}

export interface Grid {
  cols: number;
  rows: number;
}

export function plotRect(grid: Grid): TileRect {
  return { col: PLOT_ORIGIN.col, row: PLOT_ORIGIN.row, cols: grid.cols, rows: grid.rows };
}

/** Clickable zones, in hit-test priority order. */
/** Where the farm cat sleeps, beside the farmhouse door. */
export const PET_TILE = { col: 5, row: 3 } as const;

export function buildZones(grid: Grid): Zone[] {
  return [
    { id: 'plots', rect: plotRect(grid), label: 'Fields' },
    { id: 'pet', rect: { ...PET_TILE, cols: 1, rows: 1 }, label: 'Farm cat' },
    { id: 'farmhouse', rect: { col: 1, row: 1, cols: 4, rows: 3 }, label: 'Farmhouse' },
    { id: 'pond', rect: { col: 1, row: 7, cols: 4, rows: 4 }, label: 'Pond' },
    { id: 'market', rect: { col: 15, row: 6, cols: 3, rows: 3 }, label: 'Market' },
    { id: 'bin', rect: { ...BIN_TILE, cols: 1, rows: 1 }, label: 'Shipping Bin' },
    { id: 'greenhouse', rect: { col: 15, row: 1, cols: 4, rows: 4 }, label: 'Empty lot' },
    { id: 'river', rect: { col: 6, row: 10, cols: 9, rows: 2 }, label: 'Riverbank' },
    { id: 'dock', rect: { col: 15, row: 10, cols: 5, rows: 2 }, label: 'Old dock' },
  ];
}

export function inRect(r: TileRect, col: number, row: number): boolean {
  return col >= r.col && col < r.col + r.cols && row >= r.row && row < r.row + r.rows;
}

export function zoneAt(zones: readonly Zone[], col: number, row: number): Zone | null {
  return zones.find((z) => inRect(z.rect, col, row)) ?? null;
}

/** Logical scene pixel → tile, or null outside the scene. */
export function tileAt(x: number, y: number): { col: number; row: number } | null {
  if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) return null;
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

/**
 * Greenhouse plot i sits at this offset in the 4 × 3 block under the roof (tile (15,2)): the first six
 * fill a 3 × 2 block, the rest grow it to 4 × 3, so buying level 2 never moves a plot.
 */
export const GREENHOUSE_LAYOUT: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 0],
  [3, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [3, 2],
];
export const GREENHOUSE_ORIGIN = { col: 15, row: 2 } as const;
export const GREENHOUSE_ROOF_TILE = { col: 15, row: 1 } as const;

export function greenhouseTile(i: number): { col: number; row: number } {
  const [dc, dr] = GREENHOUSE_LAYOUT[i] ?? [0, 0];
  return { col: GREENHOUSE_ORIGIN.col + dc, row: GREENHOUSE_ORIGIN.row + dr };
}

/**
 * Tile of any plot index (field row-major, or GREENHOUSE_BASE + n). `out` lets the renderer reuse
 * one object every frame instead of allocating one per plot.
 */
export function tileOfPlot(
  grid: Grid,
  index: number,
  out: { col: number; row: number } = { col: 0, row: 0 },
): { col: number; row: number } {
  if (index >= GREENHOUSE_BASE) {
    const at = GREENHOUSE_LAYOUT[index - GREENHOUSE_BASE];
    out.col = GREENHOUSE_ORIGIN.col + (at ? at[0] : 0);
    out.row = GREENHOUSE_ORIGIN.row + (at ? at[1] : 0);
  } else {
    out.col = PLOT_ORIGIN.col + (index % grid.cols);
    out.row = PLOT_ORIGIN.row + Math.floor(index / grid.cols);
  }
  return out;
}

/**
 * Plot index of a tile: row-major inside the field, GREENHOUSE_BASE + n on a built greenhouse
 * plot, else -1.
 */
export function plotIndexAt(grid: Grid, col: number, row: number, greenhousePlots = 0): number {
  for (let i = 0; i < greenhousePlots; i++) {
    const t = greenhouseTile(i);
    if (t.col === col && t.row === row) return GREENHOUSE_BASE + i;
  }
  const r = plotRect(grid);
  if (!inRect(r, col, row)) return -1;
  return (row - r.row) * grid.cols + (col - r.col);
}

// ---- layout

export interface PlacedSprite {
  sprite: string;
  x: number; // logical px, top-left
  y: number;
}

export interface SceneLayout {
  /** Ground sprite id for every tile, [row][col]. */
  ground: string[][];
  /** Tiles whose ground animates (water), redrawn every frame. */
  animated: { col: number; row: number; sprite: string }[];
  /** Objects drawn over the ground, sorted by their bottom edge so nearer things overlap farther ones. */
  objects: PlacedSprite[];
}

/** Cheap deterministic hash for cosmetic variety (never game state, never the game RNG). */
export function tileHash(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const PATH_TILES: readonly [number, number][] = [
  [2, 4],
  [2, 5],
  ...Array.from({ length: 12 }, (_, i): [number, number] => [3 + i, 5]),
  [14, 6],
  [14, 7],
  [14, 8],
  [14, 9],
  [15, 9],
  [16, 9],
  [17, 9],
];

/** Base tiles of trees (bottom-centre anchored), kept clear of every zone and the largest fence. */
const TREES: readonly [number, number][] = [
  [0, 1],
  [19, 1],
  [19, 5],
  [0, 6],
];

/**
 * Scenery that expansions change (BALANCE.md §5). Each entry is shown while `until` has not been
 * bought, or once `from` has. Tiles are top-left for 1-tile sprites and the base tile for
 * bottom-centre ones.
 */
interface Decor {
  sprite: string;
  col: number;
  row: number;
  until?: ExpansionId;
  from?: ExpansionId;
}

const DECOR: readonly Decor[] = [
  // farm_1 "Clear the Weeds": weeds and a stump south of the field.
  { sprite: 'obj_weeds', col: 6, row: 6, until: 'farm_1' },
  { sprite: 'obj_stump', col: 8, row: 6, until: 'farm_1' },
  { sprite: 'obj_weeds', col: 10, row: 6, until: 'farm_1' },
  // farm_2 "Mend the Fence": stepping stones on the paths.
  ...[
    [2, 4],
    [2, 5],
    [3, 5],
    [4, 5],
    [15, 9],
    [16, 9],
    [17, 9],
  ].map(([col, row]): Decor => ({ sprite: 'obj_stones', col: col!, row: row!, from: 'farm_2' })),
  // farm_3 "Old Orchard Plot": two old trees are cleared (one in the way of the wider fence, one on
  // the greenhouse lot).
  { sprite: 'obj_tree', col: 12, row: 1, until: 'farm_3' },
  { sprite: 'obj_tree', col: 17, row: 4, until: 'farm_3' },
  // farm_4 "The Back Forty": a scarecrow post by the market path.
  { sprite: 'obj_scarecrow_post', col: 15, row: 5, from: 'farm_4' },
  // River Access: a small footbridge over the river.
  { sprite: 'obj_bridge', col: 10, row: 10, from: 'river' },
  { sprite: 'obj_bridge', col: 10, row: 11, from: 'river' },
  // Old Dock: a plank walkway out to sea on posts.
  { sprite: 'obj_dock', col: 16, row: 10, from: 'ocean' },
  { sprite: 'obj_dock', col: 17, row: 10, from: 'ocean' },
  { sprite: 'obj_dock', col: 18, row: 10, from: 'ocean' },
  { sprite: 'obj_dock_post', col: 16, row: 11, from: 'ocean' },
  { sprite: 'obj_dock_post', col: 18, row: 11, from: 'ocean' },
];

/** Water tiles that animate every frame. */
const ANIMATED_TILES: readonly string[] = ['tile_water', 'tile_river', 'tile_sea'];

/** The river along the bottom edge (row 10 is the bank, row 11 the current). */
function riverTile(col: number, row: number): string | null {
  const r = { col: 6, row: 10, cols: 9, rows: 2 };
  if (!inRect(r, col, row)) return null;
  const left = col === r.col;
  const right = col === r.col + r.cols - 1;
  if (row === r.row) return left ? 'tile_pond_corner_nw' : right ? 'tile_pond_corner_ne' : 'tile_pond_edge_n';
  return left ? 'tile_pond_edge_w' : right ? 'tile_pond_edge_e' : 'tile_river';
}

/** The open sea beside the dock: a sandy landing at the left, then water. */
function seaTile(col: number, row: number): string | null {
  if (col < 15 || col > 19 || row < 10 || row > 11) return null;
  return col === 15 ? 'tile_path' : 'tile_sea';
}

export function decorFor(expansions: readonly ExpansionId[]): Decor[] {
  return DECOR.filter(
    (d) => (!d.until || !expansions.includes(d.until)) && (!d.from || expansions.includes(d.from)),
  );
}

function pondTile(col: number, row: number): string | null {
  const r = { col: 1, row: 7, cols: 4, rows: 4 };
  if (!inRect(r, col, row)) return null;
  const top = row === r.row;
  const bottom = row === r.row + r.rows - 1;
  const left = col === r.col;
  const right = col === r.col + r.cols - 1;
  if (top && left) return 'tile_pond_corner_nw';
  if (top && right) return 'tile_pond_corner_ne';
  if (bottom && left) return 'tile_pond_corner_sw';
  if (bottom && right) return 'tile_pond_corner_se';
  if (top) return 'tile_pond_edge_n';
  if (bottom) return 'tile_pond_edge_s';
  if (left) return 'tile_pond_edge_w';
  if (right) return 'tile_pond_edge_e';
  return 'tile_water';
}

export function buildLayout(grid: Grid, expansions: readonly ExpansionId[] = []): SceneLayout {
  const plots = plotRect(grid);
  const fence: TileRect = {
    col: plots.col - 1,
    row: plots.row - 1,
    cols: plots.cols + 2,
    rows: plots.rows + 2,
  };
  const paths = new Set(PATH_TILES.map(([c, r]) => `${c},${r}`));
  const zones = buildZones(grid);
  const decor = decorFor(expansions);
  const decorTiles = new Set(decor.map((d) => `${d.col},${d.row}`));

  const ground: string[][] = [];
  const animated: SceneLayout['animated'] = [];
  const objects: PlacedSprite[] = [];

  for (let row = 0; row < SCENE_ROWS; row++) {
    const line: string[] = [];
    for (let col = 0; col < SCENE_COLS; col++) {
      const pond = pondTile(col, row);
      const river = expansions.includes('river') ? riverTile(col, row) : null;
      const sea = expansions.includes('ocean') ? seaTile(col, row) : null;
      let tile: string;
      if (pond) tile = pond;
      else if (river) tile = river;
      else if (sea) tile = sea;
      else if (inRect(plots, col, row)) tile = 'tile_soil_dry';
      else if (paths.has(`${col},${row}`)) tile = 'tile_path';
      else {
        const v = tileHash(col, row);
        tile = v < 0.5 ? 'tile_grass_a' : v < 0.8 ? 'tile_grass_b' : 'tile_grass_c';
      }
      line.push(tile);
      if (ANIMATED_TILES.includes(tile)) animated.push({ col, row, sprite: tile });

      // Wild flowers on open grass, away from buildings, zones, paths and fences.
      const onFence = inRect(fence, col, row) && !inRect(plots, col, row);
      if (
        tile.startsWith('tile_grass') &&
        !onFence &&
        !zoneAt(zones, col, row) &&
        !decorTiles.has(`${col},${row}`)
      ) {
        const f = tileHash(col + 101, row + 57);
        if (f < 0.1) objects.push({ sprite: 'obj_flower_a', x: col * TILE, y: row * TILE });
        else if (f < 0.16) objects.push({ sprite: 'obj_flower_b', x: col * TILE, y: row * TILE });
      }
    }
    ground.push(line);
  }

  // Fence around the plot grid: rails along the top and bottom rows, posts down the sides.
  for (let col = fence.col; col < fence.col + fence.cols; col++) {
    objects.push({ sprite: 'obj_fence_h', x: col * TILE, y: fence.row * TILE });
    objects.push({ sprite: 'obj_fence_h', x: col * TILE, y: (fence.row + fence.rows - 1) * TILE });
  }
  for (let row = fence.row + 1; row < fence.row + fence.rows - 1; row++) {
    objects.push({ sprite: 'obj_fence_v', x: fence.col * TILE, y: row * TILE });
    objects.push({ sprite: 'obj_fence_v', x: (fence.col + fence.cols - 1) * TILE, y: row * TILE });
  }

  objects.push({ sprite: 'obj_farmhouse', x: 1 * TILE, y: 1 * TILE });
  objects.push({ sprite: 'obj_market_stall', x: 15 * TILE, y: 6 * TILE });
  objects.push({ sprite: 'obj_shipping_bin', x: BIN_TILE.col * TILE, y: BIN_TILE.row * TILE });
  for (const [col, row] of TREES) {
    const pos = anchoredPosition(spriteDef('obj_tree'), col, row, TILE);
    objects.push({ sprite: 'obj_tree', ...pos });
  }
  for (const d of decor) {
    objects.push({ sprite: d.sprite, ...anchoredPosition(spriteDef(d.sprite), d.col, d.row, TILE) });
  }

  const bottom = (o: PlacedSprite): number => o.y + (spriteDef(o.sprite).frames[0]?.length ?? TILE);
  objects.sort((a, b) => bottom(a) - bottom(b));
  return { ground, animated, objects };
}

// ---- plots (phase 02)

/** What to draw on one plot: its soil tile and, if anything grows there, the crop sprite. */
export interface PlotSprites {
  soil: string;
  crop: string | null;
}

/** Tile (col, row) of plot `index` in a row-major grid. */
export function plotTile(grid: Grid, index: number): { col: number; row: number } {
  return { col: PLOT_ORIGIN.col + (index % grid.cols), row: PLOT_ORIGIN.row + Math.floor(index / grid.cols) };
}

/** `crop_<id>_<stage>` sprite ids, built once rather than as a new string for every plot every frame. */
const cropSpriteIds = new Map<string, string[]>();
function cropSpriteId(crop: string, stage: number): string {
  let ids = cropSpriteIds.get(crop);
  if (!ids) {
    ids = [0, 1, 2, 3, 4].map((st) => `crop_${crop}_${st}`);
    cropSpriteIds.set(crop, ids);
  }
  return ids[stage]!;
}

/**
 * Sprites for every plot. `stageOf` returns the crop stage 0–4 (see systems/farming `plotStage`),
 * passed in so the renderer stays free of game rules.
 */
export function plotSprites(
  plots: readonly Plot[],
  stageOf: (plot: Plot) => number,
  wetAt: (index: number) => boolean = (i) => (plots[i]?.waterMsLeft ?? 0) > 0,
): PlotSprites[] {
  return plotSpritesInto([], plots, stageOf, wetAt);
}

/** `plotSprites` into an array that is reused from frame to frame (its entries are overwritten). */
export function plotSpritesInto(
  out: PlotSprites[],
  plots: readonly Plot[],
  stageOf: (plot: Plot) => number,
  wetAt: (index: number) => boolean = (i) => (plots[i]?.waterMsLeft ?? 0) > 0,
): PlotSprites[] {
  out.length = plots.length;
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i]!;
    const e = (out[i] ??= { soil: 'tile_soil_dry', crop: null });
    e.soil = plot.state === 'untilled' ? 'tile_soil_untilled' : wetAt(i) ? 'tile_soil_wet' : 'tile_soil_dry';
    e.crop =
      plot.state === 'dead'
        ? 'crop_dead'
        : plot.state === 'planted' && plot.crop
          ? cropSpriteId(plot.crop, Math.min(4, Math.max(0, stageOf(plot))))
          : null;
  }
  return out;
}
