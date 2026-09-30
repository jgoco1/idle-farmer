// Fishing locations (GDD §6.4): the pond from the start, the river and the ocean (Old Dock) once
// their expansions are bought. Unlocked locations are derived from `state.expansions`, never
// stored twice. Fish traps are set out at these waters, two per location.

import type { GameState, TrapState } from '../core/state';
import type { GameData } from '../data';
import { TRAPS_PER_LOCATION } from '../data/balance';
import { FISH_LOCATIONS } from '../data/fish';
import type { FishLocationId } from '../data/ids';
import { bundleBonuses } from './bundles';

export function unlockedLocations(state: GameState): FishLocationId[] {
  return FISH_LOCATIONS.filter((l) => isLocationUnlocked(state, l));
}

export function isLocationUnlocked(state: GameState, location: FishLocationId): boolean {
  return location === 'pond' || state.expansions.includes(location);
}

/** The expansion that opens `location` (null for the pond, which is open from the start). */
export function expansionFor(data: GameData, location: FishLocationId) {
  return Object.values(data.expansions).find((e) => e.location === location) ?? null;
}

export function trapsAt(state: GameState, location: FishLocationId): TrapState[] {
  return state.fishing.traps.filter((t) => t.location === location);
}

/** Trap spots at each water: two, and one more with the Pond Fish bundle. */
export function trapsPerLocation(state: GameState, data: GameData): number {
  return TRAPS_PER_LOCATION + bundleBonuses(state, data).trapPerLocation;
}

/** Traps the player may own right now: the spots at every unlocked location. */
export function maxTraps(state: GameState, data: GameData): number {
  return trapsPerLocation(state, data) * unlockedLocations(state).length;
}

/** Where the next bought trap goes: the first unlocked water with a free spot. */
export function nextTrapSpot(
  state: GameState,
  data: GameData,
): { location: FishLocationId; slot: number } | null {
  const per = trapsPerLocation(state, data);
  for (const location of unlockedLocations(state)) {
    const used = new Set(trapsAt(state, location).map((t) => t.slot));
    for (let slot = 0; slot < per; slot++) if (!used.has(slot)) return { location, slot };
  }
  return null;
}

/** Sets out a new, empty trap at the next free spot. Returns it, or null when every spot is taken. */
export function addTrap(state: GameState, data: GameData): TrapState | null {
  const spot = nextTrapSpot(state, data);
  if (!spot) return null;
  const id = state.fishing.traps.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  const trap: TrapState = { id, ...spot, progressMs: 0, contents: [] };
  state.fishing.traps.push(trap);
  return trap;
}
