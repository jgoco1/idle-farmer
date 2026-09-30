import { START_GRID } from './balance';
import { BUFFS } from './buffs';
import { CROPS } from './crops';
import { EXPANSIONS } from './expansions';
import { FISH, JUNK } from './fish';
import type {
  BuffType,
  CropId,
  ExpansionId,
  FishId,
  ItemId,
  JunkId,
  RecipeId,
  SeasonId,
  UpgradeId,
} from './ids';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { SEASONS } from './seasons';
import type {
  BuffDef,
  CropDef,
  ExpansionDef,
  FishDef,
  ItemDef,
  JunkDef,
  RecipeDef,
  SeasonDef,
  UpgradeDef,
} from './types';
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
  /** Every item, dishes included. Typed `Partial` so lookups by an arbitrary id stay checked. */
  items: Readonly<Partial<Record<ItemId, ItemDef>>>;
  recipes: Readonly<Record<RecipeId, RecipeDef>>;
  buffs: Readonly<Record<BuffType, BuffDef>>;
  seasons: Readonly<Record<SeasonId, SeasonDef>>;
  expansions: Readonly<Record<ExpansionId, ExpansionDef>>;
  /** Every upgrade; `Partial` keeps lookups by an arbitrary id checked. */
  upgrades: Readonly<Partial<Record<UpgradeId, UpgradeDef>>>;
}

export const GAME_DATA: GameData = Object.freeze({
  startGrid: START_GRID,
  crops: CROPS,
  fish: FISH,
  junk: JUNK,
  items: ITEMS,
  recipes: RECIPES,
  buffs: BUFFS,
  seasons: SEASONS,
  expansions: EXPANSIONS,
  upgrades: UPGRADES,
});
