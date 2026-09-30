// The market (GDD §6.2, BALANCE.md §3): prices, demand, today's specials and the sparkline history.
//
// Price of one unit = basePrice × demand × (1 + special) × (1 + dish bonus) × sellPriceModifier ×
// channel, floored, at least 1. Selling lowers demand by 0.5 / depth per unit (priced one unit at a
// time, so a preview is the exact total). Demand relaxes toward a rest target with time constant
// DEMAND_TAU_MIN; the target is 1.0 until an item has gone unsold for REST_START_HOURS, then climbs
// to DEMAND_CEIL. The relaxation is solved in closed form (piecewise, since the target is piecewise
// linear in time), so one large step equals many small ones.

import type { GameState, MarketItemState } from '../core/state';
import type { Rng } from '../core/rng';
import type { GameData } from '../data';
import {
  DEMAND_CEIL,
  DEMAND_FLOOR,
  DEMAND_TAU_MIN,
  DEPTH_MAX,
  DEPTH_MIN,
  DEPTH_REF_PRICE,
  DEPTH_SCALE,
  MARKET_CHANNEL,
  MARKET_HISTORY_DAYS,
  REST_PER_HOUR,
  REST_START_HOURS,
  SPECIAL_BONUS_MIN,
  SPECIAL_BONUS_STEP,
  SPECIAL_BONUS_STEPS,
  SPECIALS_EXTRA_MAX,
} from '../data/balance';
import { CROP_IDS, type ItemId, type SeasonId } from '../data/ids';
import type { ItemDef } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { earn } from './economy';
import { countItem, removeItem } from './inventory';
import type { Modifiers } from './modifiers';
import { isUnlocked } from './unlocks';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

// ---- prices

/** Units that push demand from 1.0 to the floor: deep for cheap bulk crops, shallow for pricey ones. */
export function marketDepth(basePrice: number): number {
  const d = Math.round(DEPTH_SCALE * Math.sqrt(DEPTH_REF_PRICE / basePrice));
  return Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, d));
}

/** Demand lost per unit sold. */
export function demandStep(basePrice: number): number {
  return (1 - DEMAND_FLOOR) / marketDepth(basePrice);
}

export function demandOf(state: GameState, item: ItemId): number {
  return state.market.items[item]?.demand ?? 1;
}

export function specialBonus(state: GameState, item: ItemId): number {
  return state.market.specials.find((s) => s.item === item)?.bonus ?? 0;
}

/** Everything except demand and channel that scales an item's price. */
function priceFactor(state: GameState, def: ItemDef, mods: Modifiers): number {
  const dish = def.category === 'dish' ? mods.dishSellBonus : 0;
  return (1 + specialBonus(state, def.id)) * (1 + dish) * mods.sellPriceModifier;
}

/** Price of one unit at `demand` (BALANCE.md §3). */
export function unitPriceAt(def: ItemDef, demand: number, factor: number, channel: number): number {
  return Math.max(1, Math.floor(def.basePrice * demand * factor * channel));
}

/** The price of the next unit of `item` right now through `channel` (0.9 market, 1.0 bin). */
export function unitPrice(
  state: GameState,
  data: GameData,
  mods: Modifiers,
  item: ItemId,
  channel = MARKET_CHANNEL,
): number {
  const def = data.items[item];
  if (!def) return 0;
  return unitPriceAt(def, demandOf(state, item), priceFactor(state, def, mods), channel);
}

/** The effective price multiplier (demand × special), as recorded in the sparkline. */
export function effectiveMultiplier(state: GameState, item: ItemId): number {
  return demandOf(state, item) * (1 + specialBonus(state, item));
}

export interface Quote {
  qty: number;
  gold: number;
  demandAfter: number;
}

/** The exact total for selling `qty` units now, one unit at a time with demand dropping after each. */
export function quoteSale(
  state: GameState,
  data: GameData,
  mods: Modifiers,
  item: ItemId,
  qty: number,
  channel = MARKET_CHANNEL,
): Quote {
  const def = data.items[item];
  let demand = demandOf(state, item);
  if (!def || !def.sellable || qty <= 0) return { qty: 0, gold: 0, demandAfter: demand };
  const factor = priceFactor(state, def, mods);
  const step = demandStep(def.basePrice);
  let gold = 0;
  for (let i = 0; i < qty; i++) {
    gold += unitPriceAt(def, demand, factor, channel);
    demand = Math.max(DEMAND_FLOOR, demand - step);
  }
  return { qty, gold, demandAfter: demand };
}

function entry(state: GameState, item: ItemId): MarketItemState {
  let e = state.market.items[item];
  if (!e) {
    e = { demand: 1, lastSoldSimMs: -1, history: [] };
    state.market.items[item] = e;
  }
  return e;
}

/**
 * Applies a sale that has already left the inventory (or the bin): pays the quoted gold, lowers
 * demand and records the time. `atSimMs` is the moment of the sale. Returns the gold paid.
 */
export function settleSale(
  state: GameState,
  ctx: SimContext,
  item: ItemId,
  qty: number,
  channel: number,
  via: 'market' | 'bin',
  atSimMs: number,
): number {
  const q = quoteSale(state, ctx.data, ctx.mods, item, qty, channel);
  if (q.qty === 0) return 0;
  const e = entry(state, item);
  e.demand = q.demandAfter;
  e.lastSoldSimMs = atSimMs;
  ctx.events.push({ type: 'sold', item, qty, gold: q.gold, via });
  earn(state, ctx, q.gold, 'sale');
  return q.gold;
}

