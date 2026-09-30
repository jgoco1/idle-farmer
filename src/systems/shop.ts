// The Shop (GDD §6.2): seeds for the current season. Seeds that need progression are listed but
// locked, with a hint; out-of-season seeds are not stocked. Recipe cards join in phase 06.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { CROP_IDS, seedOf, type CropId, type SeasonId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { inSeason } from './farming';
import { addItem, spaceFor } from './inventory';
import { isUnlocked, unlockHint } from './unlocks';

export interface SeedStock {
  crop: CropId;
  price: number;
  unlocked: boolean;
  /** Why it is locked ("Reach Farm Level 2…"), or null. */
  hint: string | null;
}

/** This season's seed stock, in table order (cheapest crops first). */
export function seedStock(state: GameState, data: GameData, season: SeasonId): SeedStock[] {
  return CROP_IDS.filter((c) => inSeason(data.crops[c], season)).map((crop) => {
    const def = data.crops[crop];
    const unlocked = isUnlocked(state, def.unlock);
    return {
      crop,
      price: def.seedPrice,
      unlocked,
      hint: unlocked ? null : unlockHint(state, data, def.unlock),
    };
  });
}

/** The most seeds of `crop` gold and bag space allow right now (0 if none). */
export function maxAffordableSeeds(state: GameState, data: GameData, crop: CropId): number {
  const price = data.crops[crop].seedPrice;
  return Math.max(0, Math.min(Math.floor(state.gold / price), spaceFor(state.inventory, seedOf(crop))));
}

export function buySeeds(state: GameState, ctx: SimContext, crop: CropId, qty: number): ActionResult {
  const def = ctx.data.crops[crop];
  if (!def) return fail('Unknown seed.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many seeds to buy.');
  if (!inSeason(def, ctx.calendar.season)) return fail(`${def.name} seeds are out of season.`);
  if (!isUnlocked(state, def.unlock)) {
    return fail(`${def.name} seeds are locked. ${unlockHint(state, ctx.data, def.unlock) ?? ''}`.trim());
  }
  const cost = def.seedPrice * qty;
  if (!canAfford(state, cost)) return fail(`You need ${cost}g for that.`);
  if (spaceFor(state.inventory, seedOf(crop)) < qty) return fail('Your bag is full.');
  spend(state, cost);
  addItem(state.inventory, seedOf(crop), qty);
  ctx.events.push({ type: 'purchased', what: seedOf(crop), gold: cost });
  return OK;
}
