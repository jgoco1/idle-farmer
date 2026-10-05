// The world layout (GDD §12.1, §13.2; DATA_SCHEMAS.md §9.3, §10.3): a 36 × 36 tile map, rows −14 … 21.
// The v1 scene is the 20 × 12 block at (0, 0), the v2 world rows 0 … 21, and the v4 north band rows
// −14 … −1. Regions, lanes, the sea, the town sites, the orchard's tree spots, the north fields and the
// "For sale" signs are data here, not constants scattered in render code.
//
// The world may grow in any direction by adding rows or columns outside it; existing tiles never move.
// HOME_ORIGIN stays (0, 0) and stored positions are world tiles, which may be negative. WORLD_TOP,
// WORLD_BOTTOM and WORLD_COLS are the only place the size is written: code reads them (or WORLD_Y0 /
// WORLD_Y1 in pixels, or the layout), never 0 or WORLD_H as a bound.

import type { NorthFieldId, ParcelId, TownProjectId } from './ids';
import type { TileRect } from './types';

export const WORLD_COLS = 36;
/** The top row (v4: the north band is rows −14 … −1). */
export const WORLD_TOP = -14;
/** One past the bottom row. */
export const WORLD_BOTTOM = 22;
/** A count of rows, never a bound. */
export const WORLD_ROWS = WORLD_BOTTOM - WORLD_TOP;

/** Where the v1 20 × 12 scene sits in the world. Never changes. */
export const HOME_ORIGIN = { col: 0, row: 0 } as const;
export const HOME_RECT: TileRect = { col: 0, row: 0, cols: 20, rows: 12 };

export type RegionId = 'home' | ParcelId | 'town' | 'lanes' | 'sea' | 'northroad' | 'woods';

export interface WorldTile {
  col: number;
  row: number;
}

/** A north field (v4-01, DATA_SCHEMAS §10.3): a fixed plot grid inside its parcel, fenced, with a gate and a path to the north road. */
export interface NorthFieldLayout {
  /** The top-left plot. */
  origin: WorldTile;
  /** Fixed: the north fields have no expansions. */
  grid: { cols: number; rows: number };
  /** The gate in the fence's east rail. */
  gate: WorldTile;
  /** Path tiles from the gate to the north road (col 20), in walking order. */
  path: readonly WorldTile[];
  /** Where the farmhand figure waits after working this field: the path tile by the gate. */
  rest: WorldTile;
}

export interface WorldLayout {
  cols: number;
  rows: number;
  /** The top row (WORLD_TOP); rows run `top … top + rows − 1`. */
  top: number;
  /** Home, the three parcels and the town square. */
  regions: readonly { id: RegionId; rect: TileRect }[];
  /** Scenery path tiles that join the regions. Nothing is placed on them. */
  lanes: readonly WorldTile[];
  /** Always-drawn sea (the water under the old dock is one of them). */
  sea: readonly TileRect[];
  /** Sand: the landing beside the old dock and the Seaside Meadow's beach. */
  sand: readonly TileRect[];
  /** The Old Bridge over the inlet (a town project from v2 phase 02; broken until then). */
  bridge: TileRect;
  /** Where each town project's building stands (the bridge's site is `bridge`). */
  townSites: Readonly<Record<Exclude<TownProjectId, 'old_bridge'>, TileRect>>;
  /** The Community Board sign in the town square. */
  boardTile: WorldTile;
  /** Top-left tiles of the orchard's 2 × 2 tree spots; the last two open with the Orchard Basket bundle. */
  treeSpots: readonly WorldTile[];
  /** The tile each locked parcel's "For sale" sign stands on. */
  forSaleSigns: Readonly<Record<ParcelId, WorldTile>>;
  // ---- the north band (v4-01, GDD §13.2)
  /** The forest along the world's north edge. */
  treeLine: TileRect;
  /** Hawthorn hedges between home, the two fields and their lanes. */
  hedges: readonly TileRect[];
  /** The two field parcels' plot grids, fences, gates and paths. */
  northFields: Readonly<Record<NorthFieldId, NorthFieldLayout>>;
  /** The north road column (col 20) the field paths join. */
  northRoadCol: number;
  /** The restaurant's lot (v4-02 builds on it): 5 × 5, the building and its terrace. */
  restaurantSite: TileRect;
  /** The Press House's lot (v4-03): 4 × 5, the building and its yard. */
  pressSite: TileRect;
  /** The six hive spots at the end of the north road (v4-03). */
  hiveSpots: readonly WorldTile[];
  /** The mountain lake in the North Woods (scenery water until v4-04). */
  lake: TileRect;
  /** The lake's jetty. */
  jetty: WorldTile;
  /** Pines in the North Woods (base tiles, bottom-centre anchored). */
  pines: readonly WorldTile[];
}

