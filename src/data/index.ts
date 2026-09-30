import { START_GRID } from './balance';
import { CROPS } from './crops';
import { EXPANSIONS } from './expansions';
import { FISH, JUNK } from './fish';
import type { CropId, ExpansionId, FishId, ItemId, JunkId, UpgradeId } from './ids';
import { ITEMS } from './items';
import type { CropDef, ExpansionDef, FishDef, ItemDef, JunkDef, UpgradeDef } from './types';
import { UPGRADES } from './upgrades';

/**
 * Everything in src/data, gathered once (DATA_SCHEMAS.md §4.10). Systems receive it through
 * `ctx.data` and never import data files directly. Each phase adds its tables (fish, recipes, …).
 */
export interface GameData {
  startGrid: { readonly cols: number; readonly rows: number };
  crops: Readonly<Record<CropId, CropDef>>;
  fish: Readonly<Record<FishId, FishDef>>;
  junk: Readonly<Record<JunkId, JunkDef>>;
  /** Partial until phase 06 adds dishes. */
  items: Readonly<Partial<Record<ItemId, ItemDef>>>;
  expansions: Readonly<Record<ExpansionId, ExpansionDef>>;
  /** Partial until phase 06 adds the kitchen. */
  upgrades: Readonly<Partial<Record<UpgradeId, UpgradeDef>>>;
}

export const GAME_DATA: GameData = Object.freeze({
  startGrid: START_GRID,
  crops: CROPS,
  fish: FISH,
  junk: JUNK,
  items: ITEMS,
  expansions: EXPANSIONS,
  upgrades: UPGRADES,
});
