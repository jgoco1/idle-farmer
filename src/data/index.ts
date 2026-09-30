import { START_GRID } from './balance';
import { BUFFS } from './buffs';
import { BUNDLES, GOAL_TEMPLATES, MILESTONES } from './quests';
import { SKILL_PERKS } from './skills';
import { CROPS } from './crops';
import { EXPANSIONS } from './expansions';
import { FISH, JUNK } from './fish';
import type {
  BuffType,
  BundleId,
  CropId,
  ExpansionId,
  FishId,
  GoalTemplateId,
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
  BundleDef,
  CropDef,
  ExpansionDef,
  FishDef,
  ItemDef,
  JunkDef,
  QuestDef,
  RecipeDef,
  SeasonDef,
  SkillPerkDef,
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
  /** Skill perks, by skill and level (phase 07). */
  perks: readonly SkillPerkDef[];
  /** The story milestones, in chain order (phase 07). */
  milestones: readonly QuestDef[];
  goalTemplates: Readonly<Record<GoalTemplateId, QuestDef>>;
  bundles: Readonly<Record<BundleId, BundleDef>>;
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
  perks: SKILL_PERKS,
  milestones: MILESTONES,
  goalTemplates: GOAL_TEMPLATES,
  bundles: BUNDLES,
});
