import { describe, expect, it } from 'vitest';
import { makeContext, processCalendar } from '../src/core/sim';
import type { GameEvent } from '../src/core/events';
import { createInitialState } from '../src/core/state';
import {
  buildCalendar,
  computeSeasonEpoch,
  createCalendarState,
  dayKeyAt,
  formatClock,
  formatHudDate,
  nextDailyBoundary,
  nextSeasonChange,
  nextWeeklyBoundary,
  seasonOfDay,
  weekIndexAt,
} from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { at, DAY, HOUR, LA, NY, SANTIAGO, TOKYO } from './helpers';

// 2026-01-07 is a Wednesday. Its first counted Sunday is 2026-01-11 (4 days away).
const CREATED = at(NY, 2026, 1, 7, 10, 0);

function cal(t: number, created = CREATED) {
  return buildCalendar(t, createCalendarState(created, NY), NY);
}

describe('calendar: time of day', () => {
  it('night is 20:00–06:00 local', () => {
    expect(cal(at(NY, 2026, 1, 7, 19, 59)).isNight).toBe(false);
    expect(cal(at(NY, 2026, 1, 7, 20, 0)).isNight).toBe(true);
    expect(cal(at(NY, 2026, 1, 8, 0, 0)).isNight).toBe(true);
    expect(cal(at(NY, 2026, 1, 8, 5, 59)).isNight).toBe(true);
    expect(cal(at(NY, 2026, 1, 8, 6, 0)).isNight).toBe(false);
  });

  it('reports local hour, minute and weekday', () => {
    const c = cal(at(NY, 2026, 1, 7, 9, 40));
    expect([c.hour, c.minute, c.weekday]).toEqual([9, 40, 3]);
  });

  it('formats the HUD line', () => {
    expect(formatHudDate(cal(at(NY, 2026, 1, 13, 9, 40)))).toBe('Summer · Year 1 · Tue 9:40 AM');
    expect(formatClock(0, 5)).toBe('12:05 AM');
    expect(formatClock(12, 0)).toBe('12:00 PM');
    expect(formatClock(21, 40)).toBe('9:40 PM');
  });
});

describe('calendar: the daily 06:00 refresh', () => {
  it('a day runs 06:00 → 06:00 local', () => {
    expect(dayKeyAt(at(NY, 2026, 1, 8, 5, 59), NY)).toBe('2026-01-07');
    expect(dayKeyAt(at(NY, 2026, 1, 8, 6, 0), NY)).toBe('2026-01-08');
    expect(dayKeyAt(at(NY, 2026, 1, 1, 3, 0), NY)).toBe('2025-12-31');
  });

  it('finds the next 06:00 strictly after a time', () => {
    expect(nextDailyBoundary(at(NY, 2026, 1, 8, 5, 0), NY)).toBe(at(NY, 2026, 1, 8, 6));
    expect(nextDailyBoundary(at(NY, 2026, 1, 8, 6, 0), NY)).toBe(at(NY, 2026, 1, 9, 6));
  });

  it('fires dayStarted once when 06:00 passes, and not again the same day', () => {
    const s = createInitialState(at(NY, 2026, 1, 7, 22), NY, 1);
    const events: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 8, 5, 59), events);
    expect(events).toEqual([]);
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 8, 6, 0), events);
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 8, 12, 0), events);
    expect(events).toEqual([{ type: 'dayStarted', dayKey: '2026-01-08' }]);
  });
});

