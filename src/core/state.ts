// GameState (docs/DATA_SCHEMAS.md §6). Phase 01 implements only the @01 fields; each later phase
// adds its fields, bumps SAVE_VERSION and writes a migration in save.ts.
//
// State is plain JSON: no classes, Maps, Sets, Dates or functions. The UI and renderer only read it;
// every change goes through dispatch() (core/actions.ts) or the simulation step (core/sim.ts).

import { createCalendarState, type CalendarState, type LocalClock } from './time';
import { seedFrom } from './rng';
import {
  BASE_BUFF_SLOTS,
  START_GOLD,
  START_GRID,
  START_INVENTORY_SLOTS,
  START_SEEDS,
  START_STACK_SIZE,
  START_TILLED_COLS,
} from '../data/balance';
import { BIN_PICKUP_MS } from '../data/balance';
import { GAME_DATA } from '../data';
import { RECIPE_IDS } from '../data/ids';
import { SKILL_IDS } from '../data/skills';
import type {
  AnimalId,
  BuffType,
  BuildingId,
  BundleId,
  CatId,
  CropId,
  DecorId,
  ExpansionId,
  FeedId,
  FishId,
  FishLocationId,
  GoalTemplateId,
  ItemId,
  JunkId,
  MilestoneId,
  ParcelId,
  RecipeId,
  RecipeTier,
  SkillId,
  TownProjectId,
  TreeId,
  UpgradeId,
} from '../data/ids';
import type { ItemStack, QuestObjective, QuestReward } from '../data/types';
import { createRng } from './rng';
import { openMarketDay } from '../systems/market';
import { refillGoals } from '../systems/progression';

export type PlotState = 'untilled' | 'tilled' | 'planted' | 'dead';

/** One farm plot (DATA_SCHEMAS.md §6). "Ready" and the visible stage are derived, never stored. */
export interface Plot {
  state: PlotState;
  crop: CropId | null; // set while planted
  growthMs: number; // effective growth accumulated in the current cycle
  harvests: number; // completed harvests of this planting (regrowers)
  waterMsLeft: number; // hand watering left (2 h per watering)
}

/** Objects the player places on the plot grid (@04). `at` is a plot (col, row) inside the grid. */
export type PlacedKind = 'sprinkler' | 'scarecrow' | 'golden_scarecrow';

export interface PlacedObject {
  id: number; // unique, monotonically increasing
  kind: PlacedKind;
  at: { col: number; row: number };
}

export interface Inventory {
  slots: (ItemStack | null)[]; // length = slot capacity
  stackSize: number; // 99 base, barn storage raises it (@04)
}

/** Market state of one item (DATA_SCHEMAS.md §6). Items without an entry are at demand 1.0. */
export interface MarketItemState {
  demand: number; // DEMAND_FLOOR .. DEMAND_CEIL
  lastSoldSimMs: number; // clock.simMs of the last sale, -1 if never sold
  history: number[]; // effective price multiplier at each of the last 7 daily (06:00) refreshes
}

export interface MarketSpecial {
  item: ItemId;
  bonus: number; // 0.2 .. 0.5
}

export interface MarketState {
  items: Partial<Record<ItemId, MarketItemState>>;
  specials: MarketSpecial[]; // today's specials, re-rolled at each daily refresh
}

export interface ShippingBin {
  items: ItemStack[];
  msToPickup: number; // simulated ms until the next hourly pickup
}

/** Lifetime and daily statistics (@03; @05 adds fish; later phases add dishes, …). */
export interface Stats {
  lifetimeGold: number; // all gold ever earned (drives the provisional farm level)
  goldToday: number; // gold earned since the last 06:00 refresh
  cropsHarvested: number; // units
  itemsShipped: number; // units sold through the Shipping Bin
  daysPassed: number; // daily refreshes seen
  fishCaught: number; // fish (not junk) landed, by rod or trap
  dishesCooked: number; // @06
  dishesEaten: number; // @06
  bestDishTier: number; // @06: the highest tier cooked so far, 0 = none
  fruitPicked: number; // v2-03: fruit picked from the orchard
  productsCollected: number; // v2-04: eggs and milk taken out of the ranch's stores
}

export interface Settings {
  masterVolume: number; // 0..1 (@01 stub, @08 real)
  relaxedFishing: boolean; // @05: a wider, slower sweet zone and a gentler meter
}

