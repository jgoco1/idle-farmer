// The list of simulation systems and the calendar hooks. This is where later phases plug in:
// add a `tickX(state, ctx, dtMs)` call to `tickSystems`, a timer to `msToNextSimEvent`, and daily or
// seasonal reactions to `onDayStarted` / `onSeasonChanged`. Order follows GDD §6.3.

import type { GameState } from '../core/state';
import type { SeasonId } from '../data/ids';
import type { SimContext } from './context';

/**
 * Advances every system by `dtMs` of simulated time. The core guarantees that no simulated-time
 * event (see msToNextSimEvent) falls strictly inside `dtMs`, and that the calendar in `ctx` is fixed.
 * Every system must give the same result for one large step as for many small ones.
 */
export function tickSystems(_state: GameState, _ctx: SimContext, _dtMs: number): void {
  // phase 02: tickFarming(state, ctx, dtMs)
  // phase 03: tickMarket(state, ctx, dtMs); tickShippingBin(...)
  // phase 04: tickAutomation(...)   phase 05: tickTraps(...)   phase 06: tickKitchen(...); tickBuffs(...)
}

/**
 * Simulated ms until the next moment a large step must stop at (a buff expiring, a dish finishing,
 * a watering running out). `Infinity` when nothing is pending. Used by the core to split steps.
 */
export function msToNextSimEvent(_state: GameState, _ctx: SimContext): number {
  return Infinity;
}

/** Daily refresh at 06:00 local (BALANCE.md §1): market specials, goldToday, per-day goals. */
export function onDayStarted(_state: GameState, _ctx: SimContext): void {
  // phase 03: rollSpecials, recordMarketHistory, stats.goldToday = 0, stats.daysPassed += 1
}

/** Weekly season change at Sunday 00:00 local. Returns the number of crops that withered. */
export function onSeasonChanged(_state: GameState, _ctx: SimContext, _season: SeasonId): number {
  // phase 02: return witherOutOfSeasonCrops(state, ctx, season)
  return 0;
}
