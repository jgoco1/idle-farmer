// The v2 world layout (GDD §12.1, DATA_SCHEMAS.md §9.3): a 36 × 22 tile map whose top-left 20 × 12
// corner is the v1 scene at the same tile coordinates. Regions, lanes, the sea, the town sites, the
// orchard's tree spots and the "For sale" signs are data here, not constants scattered in render code.
//
// The world may only grow right and down. Never move HOME_ORIGIN or shift a region: decorations and
// buildings (v2 phases 02 and 04) are stored in world tiles, and a shift would need a save migration.

import type { ParcelId, TownProjectId } from './ids';
import type { TileRect } from './types';

export const WORLD_COLS = 36;
export const WORLD_ROWS = 22;

/** Where the v1 20 × 12 scene sits in the world. Never changes. */
export const HOME_ORIGIN = { col: 0, row: 0 } as const;
export const HOME_RECT: TileRect = { col: 0, row: 0, cols: 20, rows: 12 };

export type RegionId = 'home' | ParcelId | 'town' | 'lanes' | 'sea';

export interface WorldTile {
  col: number;
  row: number;
}

export interface WorldLayout {
  cols: number;
  rows: number;
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
}

const run = (col: number, row: number, dc: number, dr: number, n: number): WorldTile[] =>
  Array.from({ length: n }, (_, i) => ({ col: col + dc * i, row: row + dr * i }));

export const WORLD_LAYOUT: WorldLayout = Object.freeze({
  cols: WORLD_COLS,
  rows: WORLD_ROWS,
  regions: [
    { id: 'home', rect: HOME_RECT },
    { id: 'orchard', rect: { col: 21, row: 0, cols: 15, rows: 7 } },
    { id: 'yard', rect: { col: 21, row: 8, cols: 15, rows: 7 } },
    { id: 'meadow', rect: { col: 21, row: 16, cols: 15, rows: 4 } },
    { id: 'town', rect: { col: 0, row: 13, cols: 15, rows: 9 } },
  ],
  lanes: [
    ...run(20, 0, 0, 1, 17), // the north–south lane beside home, rows 0–16
    ...run(21, 7, 1, 0, 15), // between the orchard and the paddock
    ...run(21, 15, 1, 0, 15), // between the paddock and the meadow
    ...run(18, 9, 1, 0, 2), // joins the market path to the lane
    ...run(0, 12, 1, 0, 15), // along the top of the town square
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
  },
} satisfies WorldLayout);

/** Short names for toasts and edge pips ("→ Hilltop Orchard"). */
export const REGION_NAMES: Readonly<Record<RegionId, string>> = {
  home: 'Farm',
  orchard: 'Hilltop Orchard',
  yard: 'Old Paddock',
  meadow: 'Seaside Meadow',
  town: 'Town square',
  lanes: 'Lane',
  sea: 'Sea',
};

export function inTileRect(r: TileRect, col: number, row: number): boolean {
  return col >= r.col && col < r.col + r.cols && row >= r.row && row < r.row + r.rows;
}

/** The region a world tile belongs to (lanes and sea between them), or null outside the world. */
export function regionAt(col: number, row: number, layout: WorldLayout = WORLD_LAYOUT): RegionId | null {
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  for (const r of layout.regions) if (inTileRect(r.rect, col, row)) return r.id;
  if (layout.sea.some((s) => inTileRect(s, col, row))) return 'sea';
  return 'lanes';
}

// ---- where decorations may not go (GDD §12.2, v2 phase 02)

/**
 * Home-region rectangles that decorations may never cover, each with the reason shown to the player.
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
