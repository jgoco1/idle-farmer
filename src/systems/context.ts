import type { Calendar } from '../core/time';
import type { Rng } from '../core/rng';
import type { GameEvent } from '../core/events';
import type { GameData } from '../data';
import type { Modifiers } from './modifiers';

/** Everything a system may use besides the state it mutates (DATA_SCHEMAS.md §7). */
export interface SimContext {
  data: GameData;
  rng: Rng; // wraps state.rngState; advancing it updates state.rngState
  calendar: Calendar; // real-world time of day and season, fixed for the duration of the step
  mods: Modifiers; // computed once per step
  events: GameEvent[]; // systems push events here; the core flushes them to the bus
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

export const OK: ActionResult = { ok: true };
export function fail(reason: string): ActionResult {
  return { ok: false, reason };
}
