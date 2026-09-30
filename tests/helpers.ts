import { GAME_DATA, type GameData } from '../src/data';
import { daysFromCivil, localTimeToEpoch, zoneClock, type LocalClock } from '../src/core/time';

export const NY = zoneClock('America/New_York');
export const TOKYO = zoneClock('Asia/Tokyo');
export const LA = zoneClock('America/Los_Angeles');
export const SANTIAGO = zoneClock('America/Santiago');

/** Epoch ms of a local wall-clock time in `lc`. */
export function at(lc: LocalClock, y: number, mo: number, d: number, h = 0, mi = 0): number {
  return localTimeToEpoch(lc, daysFromCivil(y, mo, d), h, mi);
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Gives a state Farm Level `level` at once: the level an older save carried is a floor the real level never drops below. */
export function setFarmLevel(state: { progression: { farmLevelFloor: number } }, level: number): void {
  state.progression.farmLevelFloor = level;
}

/** Events that progression adds (XP, milestones, goals); tests of other systems filter them out of exact event lists. */
export const PROGRESSION_EVENTS: readonly string[] = [
  'questDone',
  'levelUp',
  'farmLevelUp',
  'unlocked',
  'bundleCompleted',
  'goldEarned',
  'recipeLearned',
];

/**
 * The game data with the skill perks removed. A growth perk (+5%) makes growth rates fractional, and
 * growth is rounded once per step, so one big step and many small ones can differ by a millisecond
 * (as they already do with a scarecrow); tests that compare them exactly pin the perks off.
 */
export const DATA_NO_PERKS: GameData = { ...GAME_DATA, perks: [] };
