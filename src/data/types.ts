// Content definitions shared by the data tables (docs/DATA_SCHEMAS.md §3–4). Only the shapes the
// current phases use live here; later phases add theirs (FishDef, RecipeDef, …).

import type {
  AnimalId,
  CatId,
  AnimalProductId,
  BuffType,
  BuildingId,
  BundleId,
  FeedId,
  GoalTemplateId,
  CropId,
  DecorId,
  FruitId,
  DecorSetId,
  ExpansionId,
  FishId,
  FishLocationId,
  ItemId,
  JunkId,
  MilestoneId,
  ParcelId,
  Rarity,
  RecipeId,
  RecipeTier,
  SeasonId,
  SkillId,
  TownProjectId,
  TreeId,
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
  | { kind: 'lifetimeGold'; amount: number }
  | { kind: 'fishCaught'; count: number } // fish landed in total (phase 07)
  | { kind: 'knownRecipes'; count: number; minTier: RecipeTier } // recipes known of at least that tier (phase 07)
  | { kind: 'parcel'; id: ParcelId } // a land parcel is owned (v2 phase 01)
  | { kind: 'charm'; amount: number } // derived charm is at least this (v2 phase 02)
  | { kind: 'townProject'; id: TownProjectId; stage?: number } // stages done ≥ stage; omitted = complete (v2 phase 02)
  | { kind: 'building'; id: BuildingId; level: number }; // a ranch building of at least this level (v2 phase 04)

/** A rectangle of world tiles: top-left (col, row) and size (DATA_SCHEMAS.md §9.3). */
export interface TileRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export type ItemCategory =
  | 'seed'
  | 'crop'
  | 'fish'
  | 'junk'
  | 'dish'
  | 'fruit'
  | 'sapling'
  | 'animal' // egg, large egg, milk (sellable)
  | 'feed'; // hay, corn feed (not sellable, like seeds)

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
  /** The plural for goal text when "name + s" is wrong ("Potatoes", "Garlic"). */
  plural?: string;
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

export type UpgradeCategory = 'farm' | 'tools' | 'storage' | 'fishing' | 'kitchen' | 'ranch';

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
  capacity?: number; // farmhand (and planter) plots per visit; kitchen: cook-queue slots
  toolArea?: 1 | 3 | 9 | 25; // watering can / hoe tiles per click
  stackSize?: number; // barn storage
  greenhousePlots?: number; // greenhouse
  flags?: readonly AutomationFlag[]; // seed planter, auto-seller, trap collector
  reelZoneMult?: number; // fishing rod: × the reel minigame's sweet zone
  luck?: number; // fishing rod: additive fishing luck
  cookSpeed?: number; // kitchen: added to cookSpeedModifier
  seedTarget?: number; // seed order: seeds per crop the bag is topped up to at each pickup
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

/** A land parcel of the v2 world (DATA_SCHEMAS.md §9.4, BALANCE.md §13.1). */
export interface ParcelDef {
  id: ParcelId;
  name: string;
  /** One cozy line for Upgrades › Land. */
  description: string;
  /** World tiles. */
  rect: TileRect;
  price: number;
  requires: readonly UnlockCondition[];
  /** What it is for, shown on the sign and the Land card. */
  opens: string;
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

// ---- cooking and buffs (phase 06)

export type RecipeDiscovery =
  | { kind: 'starter' }
  | { kind: 'card'; price: number; unlock: readonly UnlockCondition[] } // bought in the Shop
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'experiment' }; // only by experimenting

export interface RecipeDef {
  id: RecipeId;
  name: string;
  ingredients: readonly ItemStack[]; // crops, fish and seaweed only (no dish in a dish)
  cookSec: number; // seconds of simulated time at 1× cook speed
  tier: RecipeTier; // declared; tests check it against recipeTier()
  buff: BuffType;
  basePrice: number; // round(ingredient value × TIER_SELL_MULT[tier])
  discovery: RecipeDiscovery;
  description: string; // one cozy line
}

export interface BuffDef {
  type: BuffType;
  name: string;
  /** "{pct}" is replaced by the magnitude, e.g. "Crops grow {pct} faster." */
  description: string;
  magnitudeScale: number; // multiplies the tier magnitude
  /** The modifier it drives (a key of `Modifiers`). */
  seam:
    | 'growthModifier'
    | 'sellPriceModifier'
    | 'fishingLuckModifier'
    | 'fishingSpeedModifier'
    | 'cookSpeedModifier'
    | 'automationSpeedModifier'
    | 'xpModifier';
  /** A second modifier it also drives (v2-05: Busy Bees also speeds the animals' production cycles). */
  alsoSeam?: 'animalSpeedModifier';
  /** Luck is additive (+0.10); every other buff is a percentage. */
  additive: boolean;
  icon: string; // sprite id
}

export interface SeasonDef {
  id: SeasonId;
  name: string;
  effects: {
    heartyDishes?: boolean; // dishes finishing in this season are hearty
    cookingXpBonus?: number;
    dishSellBonus?: number;
  };
}

// ---- progression (phase 07)

/**
 * What a level grants. Every entry is the amount *that level adds*; the running total is what
 * `perkTotals` (src/systems/skills.ts) returns. BALANCE.md's "(total)" rows are written as their
 * increments here and shown as totals in `text`.
 */
export type PerkEffect =
  | { kind: 'doubleHarvestChance'; chance: number }
  | { kind: 'growth'; bonus: number }
  | { kind: 'sellPrice'; bonus: number; category: 'crop' | 'fish' | 'dish' }
  | { kind: 'reelZone'; bonus: number }
  | { kind: 'fishingLuck'; bonus: number }
  | { kind: 'trapCapacity'; bonus: number }
  | { kind: 'cookSpeed'; bonus: number }
  | { kind: 'buffDuration'; bonus: number }
  | { kind: 'buffSlot'; count: number }
  | { kind: 'ingredientSaveChance'; chance: number };

export interface SkillPerkDef {
  skill: SkillId;
  level: number; // 2..10
  text: string; // shown to the player
  effect: PerkEffect;
}

/** Objectives are counted from events, never by scanning state (except `reachFarmLevel`). */
export type QuestObjective =
  | { kind: 'plant'; crop?: CropId; count: number }
  | { kind: 'harvest'; crop?: CropId; count: number }
  | { kind: 'sell'; count: number }
  | { kind: 'earnGold'; amount: number; withinOneDay?: boolean }
  | { kind: 'ship'; count: number }
  | { kind: 'catch'; location?: FishLocationId; rarity?: Rarity; count: number }
  | { kind: 'cook'; tier?: RecipeTier; distinct?: boolean; count: number }
  | { kind: 'eat'; count: number }
  | { kind: 'place'; what: 'sprinkler'; count: number }
  | { kind: 'buyUpgrade'; id: UpgradeId; level?: number }
  | { kind: 'buyExpansion'; id: ExpansionId }
  | { kind: 'reachFarmLevel'; level: number }
  | { kind: 'completeBundle'; count: number }
  // v2 phase 02 (BALANCE.md §13.9)
  | { kind: 'ownParcel'; count: number } // checks state (like reachFarmLevel)
  | { kind: 'placeDecor'; count: number } // counts 'decorPlaced'
  | { kind: 'reachCharm'; amount: number } // checks derived charm
  | { kind: 'gainCharm'; amount: number } // sums positive 'charmChanged' deltas
  | { kind: 'projectStage'; count: number } // counts 'projectStageDone'
  // v2 phase 03
  | { kind: 'pickFruit'; fruit?: FruitId; count: number } // counts 'fruitPicked'
  // v2 phase 04
  | { kind: 'collectProduct'; product?: AnimalProductId; count: number }; // counts 'collected'

export type QuestReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'items'; items: readonly ItemStack[] }
  | { kind: 'recipe'; id: RecipeId }
  | { kind: 'xp'; skill: SkillId; amount: number }
  | { kind: 'decor'; id: DecorId; qty: number }; // goes to the decoration stock (v2 phase 02)

