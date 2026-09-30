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
import type { CropId } from '../data/ids';
import type { ItemStack } from '../data/types';

export type PlotState = 'untilled' | 'tilled' | 'planted' | 'dead';

/** One farm plot (DATA_SCHEMAS.md §6). "Ready" and the visible stage are derived, never stored. */
export interface Plot {
  state: PlotState;
  crop: CropId | null; // set while planted
  growthMs: number; // effective growth accumulated in the current cycle
  harvests: number; // completed harvests of this planting (regrowers)
  waterMsLeft: number; // hand watering left (2 h per watering)
}

export interface Inventory {
  slots: (ItemStack | null)[]; // length = slot capacity
  stackSize: number; // 99 base, barn storage raises it (@04)
}

export interface Settings {
  masterVolume: number; // 0..1 (@01 stub, @08 real)
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
}

export const DEFAULT_SETTINGS: Settings = { masterVolume: 0.8 };

/** A brand-new save created at real time `now`. `seed` defaults to one derived from `now`. */
export function createInitialState(now: number, lc: LocalClock, seed: number = seedFrom(now)): GameState {
  return {
    clock: { simMs: 0, speed: 1 },
    calendar: createCalendarState(now, lc),
    rngState: seed >>> 0,
    gold: START_GOLD,
    settings: { ...DEFAULT_SETTINGS },
    meta: { createdAt: now, lastSavedAt: now, playTimeMs: 0 },
    farm: createStartingFarm(),
    inventory: createStartingInventory(),
  };
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
