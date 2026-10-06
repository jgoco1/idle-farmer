// Seed Order (v2 phase 06, BALANCE.md §13.15): a farmhand upgrade that buys seeds at each Shipping Bin
// pickup, so an automated farm does not stall overnight when the bag runs out.
//
// For every crop the planter last planted somewhere that is in season and ripens before the season ends,
// in table order, it tops the bag up to the level's target at the Shop price plus a delivery fee. It never
// spends below the player's gold reserve, a percentage of the gold held when the pickup began, and per crop it is
// all or nothing (the whole order fits the bag and the purse, or it waits). It acts only at pickups, in simulated
// time, with no RNG, so one large step equals many small ones.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { SEED_ORDER_FEE, SEED_ORDER_RESERVES } from '../data/balance';
import { CROP_IDS, seedOf, type CropId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { spend } from './economy';
import { rememberedCrops, finishesBeforeSeasonEnds, inSeason } from './farming';
import { addItem, countItem, spaceFor } from './inventory';
import { effectOf } from './upgrades';

/** Seeds per crop the order keeps in the bag, or 0 when it is not bought. */
export function seedTarget(state: GameState, data: GameData): number {
  return effectOf(state, data, 'seed_order')?.seedTarget ?? 0;
}

/** What `qty` seeds cost with the delivery fee: the Shop price plus the fee, rounded up. */
export function orderCost(data: GameData, crop: CropId, qty: number): number {
  const base = data.crops[crop].seedPrice * qty;
  return base + Math.ceil(base * SEED_ORDER_FEE);
}

/** The gold the order will not spend below, for gold `gold`. */
export function reserveOf(state: GameState, gold: number): number {
  return Math.floor((gold * state.seedOrder.reservePct) / 100);
}

/** Crops the planter last planted on any plot of any field (v4-01: the north fields too). */
function plantedCrops(state: GameState): Set<CropId> {
  return rememberedCrops(state);
}

/** The crops the order would stock right now: planted by the planter, in season, ripe in time, not opted out. */
export function orderedCrops(
  state: GameState,
  ctx: Pick<SimContext, 'data' | 'calendar' | 'mods'>,
): CropId[] {
  const used = plantedCrops(state);
  return CROP_IDS.filter((c) => {
    if (!used.has(c) || state.seedOrder.off.includes(c)) return false;
    const def = ctx.data.crops[c];
    return inSeason(def, ctx.calendar.season) && finishesBeforeSeasonEnds(def, ctx.calendar, ctx.mods);
  });
}

/** One pickup's order. Returns nothing; each purchase is a `seedsOrdered` event. */
export function runSeedOrder(state: GameState, ctx: SimContext): void {
  const target = seedTarget(state, ctx.data);
  if (target <= 0) return;
  const reserve = reserveOf(state, state.gold);
  for (const crop of orderedCrops(state, ctx)) {
    const seed = seedOf(crop);
    const need = target - countItem(state.inventory, seed);
    if (need <= 0 || spaceFor(state.inventory, seed) < need) continue;
    const cost = orderCost(ctx.data, crop, need);
    if (state.gold - cost < reserve) continue;
    spend(state, cost);
    addItem(state.inventory, seed, need);
    ctx.events.push({ type: 'seedsOrdered', crop, qty: need, gold: cost });
  }
}

/** The `setSeedOrderReserve` action: one of the offered percentages. */
export function setSeedOrderReserve(state: GameState, pct: number): ActionResult {
  if (!SEED_ORDER_RESERVES.includes(pct)) return fail('Choose none, 10%, 25% or 50%.');
  state.seedOrder.reservePct = pct;
  return OK;
}

/** The `setSeedOrderCrop` action: turns the order for one crop on or off. */
export function setSeedOrderCrop(state: GameState, crop: CropId, on: boolean): ActionResult {
  if (!CROP_IDS.includes(crop)) return fail('Unknown crop.');
  const off = state.seedOrder.off;
  const i = off.indexOf(crop);
  if (on && i >= 0) off.splice(i, 1);
  else if (!on && i < 0) off.push(crop);
  return OK;
}
