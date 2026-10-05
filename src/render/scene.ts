// The farm scene as data: the 36 × 22 tile world (v2), the objects placed on it, and the clickable
// zones (GDD §5, §12.1). The v1 20 × 12 scene is the world's top-left corner at the same tiles, so
// every v1 zone, plot and trap keeps its coordinates. Pure (no DOM): layout and hit-testing are
// unit-tested.

import type { Plot } from '../core/state';
import { GREENHOUSE_BASE } from '../data/balance';
import {
  PARCEL_IDS,
  TOWN_PROJECT_IDS,
  type ExpansionId,
  type FishLocationId,
  type ParcelId,
  type TownProjectId,
} from '../data/ids';
import type { TileRect } from '../data/types';
import { HOME_RECT, WORLD_BOTTOM, WORLD_COLS, WORLD_LAYOUT, WORLD_ROWS, WORLD_TOP } from '../data/world';
import { anchoredPosition } from './spriteCache';
import { spriteDef } from './sprites';
import { townSpriteId } from './sprites/town';

export type { TileRect } from '../data/types';

export const TILE = 16;
/** The home region (the whole v1 scene) in logical pixels: 320 × 192. */
export const HOME_W = HOME_RECT.cols * TILE;
export const HOME_H = HOME_RECT.rows * TILE;
/** The world's size in logical pixels: 576 × 576 (v4). Sizes, never bounds: see WORLD_Y0 / WORLD_Y1. */
export const WORLD_W = WORLD_COLS * TILE;
export const WORLD_H = WORLD_ROWS * TILE;
/** The world's top and bottom edges in world pixels (−224 and 352): the north band has negative rows. */
export const WORLD_Y0 = WORLD_TOP * TILE;
export const WORLD_Y1 = WORLD_BOTTOM * TILE;

/** Top-left tile of the plot grid. The grid grows right and down from here (4 × 2 → 8 × 6). */
export const PLOT_ORIGIN = { col: 6, row: 2 } as const;

export type ZoneId =
  'plots' | 'pet' | 'farmhouse' | 'pond' | 'market' | 'bin' | 'greenhouse' | 'river' | 'dock' | 'board';

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

/** The centre of the plot grid in world pixels (v2-05: where a phone's default view looks). */
export function fieldCentre(
  grid: Grid,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  out.x = (PLOT_ORIGIN.col + grid.cols / 2) * TILE;
  out.y = (PLOT_ORIGIN.row + grid.rows / 2) * TILE;
  return out;
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
    { id: 'board', rect: { ...WORLD_LAYOUT.boardTile, cols: 1, rows: 1 }, label: 'Community Board' },
  ];
}

export function inRect(r: TileRect, col: number, row: number): boolean {
  return col >= r.col && col < r.col + r.cols && row >= r.row && row < r.row + r.rows;
}

export function zoneAt(zones: readonly Zone[], col: number, row: number): Zone | null {
  return zones.find((z) => inRect(z.rect, col, row)) ?? null;
}