describe('calendar: DST days', () => {
  it('spring forward: the 06:00 → 06:00 day is 23 h long', () => {
    const start = at(NY, 2026, 3, 7, 6);
    expect(nextDailyBoundary(start, NY) - start).toBe(23 * HOUR);
    expect(dayKeyAt(at(NY, 2026, 3, 8, 6), NY)).toBe('2026-03-08');
    expect(dayKeyAt(at(NY, 2026, 3, 8, 6) - 1, NY)).toBe('2026-03-07');
  });

  it('fall back: the 06:00 → 06:00 day is 25 h long', () => {
    const start = at(NY, 2026, 10, 31, 6);
    expect(nextDailyBoundary(start, NY) - start).toBe(25 * HOUR);
  });

  it('a season week containing the fall-back is 7 days + 1 h', () => {
    const sunday = at(NY, 2026, 11, 1, 0);
    expect(nextWeeklyBoundary(sunday, NY) - sunday).toBe(7 * DAY + HOUR);
  });

  it('a Sunday midnight that does not exist (DST at 24:00) still changes the season', () => {
    // Santiago springs forward at Saturday 24:00 → Sunday 01:00 (2026-09-06).
    const sat = at(SANTIAGO, 2026, 9, 5, 23, 30);
    const b = nextWeeklyBoundary(sat, SANTIAGO);
    expect(b - sat).toBe(30 * 60_000);
    expect(SANTIAGO.parts(b)).toMatchObject({ d: 6, h: 1, wd: 0 });
    const epoch = computeSeasonEpoch(at(SANTIAGO, 2026, 8, 26, 12), SANTIAGO);
    expect(weekIndexAt(b, epoch, SANTIAGO)).toBe(weekIndexAt(b - 1, epoch, SANTIAGO) + 1);
  });
});

describe('calendar: weekly seasons', () => {
  it('the first counted Sunday is at least 3 days after creation', () => {
    expect(computeSeasonEpoch(CREATED, NY)).toBe(at(NY, 2026, 1, 11)); // Wed → Sun, 4 days
    expect(computeSeasonEpoch(at(NY, 2026, 1, 9, 10), NY)).toBe(at(NY, 2026, 1, 18)); // Fri → next-but-one Sun
    expect(computeSeasonEpoch(at(NY, 2026, 1, 11, 0, 30), NY)).toBe(at(NY, 2026, 1, 18)); // Sun → following Sun
  });

  it('every save starts in spring, then changes weekly at Saturday → Sunday midnight', () => {
    expect(cal(CREATED).season).toBe('spring');
    expect(cal(at(NY, 2026, 1, 10, 23, 59)).season).toBe('spring');
    expect(cal(at(NY, 2026, 1, 11, 0, 0)).season).toBe('summer');
    expect(cal(at(NY, 2026, 1, 17, 23, 59)).season).toBe('summer');
    expect(cal(at(NY, 2026, 1, 18)).season).toBe('autumn');
    expect(cal(at(NY, 2026, 1, 25)).season).toBe('winter');
  });

  it('rolls the year over after winter', () => {
    const winter = cal(at(NY, 2026, 1, 31, 23, 59));
    expect([winter.season, winter.year, winter.weekIndex]).toEqual(['winter', 1, 3]);
    const spring = cal(at(NY, 2026, 2, 1));
    expect([spring.season, spring.year, spring.weekIndex]).toEqual(['spring', 2, 4]);
  });

  it('reports the time until the next season change', () => {
    expect(cal(at(NY, 2026, 1, 10, 22)).msToSeasonChange).toBe(2 * HOUR);
    expect(nextSeasonChange(CREATED, computeSeasonEpoch(CREATED, NY), NY)).toBe(at(NY, 2026, 1, 11));
  });

  it('fires one seasonChanged per week crossed, in order', () => {
    const s = createInitialState(CREATED, NY, 1);
    const events: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 20, 12), events);
    expect(events.filter((e) => e.type === 'seasonChanged')).toEqual([
      { type: 'seasonChanged', season: 'summer', withered: 0 },
      { type: 'seasonChanged', season: 'autumn', withered: 0 },
    ]);
    expect(s.calendar.maxWeekIndex).toBe(2);
  });
});

