// The list of simulation systems and the calendar hooks. This is where later phases plug in:
// add a `tickX(state, ctx, dtMs)` call to `tickSystems`, a timer to `msToNextSimEvent`, and daily or
// seasonal reactions to `onDayStarted` / `onSeasonChanged`. Order follows GDD §6.3.

import type { GameState } from '../core/state';
import type { SeasonId } from '../data/ids';
import type { SimContext } from './context';
import { msToNextAutomation, tickAutomation } from './automation';
import { msToNextWaterOut, tickFarming, witherOutOfSeasonCrops } from './farming';
import { openMarketDay, tickMarket } from './market';
import { msToNextPickup, tickShippingBin } from './shippingBin';
import { hasFlag } from './upgrades';
import { collectAllTraps, tickTraps } from './traps';
import { learnMilestoneRecipes, msToNextCookFinish, tickCooking } from './cooking';
import { msToNextBuffExpiry, tickBuffs } from './buffs';

/**
 * Advances every system by `dtMs` of simulated time. The core guarantees that no simulated-time
 * event (see msToNextSimEvent) falls strictly inside `dtMs`, and that the calendar in `ctx` is fixed.
 * Every system must give the same result for one large step as for many small ones.
 */
export function tickSystems(state: GameState, ctx: SimContext, dtMs: number): void {
  tickFarming(state, ctx, dtMs);
  tickAutomation(state, ctx, dtMs); // farmhand harvest → planter (auto-ship is part of harvesting), before the bin
  tickTraps(state, ctx, dtMs); // idle fishing: one roll per trap per 3 simulated minutes
  tickMarket(state, ctx, dtMs);
  // The Trap Collector empties the traps into the bag (or the bin) just before the pickup that sells the bin.
  if (dtMs >= state.shippingBin.msToPickup && hasFlag(state, ctx.data, 'trap_collector', 'autoCollect')) {
    collectAllTraps(state, ctx);
  }
  tickShippingBin(state, ctx, dtMs); // last: a pickup lands at the end of the step, at that moment's prices
  tickCooking(state, ctx, dtMs); // dishes finish (hearty in winter) into the bag
  learnMilestoneRecipes(state, ctx);
  tickBuffs(state, ctx, dtMs); // last: this step's bonuses were applied through ctx.mods
}

/**
 * Simulated ms until the next moment a large step must stop at (a buff expiring, a dish finishing,
 * a watering running out, a shipping-bin pickup, the next farmhand visit with work to do). `Infinity` when nothing is pending. Used by the
 * core to split steps.
 */
export function msToNextSimEvent(state: GameState, ctx: SimContext): number {
  return Math.min(
    msToNextWaterOut(state, ctx),
    msToNextPickup(state),
    msToNextAutomation(state, ctx),
    msToNextCookFinish(state, ctx),
    msToNextBuffExpiry(state),
  );
}

/** Daily refresh at 06:00 local (BALANCE.md §1): market specials and sparkline, goldToday, per-day goals. */
export function onDayStarted(state: GameState, ctx: SimContext): void {
  openMarketDay(state, ctx.data, ctx.rng, ctx.calendar.season);
  state.stats.goldToday = 0;
  state.stats.daysPassed += 1;
  // phase 07: per-day goal counters
}

/** Weekly season change at Sunday 00:00 local. Returns the number of crops that withered. */
export function onSeasonChanged(state: GameState, ctx: SimContext, season: SeasonId): number {
  return witherOutOfSeasonCrops(state, ctx, season);
}
