// The two clocks (docs/GDD.md §4, docs/BALANCE.md §1).
//
// The **calendar** (time of day, day, season, year) follows the real local clock. It is always
// computed from an injected `now` and a `LocalClock`, never stored, so tests can fix both the date
// and the time zone. **Simulated time** is `state.clock.simMs` and drives every timer.

import type { SeasonId } from '../data/ids';

export const TICK_MS = 100; // fixed simulation step, 10 ticks per second
export const SEASONS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
export const DAY_START_HOUR = 6; // daily calendar events fire at 06:00 local
export const NIGHT_START_HOUR = 20; // night is 20:00–06:00 local
export const MIN_FIRST_SEASON_DAYS = 3; // the first spring lasts at least this long

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Everything a system may know about real-world time. Built by the core from `now`, never inside systems. */
export interface Calendar {
  nowMs: number; // calendar epoch ms (real now + debug offset); only for display and logs
  hour: number; // 0..23 local
  minute: number; // 0..59 local
  weekday: number; // 0 = Sunday … 6 = Saturday, local
  dayKey: string; // 'YYYY-MM-DD' of the 06:00 → 06:00 local day
  weekIndex: number; // 0 = the first (possibly longer) spring; +1 at each counted Sunday 00:00
  season: SeasonId; // SEASONS[weekIndex % 4]
  year: number; // floor(weekIndex / 4) + 1
  isNight: boolean;
  msToSeasonChange: number; // real ms until the next counted Sunday 00:00
}

export interface LocalParts {
  y: number;
  mo: number; // 1..12
  d: number;
  h: number;
  mi: number;
  wd: number; // 0 = Sunday
}

/** Wraps the time zone so tests can run in a fixed zone. */
export interface LocalClock {
  parts(epochMs: number): LocalParts;
}

/** The persisted calendar fields of GameState (DATA_SCHEMAS.md §6). */
export interface CalendarState {
  createdAt: number;
  seasonEpoch: number;
  maxWeekIndex: number;
  lastDayKey: string;
  debugOffsetMs: number;
}

/** The browser's local time zone. */
export const systemLocalClock: LocalClock = {
  parts(t) {
    const dt = new Date(t);
    return {
      y: dt.getFullYear(),
      mo: dt.getMonth() + 1,
      d: dt.getDate(),
      h: dt.getHours(),
      mi: dt.getMinutes(),
      wd: dt.getDay(),
    };
  },
};

/** A clock pinned to an IANA time zone (used by tests and, if ever needed, a settings override). */
export function zoneClock(timeZone: string): LocalClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  // formatToParts is slow and the same minute is asked for many times in a row (the calendar, the
  // day and week boundaries), so the last few minutes are remembered. The seconds never change the parts.
  const cache = new Map<number, LocalParts>();
  return {
    parts(t) {
      const minute = Math.floor(t / MINUTE_MS);
      const hit = cache.get(minute);
      if (hit) return hit;
      const p: Record<string, number> = {};
      for (const part of fmt.formatToParts(t)) {
        if (part.type !== 'literal') p[part.type] = Number(part.value);
      }
      const y = p.year ?? 1970;
      const mo = p.month ?? 1;
      const d = p.day ?? 1;
      const out: LocalParts = {
        y,
        mo,
        d,
        h: (p.hour ?? 0) % 24,
        mi: p.minute ?? 0,
        wd: weekdayOfDay(daysFromCivil(y, mo, d)),
      };
      if (cache.size >= ZONE_CACHE_MINUTES) cache.delete(cache.keys().next().value!);
      cache.set(minute, out);
      return out;
    },
  };
}

/** How many distinct minutes a zone clock remembers. */
const ZONE_CACHE_MINUTES = 256;

/** Whole days since 1970-01-01 for a civil date (no time zone involved). */
export function daysFromCivil(y: number, mo: number, d: number): number {
  return Math.floor(Date.UTC(y, mo - 1, d) / DAY_MS);
}

