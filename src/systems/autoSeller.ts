// The Auto-Seller (GDD §6.3, BALANCE.md §4): harvests of toggled-on items go to the Shipping Bin
// instead of the bag. Level 2 keeps a reserve of each item in the bag for cooking. Manual and
// automated harvests take the same route (`stowHarvest`).

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { AUTO_SELLER_RESERVE } from '../data/balance';
import type { ItemId } from '../data/ids';
import { fail, OK, type ActionResult } from './context';
import { addItem, countItem, spaceFor } from './inventory';
import { addToBin } from './shippingBin';
import { hasFlag } from './upgrades';

/** The per-item toggle: on unless the player turned it off; crops and fruit are on by default. */
export function autoSellOn(state: GameState, data: GameData, item: ItemId): boolean {
  const def = data.items[item];
  if (!def?.sellable) return false;
  return state.autoSell[item] ?? (def.category === 'crop' || def.category === 'fruit');
}

/** Whether harvested `item` is shipped automatically right now. */
export function shipsAutomatically(state: GameState, data: GameData, item: ItemId): boolean {
  return hasFlag(state, data, 'auto_seller', 'autoShip') && autoSellOn(state, data, item);
}

/** How many of `item` the bag keeps back from automatic shipping. */
export function reserveFor(state: GameState, data: GameData): number {
  return hasFlag(state, data, 'auto_seller', 'keepReserve') ? AUTO_SELLER_RESERVE : 0;
}

/**
 * Stores a harvest: into the bag, or (with the Auto-Seller) into the bin, keeping the reserve in the
 * bag when there is room. Returns how much went where, or null when it does not fit in the bag and
 * cannot be shipped; nothing changes then.
 */
export function stowHarvest(
  state: GameState,
  data: GameData,
  item: ItemId,
  qty: number,
): { inv: number; bin: number } | null {
  const inv = state.inventory;
  if (!shipsAutomatically(state, data, item)) {
    if (!addItem(inv, item, qty)) return null;
    return { inv: qty, bin: 0 };
  }
  const keep = Math.max(0, reserveFor(state, data) - countItem(inv, item));
  const toInv = Math.min(qty, keep, spaceFor(inv, item));
  if (toInv > 0) addItem(inv, item, toInv);
  if (qty - toInv > 0) addToBin(state, item, qty - toInv);
  return { inv: toInv, bin: qty - toInv };
}

/** The `setAutoSell` action: turns automatic shipping of one item on or off. */
export function setAutoSell(state: GameState, data: GameData, item: ItemId, on: boolean): ActionResult {
  const def = data.items[item];
  if (!def?.sellable) return fail('That cannot be shipped.');
  state.autoSell[item] = on;
  return OK;
}