/** A milestone or a goal-board template (a template's objective is a pattern the generator fills in). */
export interface QuestDef {
  id: MilestoneId | GoalTemplateId;
  kind: 'milestone' | 'goal';
  title: string; // goal templates may contain {n}, {crop}, {location}, {a_rarity}, {tier}
  flavor: string; // one warm line
  objective: QuestObjective;
  rewards: readonly QuestReward[];
  requires: readonly UnlockCondition[]; // goal templates are only drawn when these hold
}

export type BundleReward =
  | { kind: 'unlockGreenhouse' }
  | { kind: 'buffSlot' }
  | { kind: 'inventorySlots'; count: number }
  | { kind: 'trapPerLocation'; count: number }
  | { kind: 'fishingLuck'; bonus: number }
  | { kind: 'goldenScarecrow' }
  | { kind: 'treeSpots'; count: number } // the Orchard Basket (v2 phase 03)
  | { kind: 'troughBonus'; bonus: number }; // the Barnyard: every trough holds this much more (v2 phase 04)

export interface BundleDef {
  id: BundleId;
  name: string;
  flavor: string;
  slots: readonly ItemStack[];
  reward: BundleReward;
  /** The reward in words, for the Community Board. */
  rewardText: string;
}

// ---- decorations, charm and town projects (v2 phase 02, DATA_SCHEMAS.md §9.4)

export interface DecorSetDef {
  id: DecorSetId;
  name: string;
  description: string;
  /** Empty for the Cottage set; the others open with a town project. */
  unlock: readonly UnlockCondition[];
}

export type DecorKind =
  | 'place' // stands on the ground
  | 'paint'
  | 'roof'
  | 'loft'; // restyle the farmhouse; never placed, never use a slot