export function civilFromDays(day: number): { y: number; mo: number; d: number } {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 0 = Sunday. 1970-01-01 was a Thursday. */
export function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** Sunday-based week number of a day number; it increments at every Sunday. */
function sundayWeek(day: number): number {
  return Math.floor((day - 3) / 7); // day 3 = 1970-01-04, a Sunday
}

/** Whole local calendar days since 1970-01-01 (DST-safe: built from local Y/M/D). */
export function localDay(lc: LocalClock, t: number): number {
  const p = lc.parts(t);
  return daysFromCivil(p.y, p.mo, p.d);
}

/** The local wall-clock reading of `t` expressed as if it were UTC, with the sub-minute part kept. */
function wallMs(lc: LocalClock, t: number): number {
  const p = lc.parts(t);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) + (((t % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
}

/**
 * The earliest instant whose local wall-clock time is at or after the given local time. In a
 * spring-forward gap (the time does not exist) this is the moment of the jump; on a fall-back day
 * (the time happens twice) it is the first occurrence.
 */
export function localTimeToEpoch(lc: LocalClock, day: number, hour: number, minute = 0): number {
  const target = day * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS;
  const offBefore = wallMs(lc, target - DAY_MS) - (target - DAY_MS);
  const offAfter = wallMs(lc, target + DAY_MS) - (target + DAY_MS);
  const candidates = [target - offBefore, target - offAfter].filter((c) => wallMs(lc, c) === target);
  if (candidates.length > 0) return Math.min(...candidates);
  // Gap: search for the first instant at or after the target wall time.
  let lo = Math.min(target - offBefore, target - offAfter);
  let hi = Math.max(target - offBefore, target - offAfter);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallMs(lc, mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The first counted Sunday 00:00 (BALANCE.md §1): the first local Sunday midnight after `createdAt`,
 * pushed a week later if it is less than MIN_FIRST_SEASON_DAYS away.
 */
export function computeSeasonEpoch(createdAt: number, lc: LocalClock): number {
  const p = lc.parts(createdAt);
  const today = daysFromCivil(p.y, p.mo, p.d);
  const firstSunday = localTimeToEpoch(lc, today + (7 - p.wd), 0);
  if (firstSunday - createdAt < MIN_FIRST_SEASON_DAYS * DAY_MS) {
    return localTimeToEpoch(lc, today + (7 - p.wd) + 7, 0);
  }
  return firstSunday;
}

/**
 * The Sunday week of the season epoch, independent of the current time zone. `seasonEpoch` is a
 * local Sunday 00:00 in the zone the save was made in, so in UTC it lies between Saturday 10:00
 * (UTC+14) and Sunday 12:00 (UTC−12); adding 14 h always lands in that Sunday's week.
 */
function epochWeek(seasonEpoch: number): number {
  return sundayWeek(Math.floor((seasonEpoch + 14 * HOUR_MS) / DAY_MS));
}

/** The raw week index at `t` (not yet clamped by `maxWeekIndex`). */
export function weekIndexAt(t: number, seasonEpoch: number, lc: LocalClock): number {
  return Math.max(0, sundayWeek(localDay(lc, t)) - epochWeek(seasonEpoch) + 1);
}

/** 'YYYY-MM-DD' of the local 06:00 → 06:00 day containing `t`. */
export function dayKeyAt(t: number, lc: LocalClock): string {
  const p = lc.parts(t);
  let day = daysFromCivil(p.y, p.mo, p.d);
  if (p.h < DAY_START_HOUR) day -= 1;
  const c = civilFromDays(day);
  return `${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/** The first local 06:00 strictly after `t`. */
export function nextDailyBoundary(t: number, lc: LocalClock): number {
  const today = localDay(lc, t);
  const b = localTimeToEpoch(lc, today, DAY_START_HOUR);
  return b > t ? b : localTimeToEpoch(lc, today + 1, DAY_START_HOUR);
}

/** The first local Sunday 00:00 strictly after `t`. */
export function nextWeeklyBoundary(t: number, lc: LocalClock): number {
  const p = lc.parts(t);
  const today = daysFromCivil(p.y, p.mo, p.d);
  return localTimeToEpoch(lc, today + (7 - p.wd), 0);
}

/** The first Sunday 00:00 after `t` at which the season actually changes. */
export function nextSeasonChange(t: number, seasonEpoch: number, lc: LocalClock): number {
  const w = weekIndexAt(t, seasonEpoch, lc);
  let b = nextWeeklyBoundary(t, lc);
  for (let i = 0; i < 3 && weekIndexAt(b, seasonEpoch, lc) <= w; i++) b = nextWeeklyBoundary(b, lc);
  return b;
}

/** Calendar time = real time plus the debug time-warp offset (0 in normal play). */
export function calendarTime(cal: CalendarState, realNow: number): number {
  return realNow + cal.debugOffsetMs;
}

export function seasonOfWeek(weekIndex: number): SeasonId {
  return SEASONS[weekIndex % SEASONS.length] ?? 'spring';
}

/** Builds the calendar at calendar time `t` (already including any debug offset). */
export function buildCalendar(t: number, cal: CalendarState, lc: LocalClock): Calendar {
  const p = lc.parts(t);
  const weekIndex = Math.max(weekIndexAt(t, cal.seasonEpoch, lc), cal.maxWeekIndex);
  return {
    nowMs: t,
    hour: p.h,
    minute: p.mi,
    weekday: p.wd,
    dayKey: dayKeyAt(t, lc),
    weekIndex,
    season: seasonOfWeek(weekIndex),
    year: Math.floor(weekIndex / SEASONS.length) + 1,
    isNight: p.h >= NIGHT_START_HOUR || p.h < DAY_START_HOUR,
    msToSeasonChange: Math.max(0, nextSeasonChange(t, cal.seasonEpoch, lc) - t),
  };
}

/** A fresh calendar block for a new save created at `createdAt`. */
export function createCalendarState(createdAt: number, lc: LocalClock): CalendarState {
  return {
    createdAt,
    seasonEpoch: computeSeasonEpoch(createdAt, lc),
    maxWeekIndex: 0,
    lastDayKey: dayKeyAt(createdAt, lc),
    debugOffsetMs: 0,
  };
}

// ---- formatting (shared by the HUD and the debug overlay)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** `9:40 AM` */
export function formatClock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** `Spring · Year 1 · Tue 9:40 AM` (BALANCE.md §1). */
export function formatHudDate(c: Calendar): string {
  return `${capitalize(c.season)} · Year ${c.year} · ${WEEKDAYS[c.weekday] ?? ''} ${formatClock(c.hour, c.minute)}`;
}

/** `2d 4h`, `3h 12m`, `45s` */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
