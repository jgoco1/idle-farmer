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

function inTileRect(r: TileRect, col: number, row: number): boolean {
  return col >= r.col && col < r.col + r.cols && row >= r.row && row < r.row + r.rows;
}

/** The region a world tile belongs to (lanes and sea between them), or null outside the world. */
export function regionAt(col: number, row: number, layout: WorldLayout = WORLD_LAYOUT): RegionId | null {
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  for (const r of layout.regions) if (inTileRect(r.rect, col, row)) return r.id;
  if (layout.sea.some((s) => inTileRect(s, col, row))) return 'sea';
  return 'lanes';
}
