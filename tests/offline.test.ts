import { describe, expect, it } from 'vitest';
import { offlineRate, runOffline, simulatedMsFor } from '../src/core/offline';
import { processCalendar, step } from '../src/core/sim';
import { createInitialState } from '../src/core/state';
import { GAME_DATA } from '../src/data';
import type { SimContext } from '../src/systems/context';
import type { GameState } from '../src/core/state';
import { at, DAY, HOUR, NY } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday; first season change Sunday 2026-01-11 00:00

/** A save created at CREATED whose calendar is up to date at `t` (the moment the player left). */
function stateAt(t: number): GameState {
  const s = createInitialState(CREATED, NY, 1);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function recorder() {
  const calls: { at: number; dt: number }[] = [];
  const sim = (state: GameState, ctx: SimContext, dt: number): void => {
    calls.push({ at: ctx.calendar.nowMs, dt });
    step(state, ctx, dt);
  };
  return { calls, sim };
}

describe('offline rate', () => {
  it('counts 8 h fully, the next 16 h at 25%, then nothing', () => {
    expect(offlineRate(0)).toBe(1);
    expect(offlineRate(8 * HOUR - 1)).toBe(1);
    expect(offlineRate(8 * HOUR)).toBe(0.25);
    expect(offlineRate(24 * HOUR - 1)).toBe(0.25);
    expect(offlineRate(24 * HOUR)).toBe(0);
    expect(simulatedMsFor(HOUR)).toBe(HOUR);
    expect(simulatedMsFor(8 * HOUR)).toBe(8 * HOUR);
    expect(simulatedMsFor(10 * HOUR)).toBe(8.5 * HOUR);
    expect(simulatedMsFor(24 * HOUR)).toBe(12 * HOUR);
    expect(simulatedMsFor(30 * DAY)).toBe(12 * HOUR);
  });
});

describe('runOffline', () => {
  it('grants the capped simulated time', () => {
    for (const [away, sim] of [
      [2 * HOUR, 2 * HOUR],
      [8 * HOUR, 8 * HOUR],
      [16 * HOUR, 10 * HOUR],
      [24 * HOUR, 12 * HOUR],
      [3 * DAY, 12 * HOUR],
    ] as const) {
      const s = createInitialState(CREATED, NY, 1);
      const r = runOffline(s, GAME_DATA, NY, CREATED, CREATED + away);
      expect(r.simulatedMs).toBe(sim);
      expect(s.clock.simMs).toBe(sim);
      expect(r.awayMs).toBe(away);
    }
  });

  it('splits at the daily 06:00 refresh', () => {
    const leave = at(NY, 2026, 1, 8, 4);
    const s = stateAt(leave);
    const { calls, sim } = recorder();
    const r = runOffline(s, GAME_DATA, NY, leave, at(NY, 2026, 1, 8, 10), sim);
    expect(calls).toEqual([
      { at: leave, dt: 2 * HOUR },
      { at: at(NY, 2026, 1, 8, 6), dt: 4 * HOUR },
    ]);
    expect(r.dayStarts).toBe(1);
    expect(s.calendar.lastDayKey).toBe('2026-01-08');
  });

  it('splits where the rate drops, so no step straddles it', () => {
    const leave = at(NY, 2026, 1, 8, 8); // next 06:00 is 22 h later
    const s = stateAt(leave);
    const { calls, sim } = recorder();
    runOffline(s, GAME_DATA, NY, leave, leave + 20 * HOUR, sim);
    expect(calls.map((c) => [c.at - leave, c.dt])).toEqual([
      [0, 8 * HOUR],
      [8 * HOUR, 3 * HOUR], // 12 h at 25%
    ]);
  });

  it('applies a season change at its boundary, between steps', () => {
    const leave = at(NY, 2026, 1, 10, 22); // Saturday night
    const s = stateAt(leave);
    const { calls, sim } = recorder();
    const r = runOffline(s, GAME_DATA, NY, leave, at(NY, 2026, 1, 11, 2), sim);
    expect(calls.map((c) => c.dt)).toEqual([2 * HOUR, 2 * HOUR]);
    expect(calls[1]?.at).toBe(at(NY, 2026, 1, 11, 0));
    expect(r.seasonChanges).toEqual(['summer']);
    expect(r.events.map((e) => e.type)).toEqual(['seasonChanged']);
  });

  it('handles a 40-day absence cheaply, capped at 12 h, with the calendar caught up', () => {
    const leave = at(NY, 2026, 1, 8, 12);
    const back = leave + 40 * DAY; // Tuesday 2026-02-17
    const s = stateAt(leave);
    const { calls, sim } = recorder();
    const t0 = performance.now();
    const r = runOffline(s, GAME_DATA, NY, leave, back, sim);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(r.simulatedMs).toBe(12 * HOUR);
    expect(calls.reduce((a, c) => a + c.dt, 0)).toBe(12 * HOUR);
    expect(calls.every((c) => c.at < leave + 24 * HOUR)).toBe(true);
    // One refresh inside the counted day, and one for the day the player returns: not 40.
    expect(r.dayStarts).toBe(2);
    expect(s.calendar.lastDayKey).toBe('2026-02-17');
    // Weeks 1..6 passed; only the last four are applied, in order.
    expect(s.calendar.maxWeekIndex).toBe(6);
    expect(r.seasonChanges).toEqual(['winter', 'spring', 'summer', 'autumn']);
    expect(r.showSummary).toBe(true);
  });

  it('a 30-day absence grants exactly 12 h', () => {
    const leave = at(NY, 2026, 1, 8, 12);
    const s = stateAt(leave);
    const r = runOffline(s, GAME_DATA, NY, leave, leave + 30 * DAY);
    expect(r.simulatedMs).toBe(12 * HOUR);
    expect(s.clock.simMs).toBe(12 * HOUR);
    expect(s.calendar.maxWeekIndex).toBe(4);
  });

  it('does nothing when the clock went backwards', () => {
    const s = createInitialState(CREATED, NY, 1);
    const r = runOffline(s, GAME_DATA, NY, CREATED + DAY, CREATED);
    expect(r).toMatchObject({ awayMs: 0, simulatedMs: 0, events: [], showSummary: false });
    expect(s.clock.simMs).toBe(0);
  });

  it('skips the summary for absences under a minute', () => {
    const s = createInitialState(CREATED, NY, 1);
    expect(runOffline(s, GAME_DATA, NY, CREATED, CREATED + 59_000).showSummary).toBe(false);
    expect(runOffline(s, GAME_DATA, NY, CREATED, CREATED + 60_000).showSummary).toBe(true);
  });
});
