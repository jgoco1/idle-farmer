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
