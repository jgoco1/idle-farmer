// Offline progress (GDD §4, BALANCE.md §1). Walks the calendar timeline from `from` to `to` in
// segments that end at every rate change (8 h, 24 h), daily 06:00 boundary and weekly season
// boundary, advancing simulated time by the exact integral of the offline rate over each segment.

import type { GameData } from '../data';
import { OFFLINE_FULL_MS, OFFLINE_MIN_MS, OFFLINE_REDUCED_MS, OFFLINE_REDUCED_RATE } from '../data/balance';
import type { SeasonId } from '../data/ids';
import type { GameEvent } from './events';
import { makeContext, processCalendar, step } from './sim';
import type { GameState } from './state';
import { buildCalendar, nextDailyBoundary, nextWeeklyBoundary, type LocalClock } from './time';

export interface OfflineReport {
  awayMs: number; // real (calendar) ms between leaving and returning, 0 if the clock went back
  simulatedMs: number; // simulated ms granted
  dayStarts: number; // daily refreshes fired
  seasonChanges: SeasonId[]; // in order
  events: GameEvent[]; // everything the systems reported, for the summary modal
  showSummary: boolean; // false for absences under OFFLINE_MIN_MS
}

/** The rate at `t` real ms after leaving: 1, then 0.25, then 0. */
export function offlineRate(t: number): number {
  if (t < OFFLINE_FULL_MS) return 1;
  if (t < OFFLINE_FULL_MS + OFFLINE_REDUCED_MS) return OFFLINE_REDUCED_RATE;
  return 0;
}

/** ∫ rate over [0, t], floored to whole ms. Differences of this give exact integer segment lengths. */
export function simulatedMsFor(t: number): number {
  const full = Math.min(Math.max(t, 0), OFFLINE_FULL_MS);
  const reduced = Math.min(Math.max(t - OFFLINE_FULL_MS, 0), OFFLINE_REDUCED_MS);
  return Math.floor(full + reduced * OFFLINE_REDUCED_RATE);
}

export type StepFn = typeof step;

/**
 * Applies offline progress for the calendar interval [from, to] (both already include any debug
 * offset). Mutates `state`. `sim` is injectable for tests.
 */
export function runOffline(
  state: GameState,
  data: GameData,
  lc: LocalClock,
  from: number,
  to: number,
  sim: StepFn = step,
): OfflineReport {
  const events: GameEvent[] = [];
  const awayMs = Math.max(0, to - from);
  if (awayMs === 0) {
    return { awayMs: 0, simulatedMs: 0, dayStarts: 0, seasonChanges: [], events, showSummary: false };
  }

  // Segment ends while time still counts: rate changes plus every calendar boundary. Once the rate
  // is 0 nothing advances, so the rest of the absence collapses into one calendar catch-up at `to`.
  const countingEnd = Math.min(to, from + OFFLINE_FULL_MS + OFFLINE_REDUCED_MS);
  const cuts = new Set<number>([from + OFFLINE_FULL_MS, countingEnd, to]);
  for (let b = nextDailyBoundary(from, lc); b < countingEnd; b = nextDailyBoundary(b, lc)) cuts.add(b);
  for (let b = nextWeeklyBoundary(from, lc); b < countingEnd; b = nextWeeklyBoundary(b, lc)) cuts.add(b);
  const points = [...cuts].filter((p) => p > from && p <= to).sort((a, b) => a - b);

  let simulatedMs = 0;
  let a = from;
  for (const b of points) {
    const dt = simulatedMsFor(b - from) - simulatedMsFor(a - from);
    if (dt > 0) {
      const ctx = makeContext(state, data, buildCalendar(a, state.calendar, lc), events);
      sim(state, ctx, dt);
      simulatedMs += dt;
    }
    processCalendar(state, data, lc, b, events);
    a = b;
  }

  const seasonChanges: SeasonId[] = [];
  let dayStarts = 0;
  for (const e of events) {
    if (e.type === 'seasonChanged') seasonChanges.push(e.season);
    else if (e.type === 'dayStarted') dayStarts++;
  }
  return { awayMs, simulatedMs, dayStarts, seasonChanges, events, showSummary: awayMs >= OFFLINE_MIN_MS };
}
