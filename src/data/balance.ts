// Formula parameters from docs/BALANCE.md. Gameplay numbers live here, never in systems or UI.

/** BALANCE.md §1: the first 8 real hours away count fully. */
export const OFFLINE_FULL_MS = 8 * 3600_000;
/** BALANCE.md §1: the next 16 hours count at OFFLINE_REDUCED_RATE. */
export const OFFLINE_REDUCED_MS = 16 * 3600_000;
export const OFFLINE_REDUCED_RATE = 0.25;
/** Absences shorter than this are simulated without a summary modal. */
export const OFFLINE_MIN_MS = 60_000;

/** The starting plot grid (DATA_SCHEMAS.md §4.8); expansions grow it from phase 03. */
export const START_GRID = { cols: 4, rows: 2 } as const;

// ---- farming (BALANCE.md §2)

/** One watering lasts 2 hours of simulated time. */
export const WATER_DURATION_MS = 2 * 3600_000;
/** Dry plots grow at half speed; they never stop and never die. */
export const DRY_GROWTH_FACTOR = 0.5;

// ---- starting state (BALANCE.md §3)

export const START_GOLD = 60;
/** How many columns of the starting grid are already tilled (the left 4 plots of 4 × 2). */
export const START_TILLED_COLS = 2;
export const START_SEEDS = { item: 'seed_turnip', qty: 6 } as const;
export const START_INVENTORY_SLOTS = 12;
export const START_STACK_SIZE = 99;

/** Seeds offered by the temporary Seed Crate (TODO(phase03): replaced by the real Shop). */
export const SEED_CRATE_BUY_AMOUNTS: readonly number[] = [1, 5];
