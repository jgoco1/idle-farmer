import { START_GRID } from './balance';
import { CROPS } from './crops';
import type { CropId, ItemId } from './ids';
import { ITEMS } from './items';
import type { CropDef, ItemDef } from './types';

/**
 * Everything in src/data, gathered once (DATA_SCHEMAS.md §4.10). Systems receive it through
 * `ctx.data` and never import data files directly. Each phase adds its tables (fish, recipes, …).
 */
export interface GameData {
  startGrid: { readonly cols: number; readonly rows: number };
  crops: Readonly<Record<CropId, CropDef>>;
  /** Partial until phases 05/06 add fish, junk and dishes. */
  items: Readonly<Partial<Record<ItemId, ItemDef>>>;
}

export const GAME_DATA: GameData = Object.freeze({
  startGrid: START_GRID,
  crops: CROPS,
  items: ITEMS,
});
