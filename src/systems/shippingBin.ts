// The Shipping Bin (GDD §6.2, BALANCE.md §3). Items dropped in the bin are sold at 100% of the
// price at the moment of the hourly pickup (every BIN_PICKUP_MS of simulated time). The pickup
// timer always runs; while the bin holds items, `msToNextPickup` reports it so the core splits
// steps exactly at each pickup and demand recovers between pickups as it would online.

import type { GameState } from '../core/state';
import { BIN_CHANNEL, BIN_PICKUP_MS } from '../data/balance';
import type { ItemId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { addItem, canAdd, countItem, removeItem } from './inventory';
import { quoteSale, settleSale } from './market';

/** Moves `qty` of `item` from the inventory into the bin. */
export function shipItems(state: GameState, ctx: SimContext, item: ItemId, qty: number): ActionResult {
  const def = ctx.data.items[item];
  if (!def) return fail('Unknown item.');
  if (!def.sellable) return fail(`${def.name} can't be shipped.`);
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to ship.');
  if (countItem(state.inventory, item) < qty) return fail(`You don't have ${qty} ${def.name}.`);
  removeItem(state.inventory, item, qty);
  addToBin(state, item, qty);
  return OK;
}

/** Puts `qty` of `item` in the bin, merging with an existing stack. */
export function addToBin(state: GameState, item: ItemId, qty: number): void {
  const stack = state.shippingBin.items.find((s) => s.item === item);
  if (stack) stack.qty += qty;
  else state.shippingBin.items.push({ item, qty });
}

/** Takes everything of `item` back out of the bin (all or nothing, if the bag has room). */
export function unshipItems(state: GameState, _ctx: SimContext, item: ItemId): ActionResult {
  const i = state.shippingBin.items.findIndex((s) => s.item === item);
  const stack = state.shippingBin.items[i];
  if (!stack) return fail('That is not in the bin.');
  if (!canAdd(state.inventory, item, stack.qty)) return fail('Your bag is too full to take it back.');
  addItem(state.inventory, item, stack.qty);
  state.shippingBin.items.splice(i, 1);
  return OK;
}

export function binCount(state: GameState): number {
  return state.shippingBin.items.reduce((n, s) => n + s.qty, 0);
}

/** What the bin would pay if it were collected right now (the prices can still move before pickup). */
export function binValueNow(state: GameState, ctx: Pick<SimContext, 'data' | 'mods'>): number {
  return state.shippingBin.items.reduce(
    (g, s) => g + quoteSale(state, ctx.data, ctx.mods, s.item, s.qty, BIN_CHANNEL).gold,
    0,
  );
}

/** Sells everything in the bin at this moment's prices. */
function collect(state: GameState, ctx: SimContext, atSimMs: number): void {
  const items = state.shippingBin.items;
  if (items.length === 0) return;
  state.shippingBin.items = [];
  let gold = 0;
  let units = 0;
  for (const s of items) {
    gold += settleSale(state, ctx, s.item, s.qty, BIN_CHANNEL, 'bin', atSimMs);
    units += s.qty;
  }
  state.stats.itemsShipped += units;
  ctx.events.push({ type: 'binCollected', gold, items: units });
}

/**
 * Counts down to the next pickup. The core never lets a step run past a pickup while the bin holds
 * items (see msToNextPickup), so at most one pickup falls in a step and it lands at the step's end;
 * an empty bin simply wraps its timer.
 */
export function tickShippingBin(state: GameState, ctx: SimContext, dtMs: number): void {
  const bin = state.shippingBin;
  if (dtMs < bin.msToPickup) {
    bin.msToPickup -= dtMs;
    return;
  }
  const over = dtMs - bin.msToPickup; // > 0 only when the bin was empty
  collect(state, ctx, state.clock.simMs + bin.msToPickup);
  bin.msToPickup = BIN_PICKUP_MS - (over % BIN_PICKUP_MS);
}

/**
 * Simulated ms until the next pickup that has something to collect, or Infinity. With the
 * Auto-Seller the bin can fill at any moment, so its pickups are always reported: a large step then
 * never jumps over a pickup that the farmhand's harvest would have landed in.
 */
export function msToNextPickup(state: GameState): number {
  const fills = state.shippingBin.items.length > 0 || (state.upgrades.auto_seller ?? 0) > 0;
  return fills ? state.shippingBin.msToPickup : Infinity;
}
