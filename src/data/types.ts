// Content definitions shared by the data tables (docs/DATA_SCHEMAS.md §3–4). Only the shapes the
// current phases use live here; later phases add theirs (FishDef, RecipeDef, …).

import type {
  BundleId,
  CropId,
  ExpansionId,
  FishId,
  FishLocationId,
  ItemId,
  JunkId,
  MilestoneId,
  Rarity,
  SeasonId,
  SkillId,
  UpgradeId,
} from './ids';

/** `hearty`: a dish finished cooking in winter (phase 06). Stacks only merge when `hearty` matches. */
export interface ItemStack {
  item: ItemId;
  qty: number;
  hearty?: true;
}

/** Something that must be true before content is visible/usable. All entries in an array must hold. */
export type UnlockCondition =
  | { kind: 'farmLevel'; level: number }
  | { kind: 'skillLevel'; skill: SkillId; level: number }
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId; level: number }
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'bundle'; id: BundleId }
  | { kind: 'caught'; fish: FishId }
  | { kind: 'lifetimeGold'; amount: number };

export type ItemCategory = 'seed' | 'crop' | 'fish' | 'junk' | 'dish';

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  basePrice: number; // market base price; seeds use their shop price here but are not sellable
  sellable: boolean; // seeds: false
  edible: boolean; // dishes only
  sprite: string; // sprite id, e.g. 'item_turnip'
}

export interface CropDef {
  id: CropId;
  name: string;
  seasons: readonly SeasonId[]; // multi-season crops survive the change between listed seasons
  growSec: number; // seed → ready, watered, at 1× growth
  regrowSec: number | null; // null = single harvest; else time from harvest back to ready
  stages: 5; // seed, sprout, mid, near-ready, ready (fixed in v1)
  regrowToStage: 2 | null; // regrowing crops drop back to stage 2 (mid) after harvest
  yield: { min: number; max: number }; // inclusive, rolled with the seeded RNG
  seedPrice: number; // shop price of one seed
  basePrice: number; // market base price of one harvested crop
  unlock: readonly UnlockCondition[]; // for the seed in the shop
  xp: number; // Farming XP per harvested unit (phase 07)
  description: string; // one cozy line for tooltips
}

/** Upgrade cost curve: cost to go from level n to n+1 (or buy the (n+1)th placeable) = roundNice(base * ratio^n). */
export interface CostCurve {
  base: number;
  ratio: number;
}

export type UpgradeCategory = 'farm' | 'tools' | 'storage' | 'fishing' | 'kitchen';

/** What the farmhand-family upgrades switch on (BALANCE.md §4). Cumulative across levels. */
export type AutomationFlag =
  'replantHarvested' | 'plantEmpty' | 'autoTill' | 'autoShip' | 'keepReserve' | 'autoCollect';

/** Each upgrade uses the fields relevant to it; unused fields are omitted. */
export interface UpgradeEffect {
  inventorySlots?: number; // backpack (phase 03)
  radius?: number; // sprinkler tech / scarecrow area (Chebyshev radius; 'plus' = orthogonal only)
  shape?: 'plus' | 'square';
  growthBonus?: number; // scarecrow: added to the growth modifier of the plots in its area
  intervalSec?: number; // farmhand: simulated seconds between visits
  capacity?: number; // farmhand (and planter) plots per visit
  toolArea?: 1 | 3 | 9 | 25; // watering can / hoe tiles per click
  stackSize?: number; // barn storage
  greenhousePlots?: number; // greenhouse
  flags?: readonly AutomationFlag[]; // seed planter, auto-seller, trap collector
  reelZoneMult?: number; // fishing rod: × the reel minigame's sweet zone
  luck?: number; // fishing rod: additive fishing luck
  // phase 06+: cookSpeed, …
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** One cozy line for the Upgrades panel. */
  description: string;
  category: UpgradeCategory;
  kind: 'leveled' | 'placeable';
  /** leveled: highest level. placeable: most units the player may own. */
  max: number;
  cost: CostCurve;
  /** Human-readable name/effect per level, index = level (index 0 = not owned / base). */
  effectText: readonly string[];
  /** Numeric effect table read by systems, index = level. */
  effect: readonly UpgradeEffect[];
  requires: readonly UnlockCondition[];
  /** Extra conditions for buying one particular level (key = the level being bought, 1-based). */
  levelRequires?: Readonly<Record<number, readonly UnlockCondition[]>>;
  /** Placeables only: where they go (traps are set out at the water automatically). */
  placeOn?: 'plot' | 'water';
}

export interface ExpansionDef {
  id: ExpansionId;
  name: string;
  kind: 'farm' | 'fishing';
  price: number;
  /** farm_n requires farm_(n-1); some need a farm level. */
  requires: readonly UnlockCondition[];
  /** farm: the plot grid size after buying. */
  grid?: { cols: number; rows: number };
  /** fishing: the location it opens (phase 05). */
  location?: FishLocationId;
  /** Short note of what changes in the scene. */
  sceneChange: string;
  /** One cozy line for the Upgrades panel. */
  description: string;
}

/** A time-of-day window on the local clock, hours 0..24; `start > end` wraps past midnight (16–10). */
export interface HourWindow {
  start: number;
  end: number;
}

export interface FishDef {
  id: FishId;
  name: string;
  location: FishLocationId;
  seasons: readonly SeasonId[];
  hours: HourWindow; // when it bites; traps ignore it
  rarity: Rarity;
  difficulty: number; // 0..100, drives the reel minigame
  sizeCm: { min: number; max: number };
  basePrice: number;
  trappable: boolean; // true only for common and uncommon fish
  description: string;
}

export interface JunkDef {
  id: JunkId;
  name: string;
  basePrice: number;
  locations: readonly FishLocationId[];
  description: string;
}