export interface GameState {
  // ---- core (@01)
  clock: { simMs: number; speed: number }; // speed: 1, or 60 with the debug time warp (never saved as ≠1)
  calendar: CalendarState;
  rngState: number; // mulberry32 state; the ONLY source of randomness
  gold: number;
  settings: Settings;
  meta: { createdAt: number; lastSavedAt: number; playTimeMs: number };

  // ---- farming (@02)
  farm: {
    grid: { cols: number; rows: number }; // starts 4 × 2; grows with expansions (@03)
    plots: Plot[]; // row-major, length = cols * rows
    greenhouse: Plot[]; // @04, empty until built
  };
  inventory: Inventory;

  // ---- economy (@03)
  market: MarketState;
  shippingBin: ShippingBin;
  expansions: ExpansionId[]; // bought, in order
  stats: Stats;
  /** Upgrade levels (@03 for the backpack; phase 04 adds the rest). */
  upgrades: Partial<Record<UpgradeId, number>>;

  // ---- automation (@04)
  /** Sprinklers and scarecrows on the plot grid. Positions are (col, row), so expansions need no remap. */
  placed: PlacedObject[];
  /** Auto-Seller toggles per item; a missing entry means on for crops. */
  autoSell: Partial<Record<ItemId, boolean>>;
  /** The farmhand's timer: simulated ms until the next visit (0 while nobody is hired). */
  automation: { farmhandCooldownMs: number };
  /** The crop last planted on each plot, for the seed planter: field plots first, then greenhouse plots. */
  lastPlantedCrop: (CropId | null)[];

  // ---- fishing (@05). Unlocked locations are derived from `expansions` (river, ocean).
  fishing: FishingState;

  // ---- cooking and buffs (@06)
  kitchen: KitchenState;
  buffs: BuffsState;

  // ---- progression (@07)
  progression: ProgressionState;

  // ---- world (v2 phase 01, save 8)
  land: LandState;

  // ---- decorations and the town (v2 phase 02, save 9)
  decor: DecorState;
  town: TownState;

  // ---- the orchard (v2 phase 03, save 10)
  orchard: OrchardState;

  // ---- the ranch (v2 phase 04, save 11)
  ranch: RanchState;

  // ---- the farm cats (save 12): cosmetic only
  cats: CatsState;
}

/** The farm cats: who has been adopted (the starting tabby always), and who naps by the farmhouse door. */
export interface CatsState {
  adopted: CatId[];
  active: CatId;
}

/** A coop, barn or silo in the Old Paddock (DATA_SCHEMAS.md §9.6). Capacity, trough size and store size are derived. */
export interface BuildingState {
  id: number; // unique, monotonically increasing (max + 1)
  kind: BuildingId;
  level: number; // 1 … levels.length
  at: { col: number; row: number }; // world tile of the footprint's top-left, inside the yard
  trough: number; // feed portions (always 0 for the silo)
  store: ItemStack[]; // products waiting to be collected (empty for the silo)
  cycleMs: number; // simulated ms into the current production cycle (0 while no animal lives there)
}

/** A hen or a cow. Its name is state (chosen from a list, renamable), never random. */
export interface AnimalState {
  id: number;
  kind: AnimalId;
  name: string;
  building: number; // BuildingState.id
}

export interface RanchState {
  buildings: BuildingState[];
  animals: AnimalState[];
  /** v2-05 (save 13): portions of each feed waiting in the ranch's feed store, at most FEED_STORE_CAPACITY each. */
  feedStore: Record<FeedId, number>;
}

/** A planted fruit tree (DATA_SCHEMAS.md §9.6). Its age, stage and ripeness are derived (BALANCE.md §13.5). */
export interface TreeState {
  id: number; // unique, monotonically increasing (max + 1)
  tree: TreeId;
  spot: number; // index into WORLD_LAYOUT.treeSpots
  plantedDay: number; // calendar.dayIndex on the day it was planted
  fruit: number; // hanging now, 0 … fruitCap
  lastFruitDay: number; // the last day index whose fruit has been added (starts at plantedDay)
}

export interface OrchardState {
  trees: TreeState[];
}

/** A decoration standing on the land (DATA_SCHEMAS.md §9.6). Its auto-tile mask is derived when drawn, never stored. */
export interface PlacedDecor {
  id: number; // unique, monotonically increasing (max + 1)
  decor: DecorId;
  at: { col: number; row: number }; // world tile of the footprint's top-left
  flipped?: true;
}

