// Fish Traps (GDD §6.4, BALANCE.md §6): idle fishing. Each trap rolls one catch every
// TRAP_INTERVAL_SEC of simulated time (scaled by `fishingSpeedModifier`), holds TRAP_CAPACITY items,
// and ignores the time of day, so night fish reach players who never play at night. The pool is the
// trappable (common and uncommon) fish in season at the trap's location, plus junk.
//
// Offline correctness: rolls are `floor((progress + dt · speed) / interval)`, so one large step
// gives the same number of catches as many small ones. Nothing here changes a rate mid-step, so
// traps do not report to `msToNextSimEvent`.

import type { GameState, TrapState } from '../core/state';
import { TRAP_CAPACITY, TRAP_INTERVAL_SEC } from '../data/balance';
import type { Modifiers } from './modifiers';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { stowHarvest } from './autoSeller';
import { chooseCatch, recordCatch } from './fishing';

export const TRAP_INTERVAL_MS = TRAP_INTERVAL_SEC * 1000;

/** What a trap holds: the base capacity plus the Fishing perks. */
export function trapCapacity(mods: Pick<Modifiers, 'trapCapacityBonus'>): number {
  return TRAP_CAPACITY + mods.trapCapacityBonus;
}

export function trapItemCount(trap: TrapState): number {
  return trap.contents.reduce((n, s) => n + s.qty, 0);
}

function putIn(trap: TrapState, item: TrapState['contents'][number]['item']): void {
  const stack = trap.contents.find((s) => s.item === item);
  if (stack) stack.qty += 1;
  else trap.contents.push({ item, qty: 1 });
}

/**
 * Advances every trap by `dtMs` of simulated time. A full trap stops rolling and waits at the
 * threshold (progress kept), so it rolls again the moment it is emptied.
 */
export function tickTraps(state: GameState, ctx: SimContext, dtMs: number): void {
  if (state.fishing.traps.length === 0 || dtMs <= 0) return;
  const scaled = Math.round(dtMs * Math.max(0, ctx.mods.fishingSpeedModifier));
  const capacity = trapCapacity(ctx.mods);
  for (const trap of state.fishing.traps) {
    let progress = trap.progressMs + scaled;
    while (progress >= TRAP_INTERVAL_MS) {
      if (trapItemCount(trap) >= capacity) {
        progress = TRAP_INTERVAL_MS;
        break;
      }
      const pick = chooseCatch(state, ctx, trap.location, 'trap');
      putIn(trap, pick.id);
      recordCatch(state, ctx, pick.id, pick.sizeCm, trap.location, true);
      progress -= TRAP_INTERVAL_MS;
    }
    trap.progressMs = progress;
  }
}

/** Moves what fits from one trap into the bag (or the Shipping Bin, for items the Auto-Seller ships). Returns the count moved. */
function emptyTrap(state: GameState, ctx: SimContext, trap: TrapState): number {
  let moved = 0;
  const left: TrapState['contents'] = [];
  for (const stack of trap.contents) {
    if (stowHarvest(state, ctx.data, stack.item, stack.qty)) moved += stack.qty;
    else left.push(stack);
  }
  trap.contents = left;
  if (left.length > 0) ctx.events.push({ type: 'inventoryFull', item: left[0]!.item });
  if (moved > 0) ctx.events.push({ type: 'trapCollected', location: trap.location, items: moved });
  return moved;
}

/** The `collectTrap` action: click a trap to take what is in it. */
export function collectTrap(state: GameState, ctx: SimContext, id: number): ActionResult {
  const trap = state.fishing.traps.find((t) => t.id === id);
  if (!trap) return fail('There is no trap there.');
  if (trap.contents.length === 0) {
    return fail(`Still filling: ${trapItemCount(trap)} / ${trapCapacity(ctx.mods)} so far.`);
  }
  emptyTrap(state, ctx, trap);
  return trap.contents.length === 0 ? OK : fail('Your bag is too full to take it all.');
}

/** The Trap Collector: empties every trap at a shipping-bin pickup. Returns the items moved. */
export function collectAllTraps(state: GameState, ctx: SimContext): number {
  let moved = 0;
  for (const trap of state.fishing.traps) moved += emptyTrap(state, ctx, trap);
  return moved;
}

/**
 * Simulated ms until the next trap roll, or Infinity. A catch pays Fishing XP, and a level-up
 * changes luck and trap capacity, so a large step must stop at each roll for one step to equal many.
 */
export function msToNextTrapRoll(state: GameState, ctx: Pick<SimContext, 'mods'>): number {
  const speed = ctx.mods.fishingSpeedModifier;
  if (state.fishing.traps.length === 0 || !(speed > 0)) return Infinity;
  const capacity = trapCapacity(ctx.mods);
  let ms = Infinity;
  for (const trap of state.fishing.traps) {
    if (trapItemCount(trap) >= capacity) continue; // full: waits to be emptied, rolls nothing
    ms = Math.min(ms, Math.max(1, Math.ceil((TRAP_INTERVAL_MS - trap.progressMs) / speed)));
  }
  return ms;
}