const run = (col: number, row: number, dc: number, dr: number, n: number): WorldTile[] =>
  Array.from({ length: n }, (_, i) => ({ col: col + dc * i, row: row + dr * i }));

export const WORLD_LAYOUT: WorldLayout = Object.freeze({
  cols: WORLD_COLS,
  rows: WORLD_ROWS,
  top: WORLD_TOP,
  regions: [
    { id: 'home', rect: HOME_RECT },
    { id: 'orchard', rect: { col: 21, row: 0, cols: 15, rows: 7 } },
    { id: 'yard', rect: { col: 21, row: 8, cols: 15, rows: 7 } },
    { id: 'meadow', rect: { col: 21, row: 16, cols: 15, rows: 4 } },
    { id: 'town', rect: { col: 0, row: 13, cols: 15, rows: 9 } },
    // the north band (v4-01, GDD §13.2)
    { id: 'north_fields', rect: { col: 0, row: -7, cols: 20, rows: 6 } },
    { id: 'terraces', rect: { col: 0, row: -13, cols: 20, rows: 5 } },
    { id: 'northroad', rect: { col: 21, row: -7, cols: 15, rows: 6 } },
    { id: 'woods', rect: { col: 21, row: -13, cols: 15, rows: 5 } },
  ],
  lanes: [
    ...run(20, 0, 0, 1, 17), // the north–south lane beside home, rows 0–16
    ...run(21, 7, 1, 0, 15), // between the orchard and the paddock
    ...run(21, 15, 1, 0, 15), // between the paddock and the meadow
    ...run(18, 9, 1, 0, 2), // joins the market path to the lane
    ...run(0, 12, 1, 0, 15), // along the top of the town square
    ...run(20, -13, 0, 1, 13), // the north road, rows −13 … −1, carrying on from the lane at col 20
    ...run(21, -1, 1, 0, 15), // between the orchard and the north road's hamlet
    ...run(21, -8, 1, 0, 15), // between the hamlet and the North Woods
  ],
  sea: [
    { col: 16, row: 10, cols: 4, rows: 2 }, // under the old dock
    { col: 15, row: 12, cols: 5, rows: 10 }, // the inlet, under the bridge and south
    { col: 20, row: 20, cols: 16, rows: 2 }, // the open sea along the bottom
  ],
  sand: [
    { col: 15, row: 10, cols: 1, rows: 2 }, // the landing beside the dock
    { col: 21, row: 19, cols: 15, rows: 1 }, // the meadow's beach
  ],
  bridge: { col: 15, row: 12, cols: 5, rows: 1 },
  townSites: {
    bakery: { col: 1, row: 14, cols: 3, rows: 3 },
    fountain: { col: 6, row: 15, cols: 3, rows: 3 },
    community_hall: { col: 10, row: 14, cols: 4, rows: 3 },
    bandstand: { col: 2, row: 18, cols: 3, rows: 2 },
    lighthouse: { col: 12, row: 18, cols: 2, rows: 3 },
  },
  boardTile: { col: 4, row: 16 },
  treeSpots: [
    { col: 22, row: 1 },
    { col: 25, row: 1 },
    { col: 28, row: 1 },
    { col: 31, row: 1 },
    { col: 22, row: 4 },
    { col: 25, row: 4 },
    { col: 28, row: 4 },
    { col: 31, row: 4 },
    { col: 34, row: 1 },
    { col: 34, row: 4 },
  ],
  forSaleSigns: {
    orchard: { col: 21, row: 3 },
    yard: { col: 21, row: 11 },
    meadow: { col: 21, row: 17 },
    north_fields: { col: 18, row: -6 },
    terraces: { col: 18, row: -12 },
  },
  treeLine: { col: 0, row: WORLD_TOP, cols: WORLD_COLS, rows: 1 },
  hedges: [
    { col: 0, row: -1, cols: 20, rows: 1 },
    { col: 0, row: -8, cols: 20, rows: 1 },
  ],
  northFields: {
    north_fields: {
      origin: { col: 6, row: -6 },
      grid: { cols: 8, rows: 4 },
      gate: { col: 14, row: -5 },
      path: run(15, -5, 1, 0, 5),
      rest: { col: 15, row: -5 },
    },
    terraces: {
      origin: { col: 6, row: -12 },
      grid: { cols: 8, rows: 3 },
      gate: { col: 14, row: -11 },
      path: run(15, -11, 1, 0, 5),
      rest: { col: 15, row: -11 },
    },
  },
  northRoadCol: 20,
  restaurantSite: { col: 22, row: -6, cols: 5, rows: 5 },
  pressSite: { col: 28, row: -6, cols: 4, rows: 5 },
  hiveSpots: [
    { col: 32, row: -6 },
    { col: 34, row: -6 },
    { col: 32, row: -4 },
    { col: 34, row: -4 },
    { col: 32, row: -2 },
    { col: 34, row: -2 },
  ],
  lake: { col: 27, row: -13, cols: 7, rows: 3 },
  jetty: { col: 30, row: -10 },
  pines: [
    { col: 21, row: -13 },
    { col: 23, row: -13 },
    { col: 25, row: -13 },
    { col: 34, row: -13 },
    { col: 21, row: -11 },
    { col: 24, row: -11 },
    { col: 26, row: -11 },
    { col: 35, row: -11 },
    { col: 33, row: -10 },
    { col: 22, row: -9 },
    { col: 28, row: -9 },
    { col: 31, row: -9 },
    { col: 35, row: -9 },
  ],
} satisfies WorldLayout);