/** Decorations: what was bought, what stands on the land, and how the farmhouse looks. Stock = owned − placed. */
export interface DecorState {
  owned: Partial<Record<DecorId, number>>;
  placed: PlacedDecor[];
  /** Applied farmhouse pieces; null / false = the original red walls, tiled roof and no loft. */
  farmhouse: { paint: DecorId | null; roof: DecorId | null; loft: boolean };
}

/** Progress of one town project: stages finished, and what has been given toward the current one. */
export interface TownProjectState {
  stagesDone: number; // 0 … stages.length
  gold: number; // gold donated toward the current stage
  items: ItemStack[]; // items donated toward the current stage
}

export interface TownState {
  projects: Partial<Record<TownProjectId, TownProjectState>>; // no entry = not started
}

/** The v2 world's land (DATA_SCHEMAS.md §9.6). Owned parcels only; the layout is data. */
export interface LandState {
  parcels: ParcelId[]; // bought, in order
}

/** A goal on the board: concrete and counting. Its text is derived from the template and objective. */
export interface ActiveGoal {
  template: GoalTemplateId;
  objective: QuestObjective;
  progress: number;
  rewards: QuestReward[];
  /** `cook_distinct`: the dishes cooked toward it so far. */
  seen?: RecipeId[];
}

/**
 * Skills, milestones, goals and the Community Board (@07). Levels are derived from XP and the
 * farm level from the levels and milestones, so only their inputs are stored (plus `farmLevelFloor`,
 * the level an older save already showed, which the farm level never drops below).
 */
export interface ProgressionState {
  skills: Record<SkillId, { xp: number }>;
  milestones: { done: MilestoneId[] }; // in the order they were completed
  goals: ActiveGoal[]; // GOAL_SLOTS when enough templates apply
  goalsDone: number;
  bundles: Partial<Record<BundleId, ItemStack[]>>; // donated so far, per item
  completedBundles: BundleId[];
  farmLevelFloor: number;
}

export function createStartingProgression(): ProgressionState {
  return {
    skills: Object.fromEntries(SKILL_IDS.map((s) => [s, { xp: 0 }])) as ProgressionState['skills'],
    milestones: { done: [] },
    goals: [],
    goalsDone: 0,
    bundles: {},
    completedBundles: [],
    farmLevelFloor: 1,
  };
}

/** A dish on the stove. `remainingMs` is work at ×1 cook speed; `hearty` is set when it finishes in winter. */
export interface CookJob {
  recipe: RecipeId;
  remainingMs: number;
  /** Set once the dish is done but the bag had no room for it; it waits on the stove. */
  hearty?: true;
  /** The ingredient a Cooking perk saved when this dish was started (one unit was never taken). */
  saved?: ItemId;
}

export interface KitchenState {
  known: RecipeId[]; // recipes the player can cook, in the order learned
  queue: CookJob[]; // all cook at once; at most the kitchen's slots
}

/** A food buff, counting down in simulated time. `magnitude` is already scaled by the type. */
export interface ActiveBuff {
  type: BuffType;
  magnitude: number;
  tier: RecipeTier;
  remainingMs: number;
  source: RecipeId;
}

export interface BuffsState {
  active: ActiveBuff[];
  baseSlots: number; // BASE_BUFF_SLOTS; perks and bundles add on top (@07)
}

/** A fish trap set out at a water zone (@05). `slot` picks its spot in the scene (0 or 1). */
export interface TrapState {
  id: number; // unique, monotonically increasing
  location: FishLocationId;
  slot: number;
  progressMs: number; // toward the next catch roll, in simulated ms at ×1 speed
  contents: ItemStack[]; // at most TRAP_CAPACITY items in total
}

/** The reel minigame's live state (real-time, so plain numbers, not simulated timers). */
export interface ReelState {
  marker: number; // 0..1 position of the player's marker on the bar
  zoneCenter: number; // 0..1
  zoneVel: number; // bar-widths per second, signed
  zoneWidth: number; // fixed for this fish (rod and Relaxed fishing applied at the start)
  zoneSpeed: number;
  retargetMs: number; // until the zone picks a new heading
  drainPerSec: number;
  meter: number; // 0..1; caught at 1, escapes at 0
}

