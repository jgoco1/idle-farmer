// TODO(phase03): the temporary Seed Crate. It sells in-season, unlocked seeds at their data price so
// the farming loop is playable before the real Shop and Market exist. Phase 03 replaces or extends
// this with the Shop panel (and its purchase events and stats).

import type { GameState } from '../core/state';
import { seedOf, type CropId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { addItem, canAdd } from './inventory';
import { inSeason } from './farming';
import { isUnlocked } from './unlocks';

export function buySeeds(state: GameState, ctx: SimContext, crop: CropId, qty: number): ActionResult {
  const def = ctx.data.crops[crop];
  if (!def) return fail('Unknown seed.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many seeds to buy.');
  if (!isUnlocked(state, def.unlock)) return fail(`${def.name} seeds are not available yet.`);
  if (!inSeason(def, ctx.calendar.season)) return fail(`${def.name} seeds are out of season.`);
  const cost = def.seedPrice * qty;
  if (state.gold < cost) return fail(`You need ${cost}g for that.`);
  if (!canAdd(state.inventory, seedOf(crop), qty)) return fail('Your bag is full.');
  state.gold -= cost;
  addItem(state.inventory, seedOf(crop), qty);
  ctx.events.push({ type: 'purchased', what: seedOf(crop), gold: cost });
  return OK;
}