/** The fence ring of a north field: one tile around its plots. */
export function northFenceRect(field: NorthFieldId): TileRect {
  const f = WORLD_LAYOUT.northFields[field];
  return { col: f.origin.col - 1, row: f.origin.row - 1, cols: f.grid.cols + 2, rows: f.grid.rows + 2 };
}

/** Short names for toasts and edge pips ("→ Hilltop Orchard"). */
export const REGION_NAMES: Readonly<Record<RegionId, string>> = {
  home: 'Farm',
  orchard: 'Hilltop Orchard',
  yard: 'Old Paddock',
  meadow: 'Seaside Meadow',
  town: 'Town square',
  lanes: 'Lane',
  sea: 'Sea',
  north_fields: 'North Fields',
  terraces: 'Upper Terraces',
  northroad: 'North Road',
  woods: 'North Woods',
};

export function inTileRect(r: TileRect, col: number, row: number): boolean {
  return col >= r.col && col < r.col + r.cols && row >= r.row && row < r.row + r.rows;
}

/** The region a world tile belongs to (lanes and sea between them), or null outside the world. */
export function regionAt(col: number, row: number, layout: WorldLayout = WORLD_LAYOUT): RegionId | null {
  if (col < 0 || row < layout.top || col >= layout.cols || row >= layout.top + layout.rows) return null;
  for (const r of layout.regions) if (inTileRect(r.rect, col, row)) return r.id;
  if (layout.sea.some((s) => inTileRect(s, col, row))) return 'sea';
  return 'lanes';
}

// ---- where decorations may not go (GDD §12.2, v2 phase 02)

/**
 * Rectangles that decorations may never cover, each with the reason shown to the player.
 * The field is blocked at its largest size (8 × 6 plots) and with its fence ring, so a later expansion
 * never meets a decoration. `tests/world.test.ts` checks these against the scene's zones and paths.
 */