/** A farm cat (cosmetic: it only changes who naps by the farmhouse door). */
export interface CatDef {
  id: CatId;
  name: string;
  description: string;
  /** Gold to adopt; 0 for the tabby everyone starts with. */
  price: number;
  /** The sleeping sprite, two breathing frames. */
  sprite: string;
}

export interface DecorDef {
  id: DecorId;
  set: DecorSetId;
  name: string;
  description: string;
  kind: DecorKind;
  /** Footprint in tiles; farmhouse pieces have none ({ cols: 0, rows: 0 }). */
  size: { cols: number; rows: number };
  price: number;
  charm: number;
  /** Copies that count toward charm (paths and fences 20); farmhouse pieces 1. */
  counted: number;
  /** The set's own unlock also applies. */
  unlock: readonly UnlockCondition[];
  /** Joins with same-id neighbours (a 4-neighbour mask, ART_STYLE.md §6). */
  autotile?: 'path' | 'fence';
  /** Has a lit frame and a night halo. */
  glows?: true;
  /** May be mirrored when placed. */
  flips?: true;
  /** Has per-season sprites (`decor_<id>_<season>`). */
  seasonal?: true;
  /** Base sprite id, 'decor_garden_lamp'. */
  sprite: string;
}

export interface TownProjectStage {
  /** Before TOWN_PROJECT_SCALE. */
  gold: number;
  items: readonly ItemStack[];
  /** A note for the renderer: what the town looks like after this stage. */
  sceneChange: string;
}

export type TownProjectReward =
  | { kind: 'decorSet'; set: DecorSetId }
  | { kind: 'decorSlots'; count: number }
  | { kind: 'musicTrack'; id: 'town_square' }
  | { kind: 'goalSlot'; count: number }
  | { kind: 'cosmetic'; what: 'bakerySmoke' | 'bandSaturday' | 'lighthouseBeam' | 'festivalLights' };

export interface TownProjectDef {
  id: TownProjectId;
  name: string;
  flavor: string;
  /** Where the building stands (the bridge's is `WORLD_LAYOUT.bridge`). */
  site: TileRect;
  /** 3, or 4 for the hall. */
  stages: readonly TownProjectStage[];
  /** Given when the last stage completes. */
  rewards: readonly TownProjectReward[];
  rewardText: string;
  requires: readonly UnlockCondition[];
}

/** A fruit tree (docs/BALANCE.md §13.5, DATA_SCHEMAS.md §9.4). Its fruit and sapling items are generated in items.ts. */
export interface TreeDef {
  id: TreeId;
  fruit: FruitId;
  name: string; // 'Cherry'
  /** The plural for text when "name + s" is wrong. */
  plural?: string;
  description: string;
  seasons: readonly SeasonId[]; // when it bears
  saplingPrice: number;
  matureDays: number; // real calendar days from planting
  fruitPerDay: number; // added at each bearing day's 06:00 refresh
  fruitCap: number; // = FRUIT_CAP_DAYS × fruitPerDay (a test checks it)
  fruitPrice: number; // market base price of one fruit
  xp: number; // Farming XP per fruit picked
  shape: 'round' | 'tall' | 'spread'; // canopy family for sprites (ART_STYLE.md §6.3)
}

// ---- animals and buildings (v2 phase 04, docs/BALANCE.md §13.6–13.7, DATA_SCHEMAS.md §9.4)

export interface AnimalDef {
  id: AnimalId;
  name: string; // 'Hen'
  plural: string; // 'Hens'
  building: BuildingId; // 'coop' | 'barn'
  price: number;
  feed: FeedId; // one portion per cycle
  intervalSec: number; // simulated seconds per production cycle
  product: AnimalProductId;
  /** Hens sometimes lay a large egg instead (rolled with the seeded RNG). */
  largeProduct?: { id: AnimalProductId; chance: number };
  /** Farming XP per product collected by hand (a quarter when the Collecting Basket collects). */
  xp: Readonly<Partial<Record<AnimalProductId, number>>>;
  /** Default names, used in order (never random). */
  names: readonly string[];
}

export interface BuildingLevelDef {
  price: number;
  capacity: number; // animals housed (silo: 0)
  trough: number; // feed portions (silo: 0)
  store: number; // products held (silo: 0)
  requires: readonly UnlockCondition[];
  flags?: readonly ('autoFeed' | 'autoMill')[]; // silo levels 1 and 2
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  footprint: { cols: number; rows: number };
  houses: AnimalId | null; // silo: null
  levels: readonly BuildingLevelDef[]; // index 0 = level 1
  placeIn: ParcelId;
  /** Sprite id stem: `obj_coop` → `obj_coop_1` … `obj_coop_3`. */
  sprite: string;
}

export interface FeedDef {
  id: FeedId;
  name: string;
  from: CropId; // hay from wheat, corn feed from corn
  perUnit: number; // portions per unit of crop
  buyPrice: number; // at the Ranch
}