describe('calendar: clock set back', () => {
  it('the week index never decreases', () => {
    const s = createInitialState(CREATED, NY, 1);
    const events: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 26, 12), events); // winter (week 3)
    expect(s.calendar.maxWeekIndex).toBe(3);
    events.length = 0;
    const back = at(NY, 2026, 1, 12, 12); // the clock is set back two weeks
    processCalendar(s, GAME_DATA, NY, back, events);
    expect(events).toEqual([]);
    const c = buildCalendar(back, s.calendar, NY);
    expect([c.weekIndex, c.season]).toEqual([3, 'winter']);
  });
});

describe('calendar: time-zone change', () => {
  it('mid-week, the season is the same in every zone', () => {
    const state = createCalendarState(CREATED, NY);
    const wed = at(NY, 2026, 1, 21, 12);
    const ny = buildCalendar(wed, state, NY).weekIndex;
    expect(buildCalendar(wed, state, TOKYO).weekIndex).toBe(ny);
    expect(buildCalendar(wed, state, LA).weekIndex).toBe(ny);
  });

  it('the season changes at the new zone’s own Sunday midnight', () => {
    const state = createCalendarState(CREATED, NY);
    // Saturday 23:00 in NY is already Sunday 13:00 in Tokyo.
    const t = at(NY, 2026, 1, 17, 23);
    expect(buildCalendar(t, state, NY).season).toBe('summer');
    expect(buildCalendar(t, state, TOKYO).season).toBe('autumn');
    expect(nextWeeklyBoundary(at(TOKYO, 2026, 1, 17, 23), TOKYO)).toBe(at(TOKYO, 2026, 1, 18, 0));
  });

  it('flying west does not move the season backwards', () => {
    const s = createInitialState(CREATED, NY, 1);
    const events: GameEvent[] = [];
    const t = at(TOKYO, 2026, 1, 18, 9); // Sunday morning in Tokyo, still Saturday in LA
    processCalendar(s, GAME_DATA, TOKYO, t, events);
    expect(buildCalendar(t, s.calendar, TOKYO).season).toBe('autumn');
    events.length = 0;
    processCalendar(s, GAME_DATA, LA, t + HOUR, events);
    expect(events.filter((e) => e.type === 'seasonChanged')).toEqual([]);
    expect(buildCalendar(t + HOUR, s.calendar, LA).season).toBe('autumn');
  });

  it('builds the same context for systems whatever the zone', () => {
    const s = createInitialState(CREATED, NY, 1);
    const ctx = makeContext(s, GAME_DATA, buildCalendar(CREATED, s.calendar, TOKYO));
    expect(ctx.calendar.season).toBe('spring');
  });
});