/** Market panel: sells `qty` of `item` from the inventory instantly at 90%. */
export function sellItems(state: GameState, ctx: SimContext, item: ItemId, qty: number): ActionResult {
  const def = ctx.data.items[item];
  if (!def) return fail('Unknown item.');
  if (!def.sellable) return fail(`${def.name} can't be sold.`);
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to sell.');
  if (countItem(state.inventory, item) < qty) return fail(`You don't have ${qty} ${def.name}.`);
  // Plain (non-hearty) stacks go first; phase 06 decides how hearty dishes are offered.
  removeItem(state.inventory, item, qty);
  settleSale(state, ctx, item, qty, MARKET_CHANNEL, 'market', state.clock.simMs);
  return OK;
}

// ---- demand over time

/** Rest target after `sinceMs` of simulated time unsold (-1 = never sold: always 1.0). */
export function restTarget(sinceMs: number): number {
  if (sinceMs < 0) return 1;
  const h = sinceMs / HOUR_MS;
  if (h < REST_START_HOURS) return 1;
  return Math.min(DEMAND_CEIL, 1 + REST_PER_HOUR * h);
}

/**
 * Demand after `dtMs` of simulated time, starting at `demand` with the item last sold `sinceMs`
 * ago (-1 = never). Exact: the rest target is constant, then linear, then constant in time, and the
 * relaxation d' = (T(t) − d) / τ is solved in closed form on each piece.
 */
export function demandAfter(demand: number, sinceMs: number, dtMs: number): number {
  const tau = DEMAND_TAU_MIN;
  let d = demand;
  if (sinceMs < 0) {
    d = 1 + (d - 1) * Math.exp(-dtMs / MIN_MS / tau);
    return clampDemand(d);
  }
  const rampStart = REST_START_HOURS * HOUR_MS;
  const rampEnd = Math.max(rampStart, ((DEMAND_CEIL - 1) / REST_PER_HOUR) * HOUR_MS); // 3 h: target reaches the ceiling
  let s = sinceMs;
  const end = sinceMs + dtMs;
  while (s < end) {
    const pieceEnd = s < rampStart ? rampStart : s < rampEnd ? rampEnd : Infinity;
    const b = Math.min(end, pieceEnd);
    const t = (b - s) / MIN_MS; // minutes in this piece
    const decay = Math.exp(-t / tau);
    if (s >= rampStart && s < rampEnd) {
      // T(t) = T0 + k t (k per minute): d(t) = T0 + k (t − τ) + (d0 − T0 + k τ) e^(−t/τ)
      const k = REST_PER_HOUR / 60;
      const t0 = restTarget(s);
      d = t0 + k * (t - tau) + (d - t0 + k * tau) * decay;
    } else {
      const target = restTarget(s);
      d = target + (d - target) * decay;
    }
    s = b;
  }
  return clampDemand(d);
}

function clampDemand(d: number): number {
  return Math.min(DEMAND_CEIL, Math.max(DEMAND_FLOOR, d));
}

/** Demand relaxes for every item the market knows about. */
export function tickMarket(state: GameState, _ctx: SimContext, dtMs: number): void {
  const now = state.clock.simMs;
  for (const e of Object.values(state.market.items)) {
    if (!e) continue;
    const since = e.lastSoldSimMs < 0 ? -1 : now - e.lastSoldSimMs;
    if (since < 0 && e.demand === 1) continue;
    e.demand = demandAfter(e.demand, since, dtMs);
  }
}

// ---- daily refresh: specials and the sparkline

/** Sellable items the player can obtain now: unlocked, in-season crops (fish and dishes join later). */
export function specialCandidates(state: GameState, data: GameData, season: SeasonId): ItemId[] {
  return CROP_IDS.filter((c) => {
    const crop = data.crops[c];
    return crop.seasons.includes(season) && isUnlocked(state, crop.unlock) && data.items[c]?.sellable;
  });
}

/** Draws today's specials: 1–3 items without replacement, each +20% to +50%. */
export function rollSpecials(state: GameState, data: GameData, rng: Rng, season: SeasonId): void {
  const pool = specialCandidates(state, data, season);
  const n = 1 + rng.int(0, SPECIALS_EXTRA_MAX);
  const specials: GameState['market']['specials'] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = rng.int(0, pool.length - 1);
    const [item] = pool.splice(idx, 1);
    const bonus = SPECIAL_BONUS_MIN + SPECIAL_BONUS_STEP * rng.int(0, SPECIAL_BONUS_STEPS);
    specials.push({ item: item!, bonus: Math.round(bonus * 100) / 100 });
  }
  state.market.specials = specials;
}

/** Adds today's point to every sellable item's sparkline (keeping the last 7). */
export function recordHistory(state: GameState, data: GameData): void {
  for (const def of Object.values(data.items)) {
    if (!def?.sellable) continue;
    const e = entry(state, def.id);
    e.history.push(Math.round(effectiveMultiplier(state, def.id) * 1000) / 1000);
    if (e.history.length > MARKET_HISTORY_DAYS) e.history.splice(0, e.history.length - MARKET_HISTORY_DAYS);
  }
}

/** The 06:00 refresh for the market: new specials, then today's sparkline point. */
export function openMarketDay(state: GameState, data: GameData, rng: Rng, season: SeasonId): void {
  rollSpecials(state, data, rng, season);
  recordHistory(state, data);
}

/** ▲ / ▼ / ▬ against the last daily point (or 1.0 without history). */
export function priceTrend(state: GameState, item: ItemId): 'up' | 'down' | 'flat' {
  const hist = state.market.items[item]?.history ?? [];
  const ref = hist[hist.length - 1] ?? 1;
  const now = effectiveMultiplier(state, item);
  if (now > ref + 0.02) return 'up';
  if (now < ref - 0.02) return 'down';
  return 'flat';
}
