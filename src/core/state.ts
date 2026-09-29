// GameState (docs/DATA_SCHEMAS.md §6). Phase 01 implements only the @01 fields; each later phase
// adds its fields, bumps SAVE_VERSION and writes a migration in save.ts.
//
// State is plain JSON: no classes, Maps, Sets, Dates or functions. The UI and renderer only read it;
// every change goes through dispatch() (core/actions.ts) or the simulation step (core/sim.ts).

import { createCalendarState, type CalendarState, type LocalClock } from './time';
import { seedFrom } from './rng';

export interface Settings {
  masterVolume: number; // 0..1 (@01 stub, @08 real)
}

export interface GameState {
  // ---- core (@01)
  clock: { simMs: number; speed: number }; // speed: 1, or 60 with the debug time warp (never saved as ≠1)
  calendar: CalendarState;
  rngState: number; // mulberry32 state; the ONLY source of randomness
  gold: number; // always 0 until phase 02 gives starting gold
  settings: Settings;
  meta: { createdAt: number; lastSavedAt: number; playTimeMs: number };
}

export const DEFAULT_SETTINGS: Settings = { masterVolume: 0.8 };

/** A brand-new save created at real time `now`. `seed` defaults to one derived from `now`. */
export function createInitialState(now: number, lc: LocalClock, seed: number = seedFrom(now)): GameState {
  return {
    clock: { simMs: 0, speed: 1 },
    calendar: createCalendarState(now, lc),
    rngState: seed >>> 0,
    gold: 0,
    settings: { ...DEFAULT_SETTINGS },
    meta: { createdAt: now, lastSavedAt: now, playTimeMs: 0 },
  };
}

/** Deep copy (state is plain JSON). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
