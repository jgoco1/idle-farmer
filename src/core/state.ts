// GameState (docs/DATA_SCHEMAS.md §6). Phase 01 implements only the @01 fields; each later phase
// adds its fields, bumps SAVE_VERSION and writes a migration in save.ts.
//
// State is plain JSON: no classes, Maps, Sets, Dates or functions. The UI and renderer only read it;
// every change goes through dispatch() (core/actions.ts) or the simulation step (core/sim.ts).

import { createCalendarState, type CalendarState, type LocalClock } from './time';
import { seedFrom } from './rng';
import {
  START_GOLD,
  START_GRID,
  START_INVENTORY_SLOTS,
  START_SEEDS,
  START_STACK_SIZE,
  START_TILLED_COLS,
} from '../data/balance';
import { BIN_PICKUP_MS } from '../data/balance';
import { GAME_DATA } from '../data';
import type { CropId, ExpansionId, FishId, FishLocationId, ItemId, JunkId, UpgradeId } from '../data/ids';
import type { ItemStack } from '../data/types';
import { createRng } from './rng';
import { openMarketDay } from '../systems/market';

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
export type PlacedKind = 'sprinkler' | 'scarecrow';

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
  };
  // A new farm opens with today's specials and the first sparkline point (every save starts in spring).
  openMarketDay(state, GAME_DATA, createRng(state), 'spring');
  return state;
}

export function createStartingStats(): Stats {
  return { lifetimeGold: 0, goldToday: 0, cropsHarvested: 0, itemsShipped: 0, daysPassed: 0, fishCaught: 0 };
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