export const DECOR_BLOCKED: readonly { rect: TileRect; why: string }[] = [
  { rect: { col: 5, row: 1, cols: 10, rows: 8 }, why: 'The field and its fence need that room.' },
  { rect: { col: 1, row: 0, cols: 4, rows: 4 }, why: 'The farmhouse stands there.' },
  { rect: { col: 5, row: 3, cols: 1, rows: 1 }, why: 'The farm cat sleeps there.' },
  { rect: { col: 1, row: 7, cols: 4, rows: 4 }, why: 'That is the pond.' },
  { rect: { col: 6, row: 10, cols: 9, rows: 2 }, why: 'That is the river.' },
  { rect: { col: 15, row: 10, cols: 5, rows: 2 }, why: 'That is the old dock.' },
  { rect: { col: 15, row: 6, cols: 3, rows: 3 }, why: 'The market stands there.' },
  { rect: { col: 18, row: 7, cols: 1, rows: 1 }, why: 'The Shipping Bin stands there.' },
  { rect: { col: 15, row: 1, cols: 4, rows: 4 }, why: 'That lot is kept for the greenhouse.' },
  { rect: { col: 15, row: 5, cols: 1, rows: 1 }, why: 'The scarecrow post stands there.' },
  // The home path at every field size (`pathFor` in src/render/scene.ts): row 5 while the field is
  // small, then row 4 to the fence's gates and, at full size, out through the bottom rail at column 13.
  { rect: { col: 2, row: 4, cols: 1, rows: 2 }, why: 'That is a path.' },
  { rect: { col: 3, row: 4, cols: 2, rows: 1 }, why: 'That is a path.' },
  { rect: { col: 13, row: 9, cols: 1, rows: 1 }, why: 'That is a path.' },
  { rect: { col: 3, row: 5, cols: 12, rows: 1 }, why: 'That is a path.' },
  { rect: { col: 14, row: 6, cols: 1, rows: 4 }, why: 'That is a path.' },
  { rect: { col: 15, row: 9, cols: 3, rows: 1 }, why: 'That is a path.' },
  { rect: { col: 0, row: 1, cols: 1, rows: 1 }, why: 'A tree grows there.' },
  { rect: { col: 0, row: 6, cols: 1, rows: 1 }, why: 'A tree grows there.' },
  // The north band (v4-01): each field with its fence ring and its path, the hedges and the tree line.
  { rect: { col: 5, row: -7, cols: 10, rows: 6 }, why: 'The field and its fence need that room.' },
  { rect: { col: 15, row: -5, cols: 5, rows: 1 }, why: 'That is a path.' },
  { rect: { col: 5, row: -13, cols: 10, rows: 5 }, why: 'The field and its fence need that room.' },
  { rect: { col: 15, row: -11, cols: 5, rows: 1 }, why: 'That is a path.' },
  { rect: { col: 0, row: -1, cols: 20, rows: 1 }, why: 'The hedge grows there.' },
  { rect: { col: 0, row: -8, cols: 20, rows: 1 }, why: 'The hedge grows there.' },
  { rect: { col: 0, row: -14, cols: 36, rows: 1 }, why: 'That is the edge of the forest.' },
];

const BLOCKED_BY_TILE: ReadonlyMap<number, string> = (() => {
  const m = new Map<number, string>();
  const key = (col: number, row: number): number => row * WORLD_COLS + col;
  for (const { rect, why } of DECOR_BLOCKED)
    for (let r = rect.row; r < rect.row + rect.rows; r++)
      for (let c = rect.col; c < rect.col + rect.cols; c++) m.set(key(c, r), why);
  for (const t of WORLD_LAYOUT.lanes) m.set(key(t.col, t.row), 'Lanes stay clear.');
  for (const t of WORLD_LAYOUT.treeSpots)
    for (let r = t.row; r < t.row + 2; r++)
      for (let c = t.col; c < t.col + 2; c++) m.set(key(c, r), 'That is a tree spot.');
  return m;
})();

/** Why a fixed feature of the world (the field, a building, a path, a lane, a tree spot) blocks tile (col, row), or null. */
export function fixedBlockReason(col: number, row: number): string | null {
  return BLOCKED_BY_TILE.get(row * WORLD_COLS + col) ?? null;
}