/** World pixel → world tile, or null outside the world. */
export function tileAt(x: number, y: number): { col: number; row: number } | null {
  if (x < 0 || y < WORLD_Y0 || x >= WORLD_W || y >= WORLD_Y1) return null;
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

/** The locked parcel whose "For sale" sign stands on tile (col, row), or null. */
export function forSaleSignAt(owned: readonly ParcelId[], col: number, row: number): ParcelId | null {
  for (const id of PARCEL_IDS) {
    const t = WORLD_LAYOUT.forSaleSigns[id];
    if (t.col === col && t.row === row && !owned.includes(id)) return id;
  }
  return null;
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
  w: number; // size in px, for culling
  h: number;
}

export interface SceneLayout {
  /** Ground sprite id for every tile, [row − WORLD_TOP][col] (see `groundAt`). */
  ground: string[][];
  /** Tiles whose ground animates (water), redrawn every frame. */
  animated: { col: number; row: number; sprite: string }[];
  /** Objects drawn over the ground, sorted by their bottom edge so nearer things overlap farther ones. */
  objects: PlacedSprite[];
}

/** The ground sprite at world tile (col, row) (rows may be negative), or '' outside the world. */
export function groundAt(ground: readonly (readonly string[])[], col: number, row: number): string {
  return ground[row - WORLD_TOP]?.[col] ?? '';
}

/** Cheap deterministic hash for cosmetic variety (never game state, never the game RNG). */
export function tileHash(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The fence ring around the plot grid: one tile wider than the field on every side. */
export function fenceRect(grid: Grid): TileRect {
  const plots = plotRect(grid);
  return { col: plots.col - 1, row: plots.row - 1, cols: plots.cols + 2, rows: plots.rows + 2 };
}

/** A gate in the field fence: `v` on a side, `h` in the bottom rail. */
export interface FenceGate {
  col: number;
  row: number;
  sprite: 'obj_fence_gate_v' | 'obj_fence_gate_h';
}

/**
 * The home path for this field size: from the farmhouse door to the field, the market and the
 * Shipping Bin (where the lane carries on). While the field is small the path runs below its fence;
 * once the field reaches the path's row, the path leads to a gate on each side of the fence instead of
 * running under it, and from the fourth expansion (the fence reaches column 14) it leaves through a gate
 * in the bottom rail. `DECOR_BLOCKED` in `src/data/world.ts` covers every tile of every size.
 */
export function pathFor(grid: Grid): { tiles: [number, number][]; gates: FenceGate[] } {
  const f = fenceRect(grid);
  const right = f.col + f.cols - 1;
  const bottom = f.row + f.rows - 1;
  const tiles: [number, number][] = [];
  const run = (c0: number, r0: number, c1: number, r1: number): void => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles.push([c, r]);
  };
  const toBin = (row: number): void => run(14, row, 17, row);
  if (bottom < 5) {
    // The first field: along row 5 under the fence, down beside the market, across to the bin.
    run(2, 4, 2, 5);
    run(3, 5, 14, 5);
    run(14, 6, 14, 8);
    toBin(9);
    return { tiles, gates: [] };
  }
  const gates: FenceGate[] = [{ col: f.col, row: 4, sprite: 'obj_fence_gate_v' }];
  run(2, 4, 4, 4); // the door to the west gate
  if (right < 14) {
    gates.push({ col: right, row: 4, sprite: 'obj_fence_gate_v' });
    run(right + 1, 4, 14, 4);
    run(14, 5, 14, 8);
    toBin(9);
  } else {
    gates.push({ col: 13, row: bottom, sprite: 'obj_fence_gate_h' });
    run(13, bottom + 1, 13, 9);
    toBin(9);
  }
  return { tiles, gates };
}

/**
 * Base tiles of the forest trees (bottom-centre anchored), kept clear of every zone and the largest
 * fence. The forest edge runs along the world's edges (GDD §12.1).
 */
const TREES: readonly [number, number][] = [
  [0, 1],
  [0, 6],
  [0, 21],
  [8, 21],
];

/**
 * Scenery that purchases change (BALANCE.md §5, §13.1). Each entry is shown while `until` has not
 * been bought, or once `from` has; `untilParcel` hides it once that parcel is owned. Tiles are
 * top-left for 1-tile sprites and the base tile for bottom-centre ones. (Player decorations are
 * v2 phase 02's `decor`; this is the fixed scenery.)
 */
interface Scenery {
  sprite: string;
  col: number;
  row: number;
  until?: ExpansionId;
  from?: ExpansionId;
  untilParcel?: ParcelId;
}

const SCENERY: readonly Scenery[] = [
  // farm_1 "Clear the Weeds": weeds and a stump south of the field.
  { sprite: 'obj_weeds', col: 6, row: 6, until: 'farm_1' },
  { sprite: 'obj_stump', col: 8, row: 6, until: 'farm_1' },
  { sprite: 'obj_weeds', col: 10, row: 6, until: 'farm_1' },
  // farm_2 "Mend the Fence": stepping stones on the paths (by the door and the bin; both are path from
  // farm_1 on, see `pathFor`).
  ...[
    [2, 4],
    [3, 4],
    [4, 4],
    [15, 9],
    [16, 9],
    [17, 9],
  ].map(([col, row]): Scenery => ({ sprite: 'obj_stones', col: col!, row: row!, from: 'farm_2' })),
  // farm_3 "Old Orchard Plot": two old trees are cleared (one in the way of the wider fence, one on
  // the greenhouse lot).
  { sprite: 'obj_tree', col: 12, row: 1, until: 'farm_3' },
  { sprite: 'obj_tree', col: 17, row: 4, until: 'farm_3' },
  // farm_4 "The Back Forty": a scarecrow post by the market path.
  { sprite: 'obj_scarecrow_post', col: 15, row: 5, from: 'farm_4' },
  // River Access: a small footbridge over the river.
  { sprite: 'obj_bridge', col: 10, row: 10, from: 'river' },
  { sprite: 'obj_bridge', col: 10, row: 11, from: 'river' },
  // Old Dock: a plank walkway out to sea on posts; until then a "For sale" sign on the shore.
  { sprite: 'obj_for_sale', col: 15, row: 10, until: 'ocean' },
  { sprite: 'obj_dock', col: 16, row: 10, from: 'ocean' },
  { sprite: 'obj_dock', col: 17, row: 10, from: 'ocean' },
  { sprite: 'obj_dock', col: 18, row: 10, from: 'ocean' },
  { sprite: 'obj_dock_post', col: 16, row: 11, from: 'ocean' },
  { sprite: 'obj_dock_post', col: 18, row: 11, from: 'ocean' },
  // The Community Board in the town square.
  { sprite: 'obj_board', col: WORLD_LAYOUT.boardTile.col, row: WORLD_LAYOUT.boardTile.row },
  // Each locked parcel: its "For sale" sign and overgrowth (tall grass, weeds and a stump or two).
  ...PARCEL_IDS.flatMap((id) => [
    { sprite: 'obj_for_sale', ...WORLD_LAYOUT.forSaleSigns[id], untilParcel: id },
    ...overgrowth(id),
  ]),
];

/** Deterministic overgrowth on a locked parcel (cosmetic variety from `tileHash`, never the game RNG). */
function overgrowth(id: ParcelId): Scenery[] {
  const rect = WORLD_LAYOUT.regions.find((r) => r.id === id)!.rect;
  const sign = WORLD_LAYOUT.forSaleSigns[id];
  const out: Scenery[] = [];
  for (let row = rect.row; row < rect.row + rect.rows; row++)
    for (let col = rect.col; col < rect.col + rect.cols; col++) {
      if (col === sign.col && row === sign.row) continue;
      if (WORLD_LAYOUT.sand.some((s) => inRect(s, col, row))) continue;
      const v = tileHash(col + 311, row + 17);
      const sprite = v < 0.24 ? 'obj_tall_grass' : v < 0.3 ? 'obj_weeds' : v < 0.32 ? 'obj_stump' : null;
      if (sprite) out.push({ sprite, col, row, untilParcel: id });
    }
  return out;
}

/** What the town and the farmhouse look like (changes when a stage is finished or a style applied). */
export interface SceneLook {
  /** Sprite id of the farmhouse (`obj_farmhouse` or a styled one). */
  farmhouse: string;
  /** Stages finished per project; missing = 0 (the ruin). */
  stages: Readonly<Partial<Record<TownProjectId, number>>>;
}

export const DEFAULT_LOOK: SceneLook = { farmhouse: 'obj_farmhouse', stages: {} };

/** The rectangle of a project's site in world tiles (the bridge's is `WORLD_LAYOUT.bridge`). */
export function townSiteRect(id: TownProjectId): TileRect {
  return id === 'old_bridge' ? WORLD_LAYOUT.bridge : WORLD_LAYOUT.townSites[id];
}

/** The project whose site covers tile (col, row), or null. */
export function townSiteAt(col: number, row: number): TownProjectId | null {
  for (const id of TOWN_PROJECT_IDS) if (inRect(townSiteRect(id), col, row)) return id;
  return null;
}

/** Top-left of a project's sprite in world px: the site's width, its bottom edge on the site's bottom edge. */
export function townSpritePos(id: TownProjectId, spriteH: number): { x: number; y: number } {
  const r = townSiteRect(id);
  return { x: r.col * TILE, y: (r.row + r.rows) * TILE - spriteH };
}

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

/** The sea (always drawn since v2: under the dock, the inlet and the open sea) and the sand beside it. */
function seaTile(col: number, row: number): string | null {
  for (const r of WORLD_LAYOUT.sand) if (inRect(r, col, row)) return r.col === 15 ? 'tile_path' : 'tile_sand';
  for (const r of WORLD_LAYOUT.sea) if (inRect(r, col, row)) return 'tile_sea';
  return null;
}

const LANE_TILES = new Set(WORLD_LAYOUT.lanes.map((t) => `${t.col},${t.row}`));

/** The scenery shown for these purchases. */
export function sceneryFor(expansions: readonly ExpansionId[], parcels: readonly ParcelId[] = []): Scenery[] {
  return SCENERY.filter(
    (d) =>
      (!d.until || !expansions.includes(d.until)) &&
      (!d.from || expansions.includes(d.from)) &&
      (!d.untilParcel || !parcels.includes(d.untilParcel)),
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

function placed(sprite: string, x: number, y: number): PlacedSprite {
  const f = spriteDef(sprite).frames[0];
  return { sprite, x, y, w: f?.[0]?.length ?? TILE, h: f?.length ?? TILE };
}

function placedAt(sprite: string, col: number, row: number): PlacedSprite {
  const pos = anchoredPosition(spriteDef(sprite), col, row, TILE);
  return placed(sprite, pos.x, pos.y);
}

/** The static layout of the whole world for this farm grid and these purchases. */
export function buildLayout(
  grid: Grid,
  expansions: readonly ExpansionId[] = [],
  parcels: readonly ParcelId[] = [],
  look: SceneLook = DEFAULT_LOOK,
): SceneLayout {
  const plots = plotRect(grid);
  const fence = fenceRect(grid);
  const path = pathFor(grid);
  const paths = new Set(path.tiles.map(([c, r]) => `${c},${r}`));
  for (const g of path.gates) paths.add(`${g.col},${g.row}`); // the path runs through its gates
  const zones = buildZones(grid);
  const scenery = sceneryFor(expansions, parcels);
  const sceneryTiles = new Set(scenery.map((d) => `${d.col},${d.row}`));
  const sites = [...Object.values(WORLD_LAYOUT.townSites)];

  const ground: string[][] = [];
  const animated: SceneLayout['animated'] = [];
  const objects: PlacedSprite[] = [];

  for (let row = WORLD_TOP; row < WORLD_BOTTOM; row++) {
    const line: string[] = [];
    for (let col = 0; col < WORLD_COLS; col++) {
      const pond = pondTile(col, row);
      const river = expansions.includes('river') ? riverTile(col, row) : null;
      const sea = seaTile(col, row);
      const key = `${col},${row}`;
      let tile: string;
      if (pond) tile = pond;
      else if (river) tile = river;
      else if (sea) tile = sea;
      else if (inRect(plots, col, row)) tile = 'tile_soil_dry';
      else if (paths.has(key) || LANE_TILES.has(key)) tile = 'tile_path';
      else if (sites.some((r) => inRect(r, col, row))) tile = 'tile_soil_untilled';
      else {
        const v = tileHash(col, row);
        tile = v < 0.5 ? 'tile_grass_a' : v < 0.8 ? 'tile_grass_b' : 'tile_grass_c';
      }
      line.push(tile);
      if (ANIMATED_TILES.includes(tile)) animated.push({ col, row, sprite: tile });

      // Wild flowers on open grass, away from buildings, zones, paths, fences and scenery.
      const onFence = inRect(fence, col, row) && !inRect(plots, col, row);
      if (tile.startsWith('tile_grass') && !onFence && !zoneAt(zones, col, row) && !sceneryTiles.has(key)) {
        const f = tileHash(col + 101, row + 57);
        if (f < 0.1) objects.push(placed('obj_flower_a', col * TILE, row * TILE));
        else if (f < 0.16) objects.push(placed('obj_flower_b', col * TILE, row * TILE));
      }
    }
    ground.push(line);
  }

  // Fence around the plot grid: corner posts, rails along the top and bottom, a rail with posts down
  // each side, and a gate wherever the path meets it.
  const right = fence.col + fence.cols - 1;
  const bottom = fence.row + fence.rows - 1;
  const gateAt = (col: number, row: number): FenceGate | undefined =>
    path.gates.find((g) => g.col === col && g.row === row);
  for (let row = fence.row; row <= bottom; row++)
    for (let col = fence.col; col <= right; col++) {
      const top = row === fence.row;
      const low = row === bottom;
      const side = col === fence.col || col === right;
      if (!top && !low && !side) continue;
      let sprite: string;
      const gate = gateAt(col, row);
      if (gate) sprite = gate.sprite;
      else if (top && col === fence.col) sprite = 'obj_fence_nw';
      else if (top && col === right) sprite = 'obj_fence_ne';
      else if (low && col === fence.col) sprite = 'obj_fence_sw';
      else if (low && col === right) sprite = 'obj_fence_se';
      else if (top || low) sprite = 'obj_fence_h';
      else sprite = 'obj_fence_v';
      objects.push(placed(sprite, col * TILE, row * TILE));
    }

  // A loft rises one tile above the farmhouse's usual spot; its bottom stays where it was.
  const house = placed(look.farmhouse, 1 * TILE, 1 * TILE);
  house.y = 4 * TILE - house.h;
  objects.push(house);
  for (const id of TOWN_PROJECT_IDS) {
    const sprite = townSpriteId(id, look.stages[id] ?? 0);
    const h = spriteDef(sprite).frames[0]!.length;
    const pos = townSpritePos(id, h);
    objects.push(placed(sprite, pos.x, pos.y));
  }
  objects.push(placed('obj_market_stall', 15 * TILE, 6 * TILE));
  objects.push(placed('obj_shipping_bin', BIN_TILE.col * TILE, BIN_TILE.row * TILE));
  for (const [col, row] of TREES) objects.push(placedAt('obj_tree', col, row));
  for (const d of scenery) objects.push(placedAt(d.sprite, d.col, d.row));

  objects.sort((a, b) => a.y + a.h - (b.y + b.h));
  return { ground, animated, objects };
}

// ---- plots (phase 02)

/** What to draw on one plot: its soil tile and, if anything grows there, the crop sprite. */
export interface PlotSprites {
  soil: string;
  crop: string | null;
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