/** An in-progress cast, so saving mid-minigame is safe. */
export interface FishingSession {
  location: FishLocationId;
  phase: 'charging' | 'waiting' | 'bite' | 'reeling';
  power: number; // 0..1 cast power
  fish: FishId | JunkId | null; // decided when the bite happens
  sizeCm: number;
  waitMs: number; // waiting: until the bite; bite: the window left to start reeling
  reel: ReelState | null;
}

export interface CollectionEntry {
  firstCaughtAt: string; // dayKey of the first catch
  bestSizeCm: number;
  count: number;
}

export interface FishingState {
  traps: TrapState[];
  collection: Partial<Record<FishId, CollectionEntry>>;
  session: FishingSession | null;
}

export const DEFAULT_SETTINGS: Settings = { masterVolume: 0.8, relaxedFishing: false };

/** A brand-new save created at real time `now`. `seed` defaults to one derived from `now`. */
export function createInitialState(now: number, lc: LocalClock, seed: number = seedFrom(now)): GameState {
  const state: GameState = {
    clock: { simMs: 0, speed: 1 },
    calendar: createCalendarState(now, lc),
    rngState: seed >>> 0,
    gold: START_GOLD,
    settings: { ...DEFAULT_SETTINGS },
    meta: { createdAt: now, lastSavedAt: now, playTimeMs: 0 },
    farm: createStartingFarm(),
    inventory: createStartingInventory(),
    market: { items: {}, specials: [] },
    shippingBin: { items: [], msToPickup: BIN_PICKUP_MS },
    expansions: [],
    stats: createStartingStats(),
    upgrades: {},
    placed: [],
    autoSell: {},
    automation: { farmhandCooldownMs: 0 },
    lastPlantedCrop: Array.from({ length: START_GRID.cols * START_GRID.rows }, () => null),
    fishing: { traps: [], collection: {}, session: null },
    kitchen: { known: starterRecipes(), queue: [] },
    buffs: { active: [], baseSlots: BASE_BUFF_SLOTS },
    progression: createStartingProgression(),
    land: { parcels: [] },
    decor: createStartingDecor(),
    town: { projects: {} },
    orchard: { trees: [] },
    ranch: { buildings: [], animals: [], feedStore: { hay: 0, corn_feed: 0 } },
    cats: { adopted: ['cat_tabby'], active: 'cat_tabby' },
  };
  // A new farm opens with today's specials and the first sparkline point (every save starts in spring).
  openMarketDay(state, GAME_DATA, createRng(state), 'spring');
  refillGoals(state, GAME_DATA, createRng(state), 'spring');
  return state;
}

export function createStartingDecor(): DecorState {
  return { owned: {}, placed: [], farmhouse: { paint: null, roof: null, loft: false } };
}

export function createStartingStats(): Stats {
  return {
    lifetimeGold: 0,
    goldToday: 0,
    cropsHarvested: 0,
    itemsShipped: 0,
    daysPassed: 0,
    fishCaught: 0,
    dishesCooked: 0,
    dishesEaten: 0,
    bestDishTier: 0,
    fruitPicked: 0,
    productsCollected: 0,
  };
}

/** The recipes a new save already knows, in table order. */
export function starterRecipes(): RecipeId[] {
  return RECIPE_IDS.filter((id) => GAME_DATA.recipes[id].discovery.kind === 'starter');
}

export function emptyPlot(state: PlotState = 'untilled'): Plot {
  return { state, crop: null, growthMs: 0, harvests: 0, waterMsLeft: 0 };
}

/** The 4 × 2 starting grid with its left columns already tilled (BALANCE.md §3). */
export function createStartingFarm(): GameState['farm'] {
  const { cols, rows } = START_GRID;
  const plots: Plot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) plots.push(emptyPlot(c < START_TILLED_COLS ? 'tilled' : 'untilled'));
  }
  return { grid: { cols, rows }, plots, greenhouse: [] };
}

export function createStartingInventory(): Inventory {
  const slots: (ItemStack | null)[] = Array.from({ length: START_INVENTORY_SLOTS }, () => null);
  slots[0] = { item: START_SEEDS.item, qty: START_SEEDS.qty };
  return { slots, stackSize: START_STACK_SIZE };
}

/** Deep copy (state is plain JSON). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
