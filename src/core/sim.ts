// The simulation step and calendar-event processing, shared by the live loop and the offline walk.

import type { GameData } from '../data';
import type { GameEvent } from './events';
import { createRng } from './rng';
import type { GameState } from './state';
import { buildCalendar, seasonOfWeek, weekIndexAt, dayKeyAt, type Calendar, type LocalClock } from './time';
import { computeModifiers } from '../systems/modifiers';
import type { SimContext } from '../systems/context';
import { msToNextSimEvent, onDayStarted, onSeasonChanged, tickSystems } from '../systems';

/** At most this many season changes are applied for one jump (withering is idempotent). */
export const MAX_SEASON_CHANGES_PER_JUMP = 4;

export function makeContext(
  state: GameState,
  data: GameData,
  calendar: Calendar,
  events: GameEvent[] = [],
): SimContext {
  return { data, rng: createRng(state), calendar, mods: computeModifiers(state, data), events };
}

/**
 * Advances simulated time by `dtMs` (an integer), in one large step when nothing is pending, or split
 * at every simulated-time event reported by the systems. `ctx.calendar` stays fixed throughout.
 */
export function step(state: GameState, ctx: SimContext, dtMs: number): void {
  let remaining = Math.max(0, Math.round(dtMs));
  while (remaining > 0) {
    ctx.mods = computeModifiers(state, ctx.data); // before the event query: it reads the modifiers too
    const untilEvent = msToNextSimEvent(state, ctx);
    const d =
      Number.isFinite(untilEvent) && untilEvent > 0 ? Math.min(remaining, Math.ceil(untilEvent)) : remaining;
    tickSystems(state, ctx, d);
    state.clock.simMs += d;
    remaining -= d;
  }
}

/**
 * Fires the calendar events that calendar time `t` has reached: season changes (in order, at most
 * MAX_SEASON_CHANGES_PER_JUMP) and then the daily refresh (once, for the latest day). A clock set
 * back fires nothing: the day key and week index only move forward.
 */
export function processCalendar(
  state: GameState,
  data: GameData,
  lc: LocalClock,
  t: number,
  events: GameEvent[],
): void {
  const cal = state.calendar;
  const week = weekIndexAt(t, cal.seasonEpoch, lc);
  const dayKey = dayKeyAt(t, lc);
  if (week <= cal.maxWeekIndex && dayKey <= cal.lastDayKey) return;

  if (week > cal.maxWeekIndex) {
    const first = Math.max(cal.maxWeekIndex + 1, week - MAX_SEASON_CHANGES_PER_JUMP + 1);
    for (let w = first; w <= week; w++) {
      cal.maxWeekIndex = w;
      const ctx = makeContext(state, data, buildCalendar(t, cal, lc), events);
      const season = seasonOfWeek(w);
      const withered = onSeasonChanged(state, ctx, season);
      events.push({ type: 'seasonChanged', season, withered });
    }
    cal.maxWeekIndex = week;
  }
  if (dayKey > cal.lastDayKey) {
    cal.lastDayKey = dayKey;
    const ctx = makeContext(state, data, buildCalendar(t, cal, lc), events);
    onDayStarted(state, ctx);
    events.push({ type: 'dayStarted', dayKey });
  }
}
