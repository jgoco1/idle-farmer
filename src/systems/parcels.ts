// Land parcels (GDD §12.1, BALANCE.md §13.1): regions of the world bought with gold, in order.
// Owning one only makes space for now; v2 phases 02–04 give the space its uses.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { PARCEL_IDS, type ParcelId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { isUnlocked, unlockHint } from './unlocks';

export type ParcelStatus = 'owned' | 'available' | 'locked';

export function ownsParcel(state: GameState, id: ParcelId): boolean {
  return state.land.parcels.includes(id);
}

/** Owned; available (every condition met, gold aside); or locked. */
export function parcelStatus(state: GameState, data: GameData, id: ParcelId): ParcelStatus {
  if (ownsParcel(state, id)) return 'owned';
  return isUnlocked(state, data.parcels[id].requires, data) ? 'available' : 'locked';
}

/** The next parcel to buy, in order, or null when every parcel is owned. */
export function nextParcel(state: GameState): ParcelId | null {
  return PARCEL_IDS.find((id) => !ownsParcel(state, id)) ?? null;
}

export function buyParcel(state: GameState, ctx: SimContext, id: ParcelId): ActionResult {
  const def = ctx.data.parcels[id];
  if (!def) return fail('Unknown parcel.');
  if (ownsParcel(state, id)) return fail(`${def.name} is already yours.`);
  if (!isUnlocked(state, def.requires, ctx.data)) {
    return fail(unlockHint(state, ctx.data, def.requires) ?? `${def.name} is not for sale yet.`);
  }
  if (!canAfford(state, def.price)) return fail(`You need ${def.price.toLocaleString('en-US')}g for that.`);
  spend(state, def.price);
  state.land.parcels.push(id);
  ctx.events.push({ type: 'purchased', what: id, gold: def.price });
  ctx.events.push({ type: 'parcelBought', parcel: id });
  return OK;
}
