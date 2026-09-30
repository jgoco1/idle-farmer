// Formula parameters from docs/BALANCE.md. Gameplay numbers live here, never in systems or UI.

import type { Rarity, RecipeTier } from './ids';

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

// ---- fishing (BALANCE.md §6)

/** Catch weights by rarity, before luck. */
export const RARITY_WEIGHT: Readonly<Record<Rarity, number>> = {
  common: 60,
  uncommon: 25,
  rare: 8,
  legendary: 2,
};
/** How strongly luck moves each rarity: weight × max(LUCK_WEIGHT_FLOOR, 1 + luck × scale). */
export const LUCK_SCALE: Readonly<Record<Rarity, number>> = {
  common: -0.3,
  uncommon: 0.5,
  rare: 1.5,
  legendary: 2.5,
};
export const LUCK_WEIGHT_FLOOR = 0.3;
/** Weight of each junk item eligible at the location. */
export const JUNK_WEIGHT = { active: 10, trap: 25 } as const;
/** Size in the collection log: min + (max − min) · u^SIZE_EXPONENT, so big ones are rarer. */
export const SIZE_EXPONENT = 1.5;

/** Holding the cast button charges the cast over this long (real ms). */
export const CAST_CHARGE_MS = 1200;
/** A cast at or above this power gives uncommon-and-better fish CAST_POWER_BONUS × their weight. */
export const CAST_POWER_GOOD = 0.8;
export const CAST_POWER_BONUS = 1.15;
/** Bite wait in real ms, divided by `fishingSpeedModifier`. */
export const BITE_WAIT_MIN_MS = 3000;
export const BITE_WAIT_MAX_MS = 10000;
/** After the "!" the player has this long to start reeling before the fish loses interest. */
export const BITE_WINDOW_MS = 4000;

/** The reel minigame (positions are fractions of the bar; times in real seconds). */
export const REEL = {
  zoneWidthBase: 0.35,
  zoneWidthPerDifficulty: 0.2, // × difficulty / 100 is subtracted
  zoneSpeedBase: 0.15,
  zoneSpeedPerDifficulty: 0.5, // × difficulty / 100 is added (bar-widths per second)
  relaxedWidthMult: 1.5,
  relaxedSpeedMult: 0.6,
  fillPerSec: 0.35,
  drainPerSec: 0.15,
  relaxedDrainPerSec: 0.075,
  meterStart: 0.3,
  /** The marker rises this fast while the button is held and falls this fast when it is not. */
  markerUpPerSec: 1.0,
  markerDownPerSec: 0.9,
  /** The zone picks a new heading every `retargetMinMs` to `retargetMaxMs`, at 50–100% of its speed. */
  retargetMinMs: 800,
  retargetMaxMs: 2000,
  /** Longest slice the physics integrates in one go, so a slow frame cannot skip past the zone. */
  maxSliceMs: 40,
} as const;

/** Fish traps: one roll per interval of simulated time, a small hold, two per unlocked water. */
export const TRAP_INTERVAL_SEC = 180;
export const TRAP_CAPACITY = 5;
export const TRAPS_PER_LOCATION = 2;

// ---- cooking and buffs (BALANCE.md §7)

/** Recipe tier: `score = units + value / TIER_VALUE_DIV + cookSec / TIER_COOK_DIV`, tier by these thresholds. */
export const TIER_VALUE_DIV = 50;
export const TIER_COOK_DIV = 30;
export const TIER_THRESHOLDS: readonly [number, number, number] = [8, 15, 28];
/** A dish sells for the ingredients' value × this. */
export const TIER_SELL_MULT: Readonly<Record<RecipeTier, number>> = { 1: 1.25, 2: 1.4, 3: 1.6, 4: 2 };

/** Buff strength `0.10 × tier × magnitudeScale`; duration `6 min × 2^(tier − 1)` of simulated time. */
export const BUFF_MAGNITUDE_PER_TIER = 0.1;
export const BUFF_BASE_DURATION_MS = 6 * 60_000;
/** A hearty (winter-cooked) dish's buff lasts this much longer. */
export const HEARTY_DURATION_BONUS = 0.5;
/** Buff slots at the start; perks and bundles add up to MAX_BUFF_SLOTS (phase 07). */
export const BASE_BUFF_SLOTS = 3;
export const MAX_BUFF_SLOTS = 5;

/** Experiment mode: how many distinct ingredients may be tried at once. */
export const EXPERIMENT_MIN_ITEMS = 2;
export const EXPERIMENT_MAX_ITEMS = 4;
