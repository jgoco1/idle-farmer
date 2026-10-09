// Land parcels (GDD §12.1, §13.3; BALANCE.md §13.1, §14.1): regions of the world bought with gold.
// The v2 parcels make space; a north parcel (v4-01) also brings its field's plots into the farm.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { PARCEL_IDS, type ParcelId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { newNorthField } from './farming';
import { openWoods } from './forage';
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
  // A north parcel's field (v4-01): its plots start untilled and the overgrowth clears.
  if (def.field && !state.farm.north[def.field]) state.farm.north[def.field] = newNorthField(def.field);
  ctx.events.push({ type: 'purchased', what: id, gold: def.price });
  ctx.events.push({ type: 'parcelBought', parcel: id });
  if (def.field) ctx.events.push({ type: 'northFieldBought', field: def.field });
  openWoods(state, ctx); // the road to the North Fields runs past the woods (v4-04)
  return OK;
}
