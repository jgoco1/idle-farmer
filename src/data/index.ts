import { START_GRID } from './balance';
import { BUFFS } from './buffs';
import { BUNDLES, GOAL_TEMPLATES, MILESTONES } from './quests';
import { SKILL_PERKS } from './skills';
import { CROPS } from './crops';
import { DECOR, DECOR_SETS } from './decor';
import { EXPANSIONS } from './expansions';
import { FISH, JUNK } from './fish';
import type {
  BuffType,
  BundleId,
  CropId,
  DecorId,
  DecorSetId,
  ExpansionId,
  FishId,
  GoalTemplateId,
  ItemId,
  JunkId,
  ParcelId,
  RecipeId,
  SeasonId,
  TownProjectId,
  UpgradeId,
} from './ids';
import { ITEMS } from './items';
import { PARCELS } from './parcels';
import { RECIPES } from './recipes';
import { SEASONS } from './seasons';
import type {
  BuffDef,
  BundleDef,
  CropDef,
  DecorDef,
  DecorSetDef,
  ExpansionDef,
  FishDef,
  ItemDef,
  JunkDef,
  ParcelDef,
  QuestDef,
  RecipeDef,
  SeasonDef,
  SkillPerkDef,
  TownProjectDef,
  UpgradeDef,
} from './types';
import { TOWN_PROJECTS } from './townProjects';
import { UPGRADES } from './upgrades';
import { WORLD_LAYOUT, type WorldLayout } from './world';

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
  /** Land parcels of the v2 world (v2 phase 01). */
  parcels: Readonly<Record<ParcelId, ParcelDef>>;
  /** The world layout: regions, lanes, sea, town sites, tree spots (v2 phase 01). */
  world: WorldLayout;
  /** The decoration sets and pieces (v2 phase 02). */
  decorSets: Readonly<Record<DecorSetId, DecorSetDef>>;
  decor: Readonly<Record<DecorId, DecorDef>>;
  /** The six town projects of the Community Board (v2 phase 02). */
  townProjects: Readonly<Record<TownProjectId, TownProjectDef>>;
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
  parcels: PARCELS,
  world: WORLD_LAYOUT,
  decorSets: DECOR_SETS,
  decor: DECOR,
  townProjects: TOWN_PROJECTS,
});
