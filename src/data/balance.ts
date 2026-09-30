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

// ---- economy and market (BALANCE.md §3)

/** Market panel sales are instant at 90% of the price; the Shipping Bin pays 100% at pickup. */
export const MARKET_CHANNEL = 0.9;
export const BIN_CHANNEL = 1.0;
/** The Shipping Bin is collected every 60 minutes of simulated time. */
export const BIN_PICKUP_MS = 60 * 60_000;

/** Demand multiplier bounds. */
export const DEMAND_FLOOR = 0.5;
export const DEMAND_CEIL = 1.3;
/**
 * Market depth: units that push demand from 1.0 to the floor,
 * `clamp(round(DEPTH_SCALE * sqrt(DEPTH_REF_PRICE / basePrice)), DEPTH_MIN, DEPTH_MAX)`.
 */
export const DEPTH_SCALE = 150;
export const DEPTH_REF_PRICE = 20;
export const DEPTH_MIN = 20;
export const DEPTH_MAX = 150;
/** Demand recovers toward its rest target with this time constant (simulated minutes). */
export const DEMAND_TAU_MIN = 10;
/** Unsold for this many hours, the rest target starts to climb above 1.0 … */
export const REST_START_HOURS = 1;
/** … by this much per hour unsold, up to DEMAND_CEIL (reached after 3 h). */
export const REST_PER_HOUR = 0.1;
/** Sparkline length: one point per daily refresh. */
export const MARKET_HISTORY_DAYS = 7;

/** Today's specials: 1 + rng.int(0, SPECIALS_EXTRA_MAX) items, each +20% to +50% in 5% steps. */
export const SPECIALS_EXTRA_MAX = 2;
export const SPECIAL_BONUS_MIN = 0.2;
export const SPECIAL_BONUS_STEP = 0.05;
export const SPECIAL_BONUS_STEPS = 6;

/** BALANCE.md §9 provisional farm level: 1 + floor(log2(1 + lifetimeGold / FARM_LEVEL_GOLD_UNIT)). */
export const FARM_LEVEL_GOLD_UNIT = 300;

/** Quantity buttons in the Shop (a "Max" button buys as many as gold and bag space allow). */
export const SHOP_BUY_AMOUNTS: readonly number[] = [1, 5, 10];
/** Quantity buttons in the Market panel (plus "All"). */
export const MARKET_SELL_AMOUNTS: readonly number[] = [1, 10];

/** Expansion price curve for the farm steps (BALANCE.md §5): roundNice(base * ratio^n). */
export const FARM_EXPANSION_COST = { base: 400, ratio: 3.7 } as const;

/**
 * roundNice (BALANCE.md intro): integers below 100 round normally; from 100 up, round to 2
 * significant figures.
 */
export function roundNice(x: number): number {
  const r = Math.round(x);
  if (r < 100) return r;
  const d = String(Math.floor(r)).length;
  const unit = 10 ** (d - 2);
  return Math.floor(x / unit + 0.5) * unit;
}

// ---- automation (BALANCE.md §4)

/** Plot indexes at or above this address greenhouse plots (index - GREENHOUSE_BASE) instead of field plots. */
export const GREENHOUSE_BASE = 1000;
/** Auto-Seller level 2 keeps up to this many of each item in the bag for cooking and ships the rest. */
export const AUTO_SELLER_RESERVE = 10;