describe('calendar: the day index (v2 phase 03)', () => {
  /** Runs the calendar events up to `t` and returns the day index there (the one trees count). */
  function indexAt(s: ReturnType<typeof createInitialState>, t: number, lc = NY): number {
    processCalendar(s, GAME_DATA, lc, t, []);
    return buildCalendar(t, s.calendar, lc).dayIndex;
  }

  it('starts at 0 on the day the save was made and counts whole 06:00 → 06:00 days', () => {
    const s = createInitialState(CREATED, NY, 1);
    expect(indexAt(s, CREATED)).toBe(0);
    expect(indexAt(s, at(NY, 2026, 1, 8, 5, 59))).toBe(0);
    expect(indexAt(s, at(NY, 2026, 1, 8, 6, 0))).toBe(1);
    expect(indexAt(s, at(NY, 2026, 1, 9, 5, 0))).toBe(1);
    expect(indexAt(s, at(NY, 2026, 1, 9, 6, 0))).toBe(2);
  });

  it('a save made before 06:00 belongs to the day before, like every other day', () => {
    const early = at(NY, 2026, 1, 7, 3);
    const s = createInitialState(early, NY, 1);
    expect(s.calendar.dayZeroKey).toBe('2026-01-06');
    expect(indexAt(s, at(NY, 2026, 1, 7, 6))).toBe(1);
  });

  it('never skips or repeats a day across daylight-saving changes (days are keyed by date, not by 24 h)', () => {
    for (const start of [at(NY, 2026, 3, 5, 12), at(NY, 2026, 10, 30, 12)]) {
      const s = createInitialState(start, NY, 1);
      let prev = indexAt(s, start);
      expect(prev).toBe(0);
      // Walk 06:00 refresh by 06:00 refresh over the 23 h spring-forward day and the 25 h fall-back day.
      let t = start;
      for (let i = 1; i <= 6; i++) {
        t = nextDailyBoundary(t, NY);
        const idx = indexAt(s, t);
        expect(idx, `step ${i}`).toBe(prev + 1);
        prev = idx;
        // and an hour before the next refresh it is still the same day
        expect(indexAt(s, nextDailyBoundary(t, NY) - HOUR)).toBe(idx);
      }
    }
  });

  it('flying west holds the index, flying east moves it by the date', () => {
    const s = createInitialState(CREATED, NY, 1);
    const t = at(TOKYO, 2026, 1, 12, 9); // Monday morning in Tokyo, still Sunday evening in New York
    const tokyo = indexAt(s, t, TOKYO);
    expect(tokyo).toBe(5); // 7 → 12 January
    expect(indexAt(s, t + HOUR, LA)).toBe(5); // LA says Sunday 11 January 16:00: the earlier date holds at 5
    expect(indexAt(s, at(LA, 2026, 1, 12, 7), LA)).toBe(5);
    expect(indexAt(s, at(LA, 2026, 1, 13, 7), LA)).toBe(6);
  });

  it('never decreases when the clock is set back', () => {
    const s = createInitialState(CREATED, NY, 1);
    expect(indexAt(s, at(NY, 2026, 1, 20, 12))).toBe(13);
    expect(indexAt(s, at(NY, 2026, 1, 10, 12))).toBe(13); // ten days back: held
    expect(s.calendar.maxDayIndex).toBe(13);
    expect(buildCalendar(at(NY, 2026, 1, 8, 12), s.calendar, NY).dayIndex).toBe(13);
    // and the first new day after the clock catches up counts as the next one
    expect(indexAt(s, at(NY, 2026, 1, 21, 6))).toBe(14);
  });

  it('a 30-day absence is 30 days older, and one jump equals thirty single days', () => {
    const jump = createInitialState(CREATED, NY, 1);
    const daily = createInitialState(CREATED, NY, 1);
    expect(indexAt(jump, CREATED + 30 * DAY)).toBe(30);
    let t = CREATED;
    for (let i = 0; i < 30; i++) {
      t = nextDailyBoundary(t, NY);
      indexAt(daily, t);
    }
    expect(buildCalendar(t, daily.calendar, NY).dayIndex).toBe(30);
    expect(jump.calendar.maxDayIndex).toBe(30);
  });

  it('is monotonic over any order of times', () => {
    const s = createInitialState(CREATED, NY, 1);
    let prev = 0;
    let seed = 7;
    for (let i = 0; i < 200; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const t = CREATED + (seed % (40 * DAY)) - 5 * DAY; // jumps forward and back
      const idx = indexAt(s, t);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it('seasonOfDay names the season of any day by its date, the same as the calendar on that day', () => {
    const s = createInitialState(CREATED, NY, 1);
    const base = buildCalendar(CREATED, s.calendar, NY);
    for (let d = 0; d < 60; d++) {
      const t = at(NY, 2026, 1, 7 + d, 12);
      expect(seasonOfDay(base, d), `day ${d}`).toBe(buildCalendar(t, s.calendar, NY).season);
    }
    // the season changes on the Sunday itself: day 4 is Sunday 11 January (summer), day 3 is Saturday (spring)
    expect([seasonOfDay(base, 3), seasonOfDay(base, 4)]).toEqual(['spring', 'summer']);
  });
});
