// The list of simulation systems and the calendar hooks. This is where later phases plug in:
// add a `tickX(state, ctx, dtMs)` call to `tickSystems`, a timer to `msToNextSimEvent`, and daily or
// seasonal reactions to `onDayStarted` / `onSeasonChanged`. Order follows GDD §6.3.

import type { GameState } from '../core/state';
import type { SeasonId } from '../data/ids';
import type { SimContext } from './context';
import { msToNextWaterOut, tickFarming, witherOutOfSeasonCrops } from './farming';
import { openMarketDay, tickMarket } from './market';
import { msToNextPickup, tickShippingBin } from './shippingBin';

/**
 * Advances every system by `dtMs` of simulated time. The core guarantees that no simulated-time
 * event (see msToNextSimEvent) falls strictly inside `dtMs`, and that the calendar in `ctx` is fixed.
 * Every system must give the same result for one large step as for many small ones.
 */
export function tickSystems(state: GameState, ctx: SimContext, dtMs: number): void {
  tickFarming(state, ctx, dtMs);
  // phase 04: tickAutomation(...) (farmhand → planter → auto-ship) goes here, before the bin
  tickMarket(state, ctx, dtMs);
  tickShippingBin(state, ctx, dtMs); // last: a pickup lands at the end of the step, at that moment's prices
  // phase 05: tickTraps(...)   phase 06: tickKitchen(...); tickBuffs(...)
}

/**
 * Simulated ms until the next moment a large step must stop at (a buff expiring, a dish finishing,
 * a watering running out, a shipping-bin pickup). `Infinity` when nothing is pending. Used by the
 * core to split steps.
 */
export function msToNextSimEvent(state: GameState, ctx: SimContext): number {
  return Math.min(msToNextWaterOut(state, ctx), msToNextPickup(state));
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
