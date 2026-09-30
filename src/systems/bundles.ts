// The Community Board (GDD §6.6, BALANCE.md §10): six bundles of items to donate, each with a
// permanent reward. Donated items are recorded per bundle in `progression.bundles`; a completed
// bundle moves to `completedBundles` and its reward is read from there (`bundleBonuses`), except
// extra bag slots, which are added once, when the bundle completes.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import type { BundleId, ItemId } from '../data/ids';
import type { ItemStack } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { countItem, removeItem } from './inventory';

export function isBundleDone(state: GameState, id: BundleId): boolean {
  return state.progression.completedBundles.includes(id);
}

/** How many of `item` have been donated to `bundle`. */
export function donated(state: GameState, id: BundleId, item: ItemId): number {
  return state.progression.bundles[id]?.find((s) => s.item === item)?.qty ?? 0;
}

/** One slot of a bundle: what it needs, what is in, what is still missing. */
export interface BundleSlotStatus {
  item: ItemId;
  need: number;
  have: number;
  done: boolean;
}

export function bundleSlots(state: GameState, data: GameData, id: BundleId): BundleSlotStatus[] {
  const done = isBundleDone(state, id);
  return data.bundles[id].slots.map((s) => {
    const have = done ? s.qty : Math.min(s.qty, donated(state, id, s.item));
    return { item: s.item, need: s.qty, have, done: have >= s.qty };
  });
}

/** Units donated and units needed over the whole bundle. */
export function bundleProgress(
  state: GameState,
  data: GameData,
  id: BundleId,
): { have: number; need: number } {
  const slots = bundleSlots(state, data, id);
  return { have: slots.reduce((n, s) => n + s.have, 0), need: slots.reduce((n, s) => n + s.need, 0) };
}

export interface BundleBonuses {
  luck: number;
  buffSlots: number;
  inventorySlots: number;
  trapPerLocation: number;
  goldenScarecrow: boolean;
  greenhouse: boolean;
}

const NO_BUNDLE_BONUSES: Readonly<BundleBonuses> = Object.freeze({
  luck: 0,
  buffSlots: 0,
  inventorySlots: 0,
  trapPerLocation: 0,
  goldenScarecrow: false,
  greenhouse: false,
});

/** What the completed bundles give, in total. Do not modify the result. */
export function bundleBonuses(state: GameState, data: GameData): Readonly<BundleBonuses> {
  if (state.progression.completedBundles.length === 0) return NO_BUNDLE_BONUSES;
  const b: BundleBonuses = {
    luck: 0,
    buffSlots: 0,
    inventorySlots: 0,
    trapPerLocation: 0,
    goldenScarecrow: false,
    greenhouse: false,
  };
  for (const id of state.progression.completedBundles) {
    const r = data.bundles[id].reward;
    switch (r.kind) {
      case 'fishingLuck':
        b.luck += r.bonus;
        break;
      case 'buffSlot':
        b.buffSlots += 1;
        break;
      case 'inventorySlots':
        b.inventorySlots += r.count;
        break;
      case 'trapPerLocation':
        b.trapPerLocation += r.count;
        break;
      case 'goldenScarecrow':
        b.goldenScarecrow = true;
        break;
      case 'unlockGreenhouse':
        b.greenhouse = true;
        break;
    }
  }
  b.luck = Math.round(b.luck * 10_000) / 10_000;
  return b;
}

/**
 * The `donate` action: gives up to `qty` of `item` from the bag to `bundle` (never more than the
 * bundle still needs). Completing the last slot completes the bundle.
 */
export function donate(
  state: GameState,
  ctx: SimContext,
  id: BundleId,
  item: ItemId,
  qty: number,
): ActionResult {
  const def = ctx.data.bundles[id];
  if (!def) return fail('There is no such bundle.');
  if (isBundleDone(state, id)) return fail(`${def.name} is already complete.`);
  const slot = def.slots.find((s) => s.item === item);
  const name = ctx.data.items[item]?.name ?? item;
  if (!slot) return fail(`${def.name} does not need ${name}.`);
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to give.');
  const missing = slot.qty - donated(state, id, item);
  if (missing <= 0) return fail(`${def.name} has all the ${name} it needs.`);
  const give = Math.min(qty, missing, countItem(state.inventory, item));
  if (give <= 0) return fail(`You don't have any ${name}.`);
  // Plain stacks first: hearty dishes are worth more to eat.
  const plain = Math.min(give, countItem(state.inventory, item, false));
  if (plain > 0) removeItem(state.inventory, item, plain, false);
  if (give - plain > 0) removeItem(state.inventory, item, give - plain, true);
  const list = (state.progression.bundles[id] ??= []);
  const entry = list.find((s) => s.item === item);
  if (entry) entry.qty += give;
  else list.push({ item, qty: give });
  if (def.slots.every((s) => donated(state, id, s.item) >= s.qty)) completeBundle(state, ctx, id);
  return OK;
}

function completeBundle(state: GameState, ctx: SimContext, id: BundleId): void {
  state.progression.completedBundles.push(id);
  const reward = ctx.data.bundles[id].reward;
  if (reward.kind === 'inventorySlots') {
    for (let i = 0; i < reward.count; i++) state.inventory.slots.push(null);
  }
  ctx.events.push({ type: 'bundleCompleted', bundle: id });
}

/** Bag stacks that could go into `bundle` right now (for the "Give" buttons). */
export function donatable(state: GameState, data: GameData, id: BundleId): ItemStack[] {
  return bundleSlots(state, data, id)
    .filter((s) => !s.done && countItem(state.inventory, s.item) > 0)
    .map((s) => ({
      item: s.item,
      qty: Math.min(s.need - s.have, countItem(state.inventory, s.item)),
    }));
}
